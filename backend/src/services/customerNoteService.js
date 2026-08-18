const { query, withTransaction } = require('../config/database');
const { AppError } = require('../utils/errors');
const { getVisibleUserIds } = require('../middleware/rbac');
const logger = require('../utils/logger');
const {
  isCustomerNoteApprovalStatus,
  isCustomerNoteUserRole,
} = require('../constants/customerNoteOptions');
const { sendMeetingNotification } = require('./customerMeetingNotificationService');

function normalizeText(value, max = 1000) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function normalizeLongText(value, max = 12000) {
  const text = String(value || '').trim();
  return text ? text.slice(0, max) : null;
}

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new AppError(400, 'INVALID_CUSTOMER_PHONE', 'Enter a valid customer phone number.');
  }
  return cleaned.startsWith('+') ? cleaned : digits;
}

function normalizeDateTime(value, code = 'INVALID_MEETING_AT', message = 'Enter a valid date and time.') {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, code, message);
  }
  return parsed.toISOString();
}

function normalizeUuid(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeUuidList(value) {
  if (value === undefined) return undefined;
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,;]+/g)
      .map(item => item.trim());
  const unique = [];
  const seen = new Set();
  for (const item of source) {
    const id = normalizeUuid(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function normalizeEmailList(value) {
  if (value === undefined) return undefined;
  const source = Array.isArray(value)
    ? value
    : String(value || '')
      .split(/[\n,;]+/g)
      .map(item => item.trim());
  const unique = [];
  const seen = new Set();
  for (const item of source) {
    const email = String(item || '').trim().toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError(400, 'INVALID_NOTIFICATION_EMAIL', `Invalid notification email: ${item}`);
    }
    if (seen.has(email)) continue;
    seen.add(email);
    unique.push(email);
  }
  return unique;
}

function sameEmailList(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameUuidList(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function actorRole(actor) {
  return String(actor?.role || '').trim().toLowerCase();
}

function isAdminActor(actor) {
  return ['super_admin', 'admin'].includes(actorRole(actor));
}

function isRmActor(actor) {
  return actorRole(actor) === 'rm';
}

function isMemberActor(actor) {
  return ['member', 'partner'].includes(actorRole(actor));
}

function effectiveApprovalStatus(status) {
  return status === 'rejected' ? 'rejected' : 'approved';
}

async function getUser(userId) {
  if (!userId) return null;
  const { rows: [user] } = await query(
    `SELECT id, full_name, email, phone, role::text AS role, report_to_id, status, deleted_at
       FROM users
      WHERE id = $1`,
    [userId],
  );
  return user || null;
}

async function requireAssignableUser(userId, expectedRole, code, message) {
  const user = await getUser(userId);
  if (!user || user.deleted_at || user.status !== 'active') {
    throw new AppError(400, code, message);
  }
  if (expectedRole && user.role !== expectedRole) {
    throw new AppError(400, code, message);
  }
  return user;
}

async function getLeadForScope(leadId) {
  if (!leadId) return null;
  const { rows: [lead] } = await query(
    `SELECT l.id,
            l.full_name,
            l.phone,
            l.email,
            l.assigned_to_user_id,
            assignee.full_name AS assigned_to_name,
            assignee.role::text AS assigned_to_role,
            assignee.report_to_id AS assigned_to_report_to_id
       FROM leads l
       LEFT JOIN users assignee ON assignee.id = l.assigned_to_user_id
      WHERE l.id = $1
        AND l.deleted_at IS NULL`,
    [leadId],
  );
  if (!lead) {
    throw new AppError(404, 'LEAD_NOT_FOUND', 'Lead not found.');
  }
  return lead;
}

function buildVisibilityClause(actor, params, options = {}) {
  const role = actorRole(actor);
  const visibleIds = getVisibleUserIds(actor);
  const includePendingForAdmin = options.includePendingForAdmin === true;

  if (['super_admin', 'admin'].includes(role)) {
    if (includePendingForAdmin) return 'n.deleted_at IS NULL';
    return 'n.deleted_at IS NULL';
  }

  if (role === 'rm') {
    const idx = pushParam(params, visibleIds || [actor.id]);
    return `
      n.deleted_at IS NULL
      AND (
        n.created_by_user_id = ANY($${idx}::uuid[])
        OR COALESCE(n.counselor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY($${idx}::uuid[])
        OR COALESCE(n.rm_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = ANY($${idx}::uuid[])
        OR EXISTS (
          SELECT 1
            FROM leads scope_lead
           WHERE scope_lead.id = n.lead_id
             AND scope_lead.assigned_to_user_id = ANY($${idx}::uuid[])
        )
      )
    `;
  }

  const selfIdx = pushParam(params, actor.id);
  return `
    n.deleted_at IS NULL
    AND (
      n.created_by_user_id = $${selfIdx}::uuid
      OR COALESCE(n.counselor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = $${selfIdx}::uuid
      OR $${selfIdx}::uuid = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
      OR EXISTS (
        SELECT 1
          FROM leads scope_lead
         WHERE scope_lead.id = n.lead_id
           AND scope_lead.assigned_to_user_id = $${selfIdx}::uuid
      )
    )
  `;
}

function pushParam(params, value) {
  params.push(value);
  return params.length;
}

function normalizeNotePayload(body = {}) {
  return {
    leadId: normalizeUuid(body.lead_id || body.leadId),
    customerPhone: normalizePhone(body.customer_phone || body.customerPhone),
    customerName: normalizeText(body.customer_name || body.customerName, 190),
    customerSecondName: normalizeText(body.customer_second_name || body.customerSecondName, 190),
    businessName: normalizeText(body.business_name || body.businessName, 190),
    aboutClient: normalizeLongText(body.about_client || body.aboutClient, 4000),
    clientServicesWant: normalizeLongText(body.client_services_want || body.clientServicesWant || body.client_services, 2000),
    clientBudget: normalizeText(body.client_budget || body.clientBudget, 190),
    meetingName: normalizeText(body.meeting_name || body.meetingName, 190),
    meetingAt: normalizeDateTime(body.meeting_at || body.meetingAt, 'INVALID_MEETING_AT', 'Enter a valid meeting date and time.'),
    meetingNotificationEmails: normalizeEmailList(body.meeting_notification_emails || body.meetingNotificationEmails),
    meetingCounselorUserIds: normalizeUuidList(body.meeting_counselor_user_ids || body.meetingCounselorUserIds),
    counselorUserId: normalizeUuid(body.counselor_user_id || body.counselorUserId),
    rmUserId: normalizeUuid(body.rm_user_id || body.rmUserId),
    initialEntryText: normalizeLongText(
      body.initial_entry_text
      || body.initialEntryText
      || body.note
      || body.remark
      || body.entry_text
      || body.entryText,
      12000,
    ),
  };
}

function normalizeEntryPayload(body = {}) {
  const entryText = normalizeLongText(body.entry_text || body.entryText || body.note || body.remark, 12000);
  if (!entryText) {
    throw new AppError(400, 'NOTE_ENTRY_REQUIRED', 'Enter note text before saving.');
  }
  return { entryText };
}

async function validateCreatePermission(actor, payload, lead, counselorUser, rmUser) {
  const meetingCounselorUsers = Array.isArray(payload.meetingCounselorUsers) ? payload.meetingCounselorUsers : [];
  if (isAdminActor(actor)) return;

  if (isRmActor(actor)) {
    if (rmUser && rmUser.id !== actor.id) {
      throw new AppError(403, 'RM_NOTE_SCOPE_DENIED', 'You can only assign notes to yourself as RM.');
    }
    if (counselorUser && counselorUser.report_to_id !== actor.id && counselorUser.id !== actor.id) {
      throw new AppError(403, 'RM_NOTE_SCOPE_DENIED', 'This counselor is not in your RM team.');
    }
    for (const meetingCounselorUser of meetingCounselorUsers) {
      if (meetingCounselorUser.report_to_id !== actor.id) {
        throw new AppError(403, 'RM_NOTE_SCOPE_DENIED', 'You can only schedule meetings for counselors in your RM team.');
      }
    }
    if (lead) {
      const assigneeId = lead.assigned_to_user_id || null;
      const assigneeReportToId = lead.assigned_to_report_to_id || null;
      if (assigneeId !== actor.id && assigneeReportToId !== actor.id) {
        throw new AppError(403, 'RM_NOTE_SCOPE_DENIED', 'You can only add notes for your team leads.');
      }
    }
    return;
  }

  if (!isMemberActor(actor)) {
    throw new AppError(403, 'NOTE_CREATE_FORBIDDEN', 'You are not allowed to create notes.');
  }

  if (counselorUser && counselorUser.id !== actor.id) {
    throw new AppError(403, 'COUNSELOR_NOTE_SCOPE_DENIED', 'You can only create notes as yourself.');
  }
  if (meetingCounselorUsers.some((entry) => entry.id !== actor.id)) {
    throw new AppError(403, 'COUNSELOR_NOTE_SCOPE_DENIED', 'You cannot assign meeting visibility to other counselors.');
  }

  if (lead && lead.assigned_to_user_id && lead.assigned_to_user_id !== actor.id) {
    throw new AppError(403, 'COUNSELOR_NOTE_SCOPE_DENIED', 'You can only create notes on your assigned leads.');
  }

  if (rmUser && rmUser.id !== actor.report_to_id) {
    throw new AppError(403, 'COUNSELOR_NOTE_SCOPE_DENIED', 'Select your reporting RM for this note.');
  }
}

function deriveApprovalState(actor) {
  return {
    approvalStatus: 'approved',
    approvedByUserId: actor.id,
    approvedAt: new Date().toISOString(),
    submittedToRmAt: null,
    rejectedByUserId: null,
    rejectedAt: null,
    rejectionNote: null,
  };
}

function hasMeetingSchedulingIntent(payload = {}) {
  return payload.meetingName !== null
    || payload.meetingAt !== null
    || payload.meetingNotificationEmails !== undefined
    || payload.meetingCounselorUserIds !== undefined;
}

function assertMeetingSchedulePermission(actor, payload = {}, existing = null) {
  const touchesMeetingFields = hasMeetingSchedulingIntent(payload)
    || Boolean(existing && hasMeetingSchedule(existing));
  if (touchesMeetingFields && !isRmActor(actor)) {
    throw new AppError(403, 'MEETING_SCHEDULE_FORBIDDEN', 'Only RM users can schedule or edit meetings.');
  }
}

async function mapNoteRow(row, actor) {
  if (!row) return null;
  const userIds = [row.created_by_user_id, row.updated_by_user_id, row.approved_by_user_id, row.rejected_by_user_id].filter(Boolean);
  const actorIds = getVisibleUserIds(actor) || [];
  const approvalStatus = effectiveApprovalStatus(row.approval_status);
  return {
    id: row.id,
    lead_id: row.lead_id,
    lead_name: row.lead_name || null,
    lead_phone: row.lead_phone || null,
    customer_phone: row.customer_phone,
    customer_name: row.customer_name,
    customer_second_name: row.customer_second_name,
    business_name: row.business_name,
    about_client: row.about_client,
    client_services_want: row.client_services_want,
    client_budget: row.client_budget,
    meeting_name: row.meeting_name,
    meeting_at: row.meeting_at,
    meeting_notification_emails: Array.isArray(row.meeting_notification_emails) ? row.meeting_notification_emails : [],
    meeting_counselor_user_ids: Array.isArray(row.meeting_counselor_user_ids) ? row.meeting_counselor_user_ids : [],
    meeting_counselor_names: Array.isArray(row.meeting_counselor_names) ? row.meeting_counselor_names : [],
    meeting_invite_sent_at: row.meeting_invite_sent_at || null,
    meeting_reminder_sent_at: row.meeting_reminder_sent_at || null,
    meeting_started_email_sent_at: row.meeting_started_email_sent_at || null,
    meeting_completed_at: row.meeting_completed_at || null,
    counselor_user_id: row.counselor_user_id,
    counselor_name: row.counselor_name || null,
    rm_user_id: row.rm_user_id,
    rm_name: row.rm_name || null,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name || null,
    updated_by_user_id: row.updated_by_user_id,
    updated_by_name: row.updated_by_name || null,
    approval_status: approvalStatus,
    submitted_to_rm_at: row.submitted_to_rm_at,
    approved_by_user_id: row.approved_by_user_id,
    approved_by_name: row.approved_by_name || null,
    approved_at: row.approved_at,
    rejected_by_user_id: row.rejected_by_user_id,
    rejected_by_name: row.rejected_by_name || null,
    rejected_at: row.rejected_at,
    rejection_note: row.rejection_note,
    latest_entry_text: row.latest_entry_text || null,
    latest_entry_author_name: row.latest_entry_author_name || null,
    latest_entry_created_at: row.latest_entry_created_at || null,
    last_activity_at: row.last_activity_at || row.updated_at || row.created_at,
    entries_count: Number(row.entries_count || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    permissions: {
      can_edit: isAdminActor(actor)
        || row.created_by_user_id === actor.id
        || row.rm_user_id === actor.id
        || row.counselor_user_id === actor.id
        || (isRmActor(actor) && actorIds.includes(row.created_by_user_id)),
      can_delete: isAdminActor(actor) || row.created_by_user_id === actor.id || row.rm_user_id === actor.id,
      can_approve: false,
      can_reject: false,
      can_add_entry: isAdminActor(actor)
        || row.created_by_user_id === actor.id
        || row.rm_user_id === actor.id
        || row.counselor_user_id === actor.id
        || (isRmActor(actor) && actorIds.includes(row.created_by_user_id)),
    },
  };
}

function hasMeetingSchedule(note) {
  return Boolean(note?.meeting_name && note?.meeting_at);
}

function shouldResetMeetingNotifications(existing, payload, counselorUser, rmUser) {
  const nextMeetingName = payload.meetingName === undefined
    ? existing.meeting_name
    : (payload.meetingName || null);
  const nextMeetingAt = payload.meetingAt === undefined
    ? existing.meeting_at
    : (payload.meetingAt || null);
  const nextCounselorId = counselorUser?.id || null;
  const nextRmId = rmUser?.id || null;
  const nextMeetingCounselorIds = payload.meetingCounselorUserIds === undefined
    ? (Array.isArray(existing.meeting_counselor_user_ids) ? existing.meeting_counselor_user_ids : [])
    : payload.meetingCounselorUserIds;
  const nextEmails = payload.meetingNotificationEmails === undefined
    ? (Array.isArray(existing.meeting_notification_emails) ? existing.meeting_notification_emails : [])
    : payload.meetingNotificationEmails;

  return nextMeetingName !== existing.meeting_name
    || nextMeetingAt !== existing.meeting_at
    || nextCounselorId !== (existing.counselor_user_id || null)
    || nextRmId !== (existing.rm_user_id || null)
    || !sameUuidList(nextMeetingCounselorIds, Array.isArray(existing.meeting_counselor_user_ids) ? existing.meeting_counselor_user_ids : [])
    || !sameEmailList(nextEmails, Array.isArray(existing.meeting_notification_emails) ? existing.meeting_notification_emails : []);
}

async function notifyMeetingScheduled(note) {
  if (!hasMeetingSchedule(note)) return;
  try {
    await sendMeetingNotification(note, 'scheduled');
  } catch (error) {
    logger.warn({ noteId: note.id, err: error.message }, '[CustomerMeeting] immediate schedule email failed');
  }
}

async function getNoteRowById(noteId, actor, options = {}) {
  const params = [noteId];
  const visibilitySql = buildVisibilityClause(actor, params, options);
  const { rows: [row] } = await query(
    `SELECT n.*,
            l.full_name AS lead_name,
            l.phone AS lead_phone,
            counselor.full_name AS counselor_name,
            ARRAY(
              SELECT u.full_name
                FROM users u
               WHERE u.id = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
                 AND u.deleted_at IS NULL
               ORDER BY u.full_name
            ) AS meeting_counselor_names,
            rm.full_name AS rm_name,
            creator.full_name AS created_by_name,
            updater.full_name AS updated_by_name,
            approver.full_name AS approved_by_name,
            rejector.full_name AS rejected_by_name,
            (
              SELECT COUNT(*)
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
            ) AS entries_count,
            (
              SELECT e.entry_text
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_text,
            (
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_created_at,
            (
              SELECT u.full_name
                FROM customer_note_entries e
                JOIN users u ON u.id = e.created_by_user_id
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_author_name,
            COALESCE((
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ), n.updated_at, n.created_at) AS last_activity_at
       FROM customer_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       LEFT JOIN users counselor ON counselor.id = n.counselor_user_id
       LEFT JOIN users rm ON rm.id = n.rm_user_id
       LEFT JOIN users creator ON creator.id = n.created_by_user_id
       LEFT JOIN users updater ON updater.id = n.updated_by_user_id
       LEFT JOIN users approver ON approver.id = n.approved_by_user_id
       LEFT JOIN users rejector ON rejector.id = n.rejected_by_user_id
      WHERE n.id = $1
        AND ${visibilitySql}`,
    params,
  );
  return row || null;
}

async function getNoteEntries(noteId) {
  const { rows } = await query(
    `SELECT e.id,
            e.note_id,
            e.entry_text,
            e.created_by_user_id,
            creator.full_name AS created_by_name,
            creator.role::text AS created_by_role,
            e.updated_by_user_id,
            updater.full_name AS updated_by_name,
            e.created_at,
            e.updated_at
       FROM customer_note_entries e
       LEFT JOIN users creator ON creator.id = e.created_by_user_id
       LEFT JOIN users updater ON updater.id = e.updated_by_user_id
      WHERE e.note_id = $1
        AND e.deleted_at IS NULL
      ORDER BY e.created_at ASC`,
    [noteId],
  );
  return rows.map(row => ({
    id: row.id,
    note_id: row.note_id,
    entry_text: row.entry_text,
    created_by_user_id: row.created_by_user_id,
    created_by_name: row.created_by_name || null,
    created_by_role: row.created_by_role || null,
    updated_by_user_id: row.updated_by_user_id,
    updated_by_name: row.updated_by_name || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function validateNoteParticipants(actor, payload, lead) {
  let counselorUser = null;
  let rmUser = null;
  let meetingCounselorUsers = [];

  const requestedMeetingCounselorIds = Array.isArray(payload.meetingCounselorUserIds)
    ? payload.meetingCounselorUserIds
    : [];
  if (requestedMeetingCounselorIds.length) {
    meetingCounselorUsers = await Promise.all(requestedMeetingCounselorIds.map(async (userId) => {
      const user = await requireAssignableUser(
        userId,
        null,
        'INVALID_COUNSELOR',
        'Select a valid counselor/member user.',
      );
      if (!['member', 'partner'].includes(user.role)) {
        throw new AppError(400, 'INVALID_COUNSELOR', 'Select a valid counselor/member user.');
      }
      return user;
    }));
  }

  if (payload.counselorUserId) {
    counselorUser = await requireAssignableUser(
      payload.counselorUserId,
      null,
      'INVALID_COUNSELOR',
      'Select a valid counselor/member user.',
    );
    if (!['member', 'partner'].includes(counselorUser.role)) {
      throw new AppError(400, 'INVALID_COUNSELOR', 'Select a valid counselor/member user.');
    }
  }
  if (!counselorUser && meetingCounselorUsers.length) {
    [counselorUser] = meetingCounselorUsers;
  }
  if (counselorUser && !meetingCounselorUsers.some((entry) => entry.id === counselorUser.id)) {
    meetingCounselorUsers = [counselorUser, ...meetingCounselorUsers];
  }

  if (payload.rmUserId) {
    rmUser = await requireAssignableUser(
      payload.rmUserId,
      'rm',
      'INVALID_RM',
      'Select a valid RM user.',
    );
  }

  if (!counselorUser && lead?.assigned_to_user_id) {
    const assignedUser = await getUser(lead.assigned_to_user_id);
    if (assignedUser && ['member', 'partner'].includes(assignedUser.role)) {
      counselorUser = assignedUser;
    }
  }

  if (!rmUser) {
    if (counselorUser?.report_to_id) {
      rmUser = await requireAssignableUser(
        counselorUser.report_to_id,
        'rm',
        'INVALID_RM',
        'Select a valid RM user.',
      );
    } else if (lead?.assigned_to_role === 'rm' && lead?.assigned_to_user_id) {
      rmUser = await requireAssignableUser(
        lead.assigned_to_user_id,
        'rm',
        'INVALID_RM',
        'Select a valid RM user.',
      );
    } else if (lead?.assigned_to_report_to_id) {
      rmUser = await requireAssignableUser(
        lead.assigned_to_report_to_id,
        'rm',
        'INVALID_RM',
        'Select a valid RM user.',
      );
    } else if (isMemberActor(actor) && actor.report_to_id) {
      rmUser = await requireAssignableUser(
        actor.report_to_id,
        'rm',
        'INVALID_RM',
        'Select a valid RM user.',
      );
    } else if (isRmActor(actor)) {
      rmUser = await requireAssignableUser(actor.id, 'rm', 'INVALID_RM', 'Select a valid RM user.');
    }
  }

  if (!counselorUser && isMemberActor(actor)) {
    counselorUser = await requireAssignableUser(actor.id, null, 'INVALID_COUNSELOR', 'Select a valid counselor/member user.');
    if (!meetingCounselorUsers.some((entry) => entry.id === counselorUser.id)) {
      meetingCounselorUsers = [counselorUser, ...meetingCounselorUsers];
    }
  }

  return { counselorUser, rmUser, meetingCounselorUsers };
}

async function createNote(actor, body) {
  const payload = normalizeNotePayload(body);
  assertMeetingSchedulePermission(actor, payload);
  if (!payload.customerPhone && !payload.leadId) {
    throw new AppError(400, 'CUSTOMER_PHONE_REQUIRED', 'Enter customer phone or link the note to a lead.');
  }

  const lead = payload.leadId ? await getLeadForScope(payload.leadId) : null;
  const { counselorUser, rmUser, meetingCounselorUsers } = await validateNoteParticipants(actor, payload, lead);
  await validateCreatePermission(actor, { ...payload, meetingCounselorUsers }, lead, counselorUser, rmUser);

  const customerPhone = payload.customerPhone || normalizePhone(lead?.phone);
  const customerName = payload.customerName || normalizeText(lead?.full_name, 190);
  if (!customerPhone) {
    throw new AppError(400, 'CUSTOMER_PHONE_REQUIRED', 'Enter customer phone before saving.');
  }
  if (!customerName) {
    throw new AppError(400, 'CUSTOMER_NAME_REQUIRED', 'Enter customer name before saving.');
  }
  if (!payload.initialEntryText) {
    throw new AppError(400, 'NOTE_ENTRY_REQUIRED', 'Write notes before saving.');
  }
  if (hasMeetingSchedulingIntent(payload) && !meetingCounselorUsers.length) {
    throw new AppError(400, 'MEETING_COUNSELOR_REQUIRED', 'Select at least one counselor/member for the meeting.');
  }

  const approvalState = deriveApprovalState(actor);

  const note = await withTransaction(async (client) => {
    const { rows: [created] } = await client.query(
      `INSERT INTO customer_notes (
         lead_id,
         customer_phone,
         customer_name,
         customer_second_name,
         business_name,
         about_client,
         client_services_want,
       client_budget,
       meeting_name,
       meeting_at,
       meeting_notification_emails,
       meeting_counselor_user_ids,
        counselor_user_id,
        rm_user_id,
        created_by_user_id,
         updated_by_user_id,
         approval_status,
         submitted_to_rm_at,
         approved_by_user_id,
         approved_at,
         rejected_by_user_id,
         rejected_at,
         rejection_note
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $15, $16, $17, $18, $19, $20, $21, $22
       )
       RETURNING id`,
      [
        lead?.id || null,
        customerPhone,
        customerName,
        payload.customerSecondName,
        payload.businessName,
        payload.aboutClient,
        payload.clientServicesWant,
        payload.clientBudget,
        payload.meetingName,
        payload.meetingAt,
        payload.meetingNotificationEmails || [],
        meetingCounselorUsers.map((entry) => entry.id),
        counselorUser?.id || null,
        rmUser?.id || null,
        actor.id,
        approvalState.approvalStatus,
        approvalState.submittedToRmAt,
        approvalState.approvedByUserId,
        approvalState.approvedAt,
        approvalState.rejectedByUserId,
        approvalState.rejectedAt,
        approvalState.rejectionNote,
      ],
    );

    await client.query(
      `INSERT INTO customer_note_entries (
         note_id,
         entry_text,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES ($1, $2, $3, $3)`,
      [created.id, payload.initialEntryText, actor.id],
    );

    return created;
  });

  const detail = await getNoteDetail(actor, note.id, { includePendingForAdmin: true });
  await notifyMeetingScheduled(detail);
  return detail;
}

async function listNotes(actor, rawQuery = {}) {
  const params = [];
  const where = [buildVisibilityClause(actor, params)];

  const q = normalizeText(rawQuery.q, 160);
  const approvalStatus = normalizeText(rawQuery.approval_status || rawQuery.approvalStatus, 64);
  const leadId = normalizeUuid(rawQuery.lead_id || rawQuery.leadId);
  const rmUserId = normalizeUuid(rawQuery.rm_user_id || rawQuery.rmUserId);
  const counselorUserId = normalizeUuid(rawQuery.counselor_user_id || rawQuery.counselorUserId);
  const createdByUserId = normalizeUuid(rawQuery.created_by_user_id || rawQuery.createdByUserId);
  const from = normalizeDateTime(rawQuery.from, 'INVALID_FROM_DATE', 'Enter a valid from date.');
  const to = normalizeDateTime(rawQuery.to, 'INVALID_TO_DATE', 'Enter a valid to date.');
  const page = Math.max(1, Number(rawQuery.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(rawQuery.page_size || rawQuery.pageSize || 20) || 20));

  if (q) {
    const idx = pushParam(params, `%${q.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(n.customer_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(n.customer_phone, '')) LIKE $${idx}
      OR LOWER(COALESCE(n.business_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(n.about_client, '')) LIKE $${idx}
      OR LOWER(COALESCE(n.client_services_want, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.full_name, '')) LIKE $${idx}
    )`);
  }

  if (approvalStatus) {
    if (!isCustomerNoteApprovalStatus(approvalStatus)) {
      throw new AppError(400, 'INVALID_APPROVAL_STATUS', 'Invalid approval status filter.');
    }
    where.push(`n.approval_status = $${pushParam(params, approvalStatus)}`);
  }
  if (leadId) where.push(`n.lead_id = $${pushParam(params, leadId)}::uuid`);
  if (rmUserId) where.push(`n.rm_user_id = $${pushParam(params, rmUserId)}::uuid`);
  if (createdByUserId) where.push(`n.created_by_user_id = $${pushParam(params, createdByUserId)}::uuid`);
  if (counselorUserId) {
    const counselorIdx = pushParam(params, counselorUserId);
    where.push(`(
      n.counselor_user_id = $${counselorIdx}::uuid
      OR $${counselorIdx}::uuid = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
    )`);
  }
  if (from) where.push(`COALESCE((SELECT MAX(e.created_at) FROM customer_note_entries e WHERE e.note_id = n.id AND e.deleted_at IS NULL), n.updated_at, n.created_at) >= $${pushParam(params, from)}::timestamptz`);
  if (to) where.push(`COALESCE((SELECT MAX(e.created_at) FROM customer_note_entries e WHERE e.note_id = n.id AND e.deleted_at IS NULL), n.updated_at, n.created_at) <= $${pushParam(params, to)}::timestamptz`);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * pageSize;
  const pageIdx = pushParam(params, pageSize);
  const offsetIdx = pushParam(params, offset);

  const { rows } = await query(
    `SELECT n.*,
            l.full_name AS lead_name,
            l.phone AS lead_phone,
            counselor.full_name AS counselor_name,
            ARRAY(
              SELECT u.full_name
                FROM users u
               WHERE u.id = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
                 AND u.deleted_at IS NULL
               ORDER BY u.full_name
            ) AS meeting_counselor_names,
            rm.full_name AS rm_name,
            creator.full_name AS created_by_name,
            updater.full_name AS updated_by_name,
            approver.full_name AS approved_by_name,
            rejector.full_name AS rejected_by_name,
            (
              SELECT COUNT(*)
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
            ) AS entries_count,
            (
              SELECT e.entry_text
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_text,
            (
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_created_at,
            (
              SELECT u.full_name
                FROM customer_note_entries e
                JOIN users u ON u.id = e.created_by_user_id
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_author_name,
            COALESCE((
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ), n.updated_at, n.created_at) AS last_activity_at,
            COUNT(*) OVER()::int AS total_count
       FROM customer_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       LEFT JOIN users counselor ON counselor.id = n.counselor_user_id
       LEFT JOIN users rm ON rm.id = n.rm_user_id
       LEFT JOIN users creator ON creator.id = n.created_by_user_id
       LEFT JOIN users updater ON updater.id = n.updated_by_user_id
       LEFT JOIN users approver ON approver.id = n.approved_by_user_id
       LEFT JOIN users rejector ON rejector.id = n.rejected_by_user_id
       ${whereSql}
      ORDER BY last_activity_at DESC, n.created_at DESC
      LIMIT $${pageIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const total = rows[0]?.total_count ? Number(rows[0].total_count) : 0;
  const mappedRows = await Promise.all(rows.map(row => mapNoteRow(row, actor)));
  return {
    rows: mappedRows,
    total,
    page,
    pageSize,
  };
}

async function listUpcomingMeetings(actor, rawQuery = {}) {
  const params = [];
  const where = [
    `n.deleted_at IS NULL`,
    `n.meeting_at IS NOT NULL`,
    `n.meeting_name IS NOT NULL`,
    `n.meeting_completed_at IS NULL`,
    `n.meeting_at >= NOW()`,
  ];

  const rmUserId = normalizeUuid(rawQuery.rm_user_id || rawQuery.rmUserId);
  const counselorUserId = normalizeUuid(rawQuery.counselor_user_id || rawQuery.counselorUserId);
  const limit = Math.min(100, Math.max(1, Number(rawQuery.limit || 20) || 20));

  if (isAdminActor(actor)) {
    // Admin and super admin can see every scheduled meeting unless further filtered below.
  } else if (isRmActor(actor)) {
    where.push(`n.rm_user_id = $${pushParam(params, actor.id)}::uuid`);
  } else {
    const actorIdx = pushParam(params, actor.id);
    where.push(`(
      n.created_by_user_id = $${actorIdx}::uuid
      OR COALESCE(n.counselor_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = $${actorIdx}::uuid
      OR $${actorIdx}::uuid = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
    )`);
  }

  if (rmUserId) where.push(`n.rm_user_id = $${pushParam(params, rmUserId)}::uuid`);
  if (counselorUserId) {
    const counselorIdx = pushParam(params, counselorUserId);
    where.push(`(
      n.counselor_user_id = $${counselorIdx}::uuid
      OR $${counselorIdx}::uuid = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
    )`);
  }

  const { rows } = await query(
    `SELECT n.*,
            l.full_name AS lead_name,
            l.phone AS lead_phone,
            counselor.full_name AS counselor_name,
            ARRAY(
              SELECT u.full_name
                FROM users u
               WHERE u.id = ANY(COALESCE(n.meeting_counselor_user_ids, ARRAY[]::uuid[]))
                 AND u.deleted_at IS NULL
               ORDER BY u.full_name
            ) AS meeting_counselor_names,
            rm.full_name AS rm_name,
            creator.full_name AS created_by_name,
            updater.full_name AS updated_by_name,
            approver.full_name AS approved_by_name,
            rejector.full_name AS rejected_by_name,
            (
              SELECT COUNT(*)
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
            ) AS entries_count,
            (
              SELECT e.entry_text
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_text,
            (
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_created_at,
            (
              SELECT u.full_name
                FROM customer_note_entries e
                JOIN users u ON u.id = e.created_by_user_id
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ) AS latest_entry_author_name,
            COALESCE((
              SELECT e.created_at
                FROM customer_note_entries e
               WHERE e.note_id = n.id
                 AND e.deleted_at IS NULL
               ORDER BY e.created_at DESC
               LIMIT 1
            ), n.updated_at, n.created_at) AS last_activity_at
       FROM customer_notes n
       LEFT JOIN leads l ON l.id = n.lead_id
       LEFT JOIN users counselor ON counselor.id = n.counselor_user_id
       LEFT JOIN users rm ON rm.id = n.rm_user_id
       LEFT JOIN users creator ON creator.id = n.created_by_user_id
       LEFT JOIN users updater ON updater.id = n.updated_by_user_id
       LEFT JOIN users approver ON approver.id = n.approved_by_user_id
       LEFT JOIN users rejector ON rejector.id = n.rejected_by_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY n.meeting_at ASC, last_activity_at DESC
      LIMIT $${pushParam(params, limit)}`,
    params,
  );

  return Promise.all(rows.map(row => mapNoteRow(row, actor)));
}

async function getNoteDetail(actor, noteId, options = {}) {
  const row = await getNoteRowById(noteId, actor, options);
  if (!row) {
    throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  }
  const note = await mapNoteRow(row, actor);
  note.entries = await getNoteEntries(noteId);
  return note;
}

async function assertCanMutate(actor, note, action = 'edit') {
  if (isAdminActor(actor)) return;
  if (note.created_by_user_id === actor.id) return;
  if (note.rm_user_id === actor.id) return;
  if (action === 'entry' && note.counselor_user_id === actor.id) return;
  if (isRmActor(actor)) {
    const visibleIds = getVisibleUserIds(actor) || [actor.id];
    if (visibleIds.includes(note.created_by_user_id) || visibleIds.includes(note.counselor_user_id)) return;
  }
  throw new AppError(403, 'NOTE_EDIT_FORBIDDEN', 'You do not have permission to change this note.');
}

async function updateNote(actor, noteId, body) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  await assertCanMutate(actor, existing);

  const payload = normalizeNotePayload(body);
  assertMeetingSchedulePermission(actor, payload, existing);
  const lead = payload.leadId ? await getLeadForScope(payload.leadId) : (existing.lead_id ? await getLeadForScope(existing.lead_id) : null);
  const { counselorUser, rmUser, meetingCounselorUsers } = await validateNoteParticipants(actor, {
    ...payload,
    meetingCounselorUserIds: payload.meetingCounselorUserIds !== undefined
      ? payload.meetingCounselorUserIds
      : (
        Array.isArray(existing.meeting_counselor_user_ids) && existing.meeting_counselor_user_ids.length
          ? existing.meeting_counselor_user_ids
          : (existing.counselor_user_id ? [existing.counselor_user_id] : [])
      ),
    counselorUserId: payload.counselorUserId || existing.counselor_user_id,
    rmUserId: payload.rmUserId || existing.rm_user_id,
  }, lead);

  await validateCreatePermission(actor, {
    ...payload,
    meetingCounselorUsers,
    counselorUserId: counselorUser?.id || null,
    rmUserId: rmUser?.id || null,
  }, lead, counselorUser, rmUser);

  const customerPhone = payload.customerPhone || existing.customer_phone || normalizePhone(lead?.phone);
  const customerName = payload.customerName || existing.customer_name || normalizeText(lead?.full_name, 190);
  if (!customerPhone) throw new AppError(400, 'CUSTOMER_PHONE_REQUIRED', 'Enter customer phone before saving.');
  if (!customerName) throw new AppError(400, 'CUSTOMER_NAME_REQUIRED', 'Enter customer name before saving.');
  if ((hasMeetingSchedulingIntent(payload) || hasMeetingSchedule(existing)) && !meetingCounselorUsers.length) {
    throw new AppError(400, 'MEETING_COUNSELOR_REQUIRED', 'Select at least one counselor/member for the meeting.');
  }

  const approvalState = deriveApprovalState(actor);
  const effectiveMeetingCounselorIds = payload.meetingCounselorUserIds !== undefined
    ? meetingCounselorUsers.map((entry) => entry.id)
    : (Array.isArray(existing.meeting_counselor_user_ids) ? existing.meeting_counselor_user_ids : []);
  const resetMeetingNotifications = shouldResetMeetingNotifications(
    existing,
    { ...payload, meetingCounselorUserIds: effectiveMeetingCounselorIds },
    counselorUser,
    rmUser,
  );

  await query(
    `UPDATE customer_notes
        SET lead_id = $2,
            customer_phone = $3,
            customer_name = $4,
            customer_second_name = $5,
            business_name = $6,
            about_client = $7,
            client_services_want = $8,
            client_budget = $9,
            meeting_name = $10,
            meeting_at = $11,
            meeting_notification_emails = $12,
            meeting_counselor_user_ids = $13,
            counselor_user_id = $14,
            rm_user_id = $15,
            updated_by_user_id = $16,
            updated_at = NOW(),
            approval_status = $17,
            submitted_to_rm_at = $18,
            approved_by_user_id = $19,
            approved_at = $20,
            rejected_by_user_id = $21,
            rejected_at = $22,
            rejection_note = $23,
            meeting_invite_sent_at = CASE WHEN $24::boolean THEN NULL ELSE meeting_invite_sent_at END,
            meeting_reminder_sent_at = CASE WHEN $24::boolean THEN NULL ELSE meeting_reminder_sent_at END,
            meeting_started_email_sent_at = CASE WHEN $24::boolean THEN NULL ELSE meeting_started_email_sent_at END,
            meeting_completed_at = CASE WHEN $24::boolean THEN NULL ELSE meeting_completed_at END
      WHERE id = $1`,
    [
      noteId,
      payload.leadId === undefined ? existing.lead_id : (payload.leadId || null),
      customerPhone,
      customerName,
      payload.customerSecondName === null ? null : (payload.customerSecondName || existing.customer_second_name),
      payload.businessName === null ? null : (payload.businessName || existing.business_name),
      payload.aboutClient === null ? null : (payload.aboutClient || existing.about_client),
      payload.clientServicesWant === null ? null : (payload.clientServicesWant || existing.client_services_want),
      payload.clientBudget === null ? null : (payload.clientBudget || existing.client_budget),
      payload.meetingName === null ? null : (payload.meetingName || existing.meeting_name),
      payload.meetingAt === null ? null : (payload.meetingAt || existing.meeting_at),
      payload.meetingNotificationEmails === undefined
        ? (Array.isArray(existing.meeting_notification_emails) ? existing.meeting_notification_emails : [])
        : payload.meetingNotificationEmails,
      effectiveMeetingCounselorIds,
      counselorUser?.id || null,
      rmUser?.id || null,
      actor.id,
      approvalState.approvalStatus,
      approvalState.submittedToRmAt,
      approvalState.approvedByUserId,
      approvalState.approvedAt,
      approvalState.rejectedByUserId,
      approvalState.rejectedAt,
      approvalState.rejectionNote,
      resetMeetingNotifications,
    ],
  );

  const detail = await getNoteDetail(actor, noteId, { includePendingForAdmin: true });
  if (resetMeetingNotifications || (!detail.meeting_invite_sent_at && hasMeetingSchedule(detail))) {
    await notifyMeetingScheduled(detail);
  }
  return detail;
}

async function deleteNote(actor, noteId) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  await assertCanMutate(actor, existing, 'delete');
  await query(
    `UPDATE customer_notes
        SET deleted_at = NOW(),
            deleted_by_user_id = $2,
            updated_by_user_id = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [noteId, actor.id],
  );
  return { success: true };
}

async function addEntry(actor, noteId, body) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  await assertCanMutate(actor, existing, 'entry');
  const { entryText } = normalizeEntryPayload(body);
  const approvalState = deriveApprovalState(actor);

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO customer_note_entries (
         note_id,
         entry_text,
         created_by_user_id,
         updated_by_user_id
       )
       VALUES ($1, $2, $3, $3)`,
      [noteId, entryText, actor.id],
    );

    await client.query(
      `UPDATE customer_notes
          SET updated_by_user_id = $2,
              updated_at = NOW(),
              approval_status = $3,
              submitted_to_rm_at = $4,
              approved_by_user_id = $5,
              approved_at = $6,
              rejected_by_user_id = $7,
              rejected_at = $8,
              rejection_note = $9
        WHERE id = $1`,
      [
        noteId,
        actor.id,
        approvalState.approvalStatus,
        approvalState.submittedToRmAt,
        approvalState.approvedByUserId,
        approvalState.approvedAt,
        approvalState.rejectedByUserId,
        approvalState.rejectedAt,
        approvalState.rejectionNote,
      ],
    );
  });

  return getNoteDetail(actor, noteId, { includePendingForAdmin: true });
}

async function updateEntry(actor, noteId, entryId, body) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  await assertCanMutate(actor, existing, 'entry');
  const { entryText } = normalizeEntryPayload(body);
  const { rows: [entry] } = await query(
    `SELECT id, note_id, created_by_user_id
       FROM customer_note_entries
      WHERE id = $1
        AND note_id = $2
        AND deleted_at IS NULL`,
    [entryId, noteId],
  );
  if (!entry) throw new AppError(404, 'NOTE_ENTRY_NOT_FOUND', 'Note entry not found.');
  if (!isAdminActor(actor) && entry.created_by_user_id !== actor.id && existing.rm_user_id !== actor.id) {
    throw new AppError(403, 'NOTE_ENTRY_EDIT_FORBIDDEN', 'You do not have permission to edit this entry.');
  }

  const approvalState = deriveApprovalState(actor);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE customer_note_entries
          SET entry_text = $3,
              updated_by_user_id = $4,
              updated_at = NOW()
        WHERE id = $1
          AND note_id = $2`,
      [entryId, noteId, entryText, actor.id],
    );
    await client.query(
      `UPDATE customer_notes
          SET updated_by_user_id = $2,
              updated_at = NOW(),
              approval_status = $3,
              submitted_to_rm_at = $4,
              approved_by_user_id = $5,
              approved_at = $6,
              rejected_by_user_id = $7,
              rejected_at = $8,
              rejection_note = $9
        WHERE id = $1`,
      [
        noteId,
        actor.id,
        approvalState.approvalStatus,
        approvalState.submittedToRmAt,
        approvalState.approvedByUserId,
        approvalState.approvedAt,
        approvalState.rejectedByUserId,
        approvalState.rejectedAt,
        approvalState.rejectionNote,
      ],
    );
  });
  return getNoteDetail(actor, noteId, { includePendingForAdmin: true });
}

async function deleteEntry(actor, noteId, entryId) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  await assertCanMutate(actor, existing, 'entry');

  const { rows: [entry] } = await query(
    `SELECT id, note_id, created_by_user_id
       FROM customer_note_entries
      WHERE id = $1
        AND note_id = $2
        AND deleted_at IS NULL`,
    [entryId, noteId],
  );
  if (!entry) throw new AppError(404, 'NOTE_ENTRY_NOT_FOUND', 'Note entry not found.');
  if (!isAdminActor(actor) && entry.created_by_user_id !== actor.id && existing.rm_user_id !== actor.id) {
    throw new AppError(403, 'NOTE_ENTRY_DELETE_FORBIDDEN', 'You do not have permission to delete this entry.');
  }

  const { rows: [{ remaining = 0 } = {}] } = await query(
    `SELECT COUNT(*)::int AS remaining
       FROM customer_note_entries
      WHERE note_id = $1
        AND deleted_at IS NULL`,
    [noteId],
  );
  if (Number(remaining) <= 1) {
    throw new AppError(400, 'NOTE_ENTRY_REQUIRED', 'A note must keep at least one entry.');
  }

  const approvalState = deriveApprovalState(actor);
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE customer_note_entries
          SET deleted_at = NOW(),
              updated_by_user_id = $3,
              updated_at = NOW()
        WHERE id = $1
          AND note_id = $2`,
      [entryId, noteId, actor.id],
    );
    await client.query(
      `UPDATE customer_notes
          SET updated_by_user_id = $2,
              updated_at = NOW(),
              approval_status = $3,
              submitted_to_rm_at = $4,
              approved_by_user_id = $5,
              approved_at = $6,
              rejected_by_user_id = $7,
              rejected_at = $8,
              rejection_note = $9
        WHERE id = $1`,
      [
        noteId,
        actor.id,
        approvalState.approvalStatus,
        approvalState.submittedToRmAt,
        approvalState.approvedByUserId,
        approvalState.approvedAt,
        approvalState.rejectedByUserId,
        approvalState.rejectedAt,
        approvalState.rejectionNote,
      ],
    );
  });
  return getNoteDetail(actor, noteId, { includePendingForAdmin: true });
}

async function approveNote(actor, noteId) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  if (!isAdminActor(actor) && !isRmActor(actor)) {
    throw new AppError(403, 'NOTE_APPROVE_FORBIDDEN', 'You do not have permission to approve notes.');
  }
  if (isRmActor(actor) && existing.rm_user_id && existing.rm_user_id !== actor.id) {
    throw new AppError(403, 'NOTE_APPROVE_FORBIDDEN', 'You can only approve notes assigned to you.');
  }

  await query(
    `UPDATE customer_notes
        SET approval_status = 'approved',
            approved_by_user_id = $2,
            approved_at = NOW(),
            rejected_by_user_id = NULL,
            rejected_at = NULL,
            rejection_note = NULL,
            updated_by_user_id = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [noteId, actor.id],
  );

  return getNoteDetail(actor, noteId, { includePendingForAdmin: true });
}

async function rejectNote(actor, noteId, rejectionNote) {
  const existing = await getNoteRowById(noteId, actor, { includePendingForAdmin: true });
  if (!existing) throw new AppError(404, 'NOTE_NOT_FOUND', 'Note not found.');
  if (!isAdminActor(actor) && !isRmActor(actor)) {
    throw new AppError(403, 'NOTE_REJECT_FORBIDDEN', 'You do not have permission to reject notes.');
  }
  if (isRmActor(actor) && existing.rm_user_id && existing.rm_user_id !== actor.id) {
    throw new AppError(403, 'NOTE_REJECT_FORBIDDEN', 'You can only reject notes assigned to you.');
  }

  const normalizedRejectionNote = normalizeLongText(rejectionNote, 2000);
  await query(
    `UPDATE customer_notes
        SET approval_status = 'rejected',
            rejected_by_user_id = $2,
            rejected_at = NOW(),
            rejection_note = $3,
            approved_by_user_id = NULL,
            approved_at = NULL,
            updated_by_user_id = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [noteId, actor.id, normalizedRejectionNote],
  );
  return getNoteDetail(actor, noteId, { includePendingForAdmin: true });
}

async function lookupLeads(actor, rawQuery = {}) {
  const q = normalizeText(rawQuery.q, 120);
  if (!q || q.length < 2) return [];
  const params = [`%${q.toLowerCase()}%`];
  const where = [
    `l.deleted_at IS NULL`,
    `(LOWER(COALESCE(l.full_name, '')) LIKE $1 OR LOWER(COALESCE(l.phone, '')) LIKE $1 OR LOWER(COALESCE(l.email, '')) LIKE $1)`,
  ];

  if (!isAdminActor(actor)) {
    if (isRmActor(actor)) {
      const visibleIds = getVisibleUserIds(actor) || [actor.id];
      params.push(visibleIds);
      where.push(`l.assigned_to_user_id = ANY($${params.length}::uuid[])`);
    } else {
      params.push(actor.id);
      where.push(`l.assigned_to_user_id = $${params.length}::uuid`);
    }
  }

  const { rows } = await query(
    `SELECT l.id,
            l.full_name,
            l.phone,
            l.email,
            l.source::text AS source,
            l.category,
            assignee.full_name AS assigned_to_name
       FROM leads l
       LEFT JOIN users assignee ON assignee.id = l.assigned_to_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY l.updated_at DESC, l.created_at DESC
      LIMIT 10`,
    params,
  );
  return rows;
}

async function lookupUsers(actor, rawQuery = {}) {
  const roleFilter = normalizeText(rawQuery.role, 32);
  const q = normalizeText(rawQuery.q, 120);
  const rmUserId = normalizeUuid(rawQuery.rm_user_id || rawQuery.rmUserId || rawQuery.report_to_id || rawQuery.reportToId);
  if (roleFilter && !isCustomerNoteUserRole(roleFilter)) {
    throw new AppError(400, 'INVALID_USER_LOOKUP_ROLE', 'Invalid user lookup role.');
  }

  const params = [];
  const where = [
    `u.deleted_at IS NULL`,
    `u.status = 'active'`,
  ];

  if (roleFilter) {
    if (roleFilter === 'member') {
      where.push(`u.role::text IN ('member', 'partner')`);
    } else {
      where.push(`u.role::text = $${pushParam(params, roleFilter)}`);
    }
  } else {
    where.push(`u.role::text IN ('rm', 'member', 'partner')`);
  }

  if (q) {
    const idx = pushParam(params, `%${q.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(u.full_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(u.email, '')) LIKE $${idx}
      OR LOWER(COALESCE(u.phone, '')) LIKE $${idx}
    )`);
  }

  if (isRmActor(actor)) {
    if (roleFilter === 'rm') {
      where.push(`u.id = $${pushParam(params, actor.id)}::uuid`);
    } else {
      const visibleIds = getVisibleUserIds(actor) || [actor.id];
      where.push(`u.id = ANY($${pushParam(params, visibleIds)}::uuid[])`);
    }
    if (rmUserId && rmUserId !== actor.id) {
      throw new AppError(403, 'USER_LOOKUP_SCOPE_DENIED', 'You can only view counselors from your own RM team.');
    }
  } else if (isMemberActor(actor)) {
    if (roleFilter === 'rm') {
      where.push(`u.id = $${pushParam(params, actor.report_to_id || actor.id)}::uuid`);
    } else {
      where.push(`u.id = $${pushParam(params, actor.id)}::uuid`);
    }
  } else if (rmUserId && (roleFilter === 'member' || roleFilter === 'partner' || !roleFilter)) {
    where.push(`u.report_to_id = $${pushParam(params, rmUserId)}::uuid`);
  }

  if (rmUserId && roleFilter === 'rm') {
    where.push(`u.id = $${pushParam(params, rmUserId)}::uuid`);
  }

  const { rows } = await query(
    `SELECT u.id,
            u.full_name,
            u.email,
            u.phone,
            CASE WHEN u.role::text = 'partner' THEN 'member' ELSE u.role::text END AS role,
            u.report_to_id,
            manager.full_name AS manager_name
       FROM users u
       LEFT JOIN users manager ON manager.id = u.report_to_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.full_name ASC
      LIMIT 50`,
    params,
  );
  return rows;
}

module.exports = {
  listNotes,
  listUpcomingMeetings,
  createNote,
  getNoteDetail,
  updateNote,
  deleteNote,
  addEntry,
  updateEntry,
  deleteEntry,
  approveNote,
  rejectNote,
  lookupLeads,
  lookupUsers,
};
