function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shell({ title, headline, intro, note, buttonLabel, notesUrl, rows }) {
  const rowsHtml = rows.map(([label, value]) => (
    `<tr><td style="padding:6px 0;color:#475569;vertical-align:top"><strong>${escapeHtml(label)}</strong></td><td style="padding:6px 0;color:#0f172a">${escapeHtml(value)}</td></tr>`
  )).join('');

  return `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f1f5f9"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden">
<tr><td style="background:#166534;padding:22px;color:#ffffff"><div style="font-size:20px;font-weight:700">DigitalADbird CRM</div></td></tr>
<tr><td style="padding:28px">
<h1 style="font-size:22px;margin:0 0 12px">${escapeHtml(title)}</h1>
<p style="margin:0 0 18px;line-height:1.6">${escapeHtml(headline)}</p>
<p style="margin:0 0 18px;line-height:1.6;color:#334155">${escapeHtml(intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;width:100%;border-collapse:collapse">${rowsHtml}</table>
<p style="margin:18px 0 0;line-height:1.6;color:#475569">${escapeHtml(note)}</p>
<p style="margin:22px 0 0"><a href="${escapeHtml(notesUrl)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">${escapeHtml(buttonLabel)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

function textBody({ title, intro, note, notesUrl, rows }) {
  return [
    title,
    '',
    intro,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    note,
    `Open Notes Workspace: ${notesUrl}`,
  ].join('\n');
}

function buildMeetingPayload(note, options) {
  const rows = [
    ['Meeting', note.meeting_name || 'Scheduled meeting'],
    ['Time', options.meetingTimeLabel],
    ['Customer', note.customer_name || 'Customer'],
    ['Phone', note.customer_phone || 'Not available'],
    ['RM', note.rm_name || 'Not assigned'],
    ['Counselor', note.counselor_name || 'Not assigned'],
    ['Services Wanted', note.client_services_want || 'Not specified'],
    ['About Client', note.about_client || 'Not specified'],
  ];

  return {
    subject: `${options.title} | ${note.meeting_name || 'Customer Meeting'}`,
    html: shell({
      title: options.title,
      headline: options.headline,
      intro: options.intro,
      note: options.note,
      buttonLabel: options.buttonLabel,
      notesUrl: options.notesUrl,
      rows,
    }),
    text: textBody({
      title: options.title,
      intro: options.intro,
      note: options.note,
      notesUrl: options.notesUrl,
      rows,
    }),
  };
}

function scheduledMeetingEmail(note, context) {
  return buildMeetingPayload(note, {
    title: 'New Meeting Scheduled',
    headline: 'A new customer meeting has been scheduled in DigitalADbird CRM.',
    intro: 'Please review the meeting details below and be ready before the scheduled time.',
    note: 'You will receive another reminder 10 minutes before the meeting start time.',
    buttonLabel: 'Open Notes Workspace',
    meetingTimeLabel: context.meetingTimeLabel,
    notesUrl: context.notesUrl,
  });
}

function meetingReminderEmail(note, context) {
  return buildMeetingPayload(note, {
    title: 'Meeting Reminder',
    headline: 'Your scheduled customer meeting starts in 10 minutes.',
    intro: 'This is an automatic reminder so the RM, counselor, and custom recipients can prepare on time.',
    note: 'Please join or coordinate immediately if anything has changed.',
    buttonLabel: 'Review Meeting Note',
    meetingTimeLabel: context.meetingTimeLabel,
    notesUrl: context.notesUrl,
  });
}

function meetingStartedEmail(note, context) {
  return buildMeetingPayload(note, {
    title: 'Meeting Start Time Reached',
    headline: 'The scheduled meeting start time has been reached.',
    intro: 'Use the note thread to record updates, customer response, and next actions after the meeting begins.',
    note: 'If the meeting is rescheduled, update the schedule in the CRM so reminders stay accurate.',
    buttonLabel: 'Open Meeting Note',
    meetingTimeLabel: context.meetingTimeLabel,
    notesUrl: context.notesUrl,
  });
}

module.exports = {
  scheduledMeetingEmail,
  meetingReminderEmail,
  meetingStartedEmail,
};
