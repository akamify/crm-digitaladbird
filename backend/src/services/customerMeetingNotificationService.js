const { query } = require('../config/database');
const emailNotificationService = require('./email/emailNotificationService');
const {
  scheduledMeetingEmail,
  meetingReminderEmail,
  meetingStartedEmail,
} = require('./email/customerMeetingEmailTemplates');
const logger = require('../utils/logger');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function frontendNotesUrl(noteId) {
  return `https://crm.digitaladbird.com/notes${noteId ? `?noteId=${encodeURIComponent(noteId)}` : ''}`;
}

function formatMeetingDateLabel(value) {
  if (!value) return 'Scheduled time not available';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date(value));
  } catch (_) {
    return String(value);
  }
}

function meetingEmailContent(note, stage) {
  const meetingTimeLabel = formatMeetingDateLabel(note.meeting_at);
  const context = {
    meetingTimeLabel,
    notesUrl: frontendNotesUrl(note.id),
  };
  if (stage === 'reminder') return meetingReminderEmail(note, context);
  if (stage === 'started') return meetingStartedEmail(note, context);
  return scheduledMeetingEmail(note, context);
}

async function getMeetingRecipients(note) {
  const recipients = [];
  const seen = new Set();

  function pushRecipient({ email, fullName = null, userId = null, kind }) {
    const normalizedEmail = normalizeEmail(email);
    if (!isValidEmail(normalizedEmail) || seen.has(normalizedEmail)) return;
    seen.add(normalizedEmail);
    recipients.push({ email: normalizedEmail, fullName, userId, kind });
  }

  if (note.rm_user_id) {
    const { rows: [rm] } = await query(
      `SELECT id, full_name, email
         FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [note.rm_user_id],
    );
    if (rm?.email) pushRecipient({ email: rm.email, fullName: rm.full_name, userId: rm.id, kind: 'rm' });
  }

  if (Array.isArray(note.meeting_counselor_user_ids) && note.meeting_counselor_user_ids.length) {
    const { rows: counselors } = await query(
      `SELECT id, full_name, email
         FROM users
        WHERE id = ANY($1::uuid[])
          AND deleted_at IS NULL`,
      [note.meeting_counselor_user_ids],
    );
    for (const counselor of counselors) {
      if (counselor?.email) {
        pushRecipient({ email: counselor.email, fullName: counselor.full_name, userId: counselor.id, kind: 'counselor' });
      }
    }
  }

  if (note.counselor_user_id) {
    const { rows: [counselor] } = await query(
      `SELECT id, full_name, email
         FROM users
        WHERE id = $1
          AND deleted_at IS NULL
        LIMIT 1`,
      [note.counselor_user_id],
    );
    if (counselor?.email) pushRecipient({ email: counselor.email, fullName: counselor.full_name, userId: counselor.id, kind: 'counselor' });
  }

  for (const email of Array.isArray(note.meeting_notification_emails) ? note.meeting_notification_emails : []) {
    pushRecipient({ email, fullName: null, userId: null, kind: 'custom' });
  }

  return recipients;
}

async function sendMeetingNotification(note, stage) {
  if (!note?.meeting_at || !note?.meeting_name) return { sent: 0, skipped: true };
  const recipients = await getMeetingRecipients(note);
  if (!recipients.length) return { sent: 0, skipped: true };

  const content = meetingEmailContent(note, stage);
  let sent = 0;

  for (const recipient of recipients) {
    const result = await emailNotificationService.sendDirectNotificationEmail({
      email: recipient.email,
      fullName: recipient.fullName,
      userId: recipient.userId,
      emailType: `customer_meeting_${stage}`,
      subject: content.subject,
      html: content.html,
      text: content.text,
      metadata: {
        note_id: note.id,
        meeting_stage: stage,
        meeting_name: note.meeting_name,
        meeting_at: note.meeting_at,
        recipient_kind: recipient.kind,
      },
    });
    if (result.status === 'sent') sent += 1;
  }

  const setClause = stage === 'scheduled'
    ? 'meeting_invite_sent_at = NOW()'
    : stage === 'reminder'
      ? 'meeting_reminder_sent_at = NOW()'
      : 'meeting_started_email_sent_at = NOW()';

  await query(
    `UPDATE customer_notes
        SET ${setClause},
            updated_at = NOW()
      WHERE id = $1`,
    [note.id],
  ).catch((error) => {
    logger.warn({ noteId: note.id, stage, err: error.message }, '[CustomerMeeting] sent email but failed to update note flags');
  });

  return { sent, skipped: false };
}

async function fetchMeetingNotesToNotify() {
  const { rows } = await query(
    `SELECT n.id,
            n.customer_name,
            n.customer_phone,
            n.about_client,
            n.client_services_want,
            n.meeting_name,
            n.meeting_at,
            n.meeting_notification_emails,
            n.meeting_counselor_user_ids,
            n.meeting_invite_sent_at,
            n.meeting_reminder_sent_at,
            n.meeting_started_email_sent_at,
            n.counselor_user_id,
            counselor.full_name AS counselor_name,
            n.rm_user_id,
            rm.full_name AS rm_name
       FROM customer_notes n
       LEFT JOIN users counselor ON counselor.id = n.counselor_user_id
       LEFT JOIN users rm ON rm.id = n.rm_user_id
      WHERE n.deleted_at IS NULL
        AND n.meeting_at IS NOT NULL
        AND n.meeting_name IS NOT NULL
        AND n.meeting_completed_at IS NULL
        AND (
          n.meeting_invite_sent_at IS NULL
          OR (n.meeting_reminder_sent_at IS NULL AND n.meeting_at > NOW() AND n.meeting_at <= NOW() + INTERVAL '10 minutes')
          OR (n.meeting_started_email_sent_at IS NULL AND n.meeting_at <= NOW())
        )
      ORDER BY n.meeting_at ASC
      LIMIT 100`,
  );
  return rows;
}

async function processPendingMeetingNotifications() {
  const notes = await fetchMeetingNotesToNotify();
  for (const note of notes) {
    try {
      if (!note.meeting_invite_sent_at) {
        await sendMeetingNotification(note, 'scheduled');
      }

      const meetingAt = new Date(note.meeting_at);
      const now = new Date();
      if (!note.meeting_reminder_sent_at && meetingAt.getTime() > now.getTime() && meetingAt.getTime() - now.getTime() <= 10 * 60 * 1000) {
        await sendMeetingNotification(note, 'reminder');
      }

      if (!note.meeting_started_email_sent_at && meetingAt.getTime() <= now.getTime()) {
        await sendMeetingNotification(note, 'started');
      }
    } catch (error) {
      logger.warn({ noteId: note.id, err: error.message }, '[CustomerMeeting] notification tick failed for note');
    }
  }
}

module.exports = {
  sendMeetingNotification,
  processPendingMeetingNotifications,
};
