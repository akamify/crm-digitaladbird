const { query } = require('../../config/database');
const logger = require('../../utils/logger');
const emailNotificationService = require('../email/emailNotificationService');
const templates = require('./notificationTemplates');
const recipients = require('./notificationRecipients');

function runnerQuery(runner, sql, params = []) {
  if (runner?.query) return runner.query(sql, params);
  return query(sql, params);
}

function emitNotification(userId, notification) {
  try {
    const { emitToUser } = require('../socketService');
    emitToUser(userId, 'notification:new', notification);
    emitToUser(userId, 'notification:unread_count', { increment: 1 });
  } catch (_) {
    // Realtime fanout is best effort; persisted notification is source of truth.
  }
}

function json(value) {
  return JSON.stringify(value || {});
}

async function createUserNotification({
  userId,
  type,
  title,
  body = null,
  metadata = {},
  eventType = null,
  entityType = null,
  entityId = null,
  dedupeKey = null,
  email = null,
  emailType = null,
  emailEnabled = true,
}, runner = null) {
  if (!userId || !type || !title) return null;
  try {
    const sql = dedupeKey
      ? `INSERT INTO user_notifications(user_id, type, title, body, metadata, event_type, entity_type, entity_id, dedupe_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
           RETURNING *`
      : `INSERT INTO user_notifications(user_id, type, title, body, metadata, event_type, entity_type, entity_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`;
    const params = dedupeKey
      ? [userId, type, title, body, json(metadata), eventType || type, entityType, entityId, dedupeKey]
      : [userId, type, title, body, json(metadata), eventType || type, entityType, entityId];
    const { rows: [created] } = await runnerQuery(runner, sql, params);
    if (!created) return null;
    emitNotification(userId, created);

    if (emailEnabled && email && emailType) {
      const user = await recipients.getUser(userId);
      const result = await emailNotificationService.sendNotificationEmail({
        user,
        emailType,
        subject: email.subject,
        html: email.html,
        text: email.text,
        metadata: { notification_id: created.id, ...metadata },
      });
      await query(
        `UPDATE user_notifications
            SET email_status = $2,
                email_sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE email_sent_at END
          WHERE id = $1`,
        [created.id, result.status],
      ).catch(() => {});
    }
    return created;
  } catch (err) {
    logger.warn({ err: err.message, userId, type }, '[Notification] user notification skipped');
    return null;
  }
}

async function notifyUser(userId, type, title, body, metadata = {}, runner = null) {
  return createUserNotification({ userId, type, title, body, metadata }, runner);
}

async function notifyUsers(userIds, type, title, body, metadata = {}, runner = null) {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean))];
  for (const userId of uniqueIds) {
    await notifyUser(userId, type, title, body, metadata, runner);
  }
}

async function notifyAdmins(type, title, body, metadata = {}, runner = null) {
  try {
    await runnerQuery(
      runner,
      `INSERT INTO admin_notifications(type, title, body, metadata)
       VALUES ($1, $2, $3, $4)`,
      [type, title, body || null, json(metadata)],
    );
  } catch (err) {
    logger.warn({ err: err.message, type }, '[Notification] admin notification skipped');
  }
  const admins = await recipients.getAdminsAndSuperAdmins(runner);
  for (const admin of admins) {
    await createUserNotification({
      userId: admin.id,
      type,
      title,
      body,
      metadata,
      eventType: metadata.event_type || type,
      dedupeKey: metadata.dedupe_key ? `${metadata.dedupe_key}:${admin.id}` : null,
    }, runner);
  }
}

async function fetchLeadsForNotification(leadIds = [], runner = null) {
  const ids = [...new Set((leadIds || []).filter(Boolean))];
  if (!ids.length) return [];
  try {
    const { rows } = await runnerQuery(
      runner,
      `SELECT l.id, l.full_name, l.phone, l.source, l.campaign_name,
              l.meta_campaign_id, l.campaign_label, l.meta_form_id,
              l.form_name, l.category, l.category_source,
              f.form_name AS meta_form_name
         FROM leads l
         LEFT JOIN meta_forms f ON f.form_id = l.meta_form_id
        WHERE l.id = ANY($1::uuid[])`,
      [ids],
    );
    return rows;
  } catch (err) {
    logger.warn({ err: err.message }, '[Notification] lead lookup skipped');
    return [];
  }
}

function categoryBreakdown(leads = []) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  return safeLeads.reduce((acc, lead = {}) => {
    const key = ['trader', 'partner'].includes(lead.category) ? lead.category : 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { trader: 0, partner: 0, unknown: 0 });
}

function dominantCategory(breakdown) {
  const active = Object.entries(breakdown || {}).filter(([, count]) => Number(count) > 0);
  return active.length === 1 ? active[0][0] : null;
}

function leadMetadata({ leads, leadIds, count, metadata, extra = {} }) {
  const safeLeads = Array.isArray(leads) ? leads : [];
  const first = safeLeads[0] || {};
  const breakdown = categoryBreakdown(safeLeads);
  const category = dominantCategory(breakdown) || first.category || metadata.lead_category || 'unknown';
  return {
    event_type: extra.eventType || metadata.event_type || null,
    lead_ids: leadIds,
    lead_count: count,
    lead_id: leadIds.length === 1 ? leadIds[0] : null,
    lead_name: first.full_name || null,
    lead_phone: first.phone || null,
    lead_category: category,
    lead_category_label: templates.categoryLabel(category),
    category_breakdown: breakdown,
    campaign_name: first.campaign_name || first.campaign_label || metadata.campaign_name || null,
    meta_campaign_id: first.meta_campaign_id || metadata.meta_campaign_id || null,
    meta_form_id: first.meta_form_id || metadata.meta_form_id || null,
    source: first.source || metadata.source || null,
    created_at: new Date().toISOString(),
    ...metadata,
    ...extra,
  };
}

async function notifyLeadsAssigned(input, runner = null) {
  const assignedToUserId = input.assignedToUserId || input.userId;
  const count = Number(input.count || input.leadIds?.length || 0);
  if (!assignedToUserId || count <= 0) return null;

  const assignedUser = await recipients.getUser(assignedToUserId, runner);
  if (!recipients.isActiveRecipient(assignedUser) || !['member', 'partner'].includes(assignedUser.role)) return null;

  const leadIds = [...new Set((input.leadIds || input.lead_ids || [input.leadId || input.lead_id]).filter(Boolean))];
  const leads = input.leads || await fetchLeadsForNotification(leadIds, runner);
  const breakdown = categoryBreakdown(leads);
  const category = dominantCategory(breakdown) || input.metadata?.lead_category || 'unknown';
  const tpl = templates.leadsAssigned({
    count,
    category,
    categoryBreakdown: dominantCategory(breakdown) ? null : breakdown,
    memberName: assignedUser.full_name,
    assignmentSource: input.assignmentSource || input.assignment_type || input.metadata?.assignment_type,
  });
  const baseMeta = leadMetadata({
    leads,
    leadIds,
    count,
    metadata: input.metadata || {},
    extra: {
      eventType: 'leads_assigned',
      assigned_to_user_id: assignedToUserId,
      assigned_by: input.assignedBy || input.assigned_by || input.metadata?.assigned_by || null,
      assignment_source: input.assignmentSource || input.assignment_type || input.metadata?.assignment_type || null,
    },
  });
  const dedupeBase = input.dedupeKey || `leads_assigned:${baseMeta.assignment_source || 'manual'}:${leadIds.join(',') || count}:${assignedToUserId}`;

  await createUserNotification({
    userId: assignedToUserId,
    type: 'leads_assigned',
    title: tpl.title,
    body: tpl.body,
    metadata: baseMeta,
    eventType: 'leads_assigned',
    entityType: leadIds.length === 1 ? 'lead' : 'lead_batch',
    entityId: leadIds.length === 1 ? leadIds[0] : null,
    dedupeKey: dedupeBase,
    email: tpl.email,
    emailType: tpl.emailType,
  }, runner);

  const rm = await recipients.getUserRm(assignedToUserId, runner);
  if (rm) {
    await createUserNotification({
      userId: rm.id,
      type: 'leads_assigned',
      title: 'Leads Assigned to Team Member',
      body: `${count} lead(s) assigned to ${assignedUser.full_name}.`,
      metadata: { ...baseMeta, rm_user_id: rm.id },
      eventType: 'leads_assigned',
      dedupeKey: `${dedupeBase}:rm:${rm.id}`,
      email: templates.shell({
        title: `Team update: ${count} lead(s) assigned to ${assignedUser.full_name}`,
        body: `${count} lead(s) were assigned to ${assignedUser.full_name}.`,
        actionUrl: templates.frontendUrl('/leads'),
      }),
      emailType: 'leads_assigned',
    }, runner);
  }

  const shouldNotifyAdmins = ['manual', 'manual_reassign', 'auto', 'request_fulfillment', 'lead_request', 'lead_request_round_robin', 'rm_manual'].includes(baseMeta.assignment_source);
  if (shouldNotifyAdmins) {
    const admins = await recipients.getAdminsAndSuperAdmins(runner);
    for (const admin of recipients.dedupeRecipients(admins)) {
      await createUserNotification({
        userId: admin.id,
        type: baseMeta.assignment_source === 'auto' ? 'auto_leads_distributed' : 'bulk_leads_assigned',
        title: tpl.adminTitle,
        body: tpl.adminBody,
        metadata: baseMeta,
        eventType: baseMeta.assignment_source === 'auto' ? 'auto_leads_distributed' : 'bulk_leads_assigned',
        dedupeKey: `${dedupeBase}:admin:${admin.id}`,
      }, runner);
    }
  }
  const userSheets = require('../userGoogleSheetsService');
  await Promise.all(leadIds.map(leadId => userSheets.enqueueLeadSync(leadId, {
    eventType: 'lead_assigned',
    source: baseMeta.assignment_source || 'assignment',
    userId: baseMeta.assigned_by,
  })));
  return true;
}

async function notifyLeadsReassigned(input, runner = null) {
  const oldUserId = input.oldAssigneeUserId || input.old_assignee_user_id || input.previousUserId;
  const newUserId = input.newAssigneeUserId || input.new_assignee_user_id || input.assignedToUserId || input.userId;
  const leadIds = [...new Set((input.leadIds || input.lead_ids || [input.leadId || input.lead_id]).filter(Boolean))];
  const count = Number(input.count || leadIds.length || 0);
  if (!oldUserId || !newUserId || oldUserId === newUserId || count <= 0) return null;

  const [oldUser, newUser] = await Promise.all([
    recipients.getUser(oldUserId, runner),
    recipients.getUser(newUserId, runner),
  ]);
  const leads = input.leads || await fetchLeadsForNotification(leadIds, runner);
  const baseMeta = leadMetadata({
    leads,
    leadIds,
    count,
    metadata: input.metadata || {},
    extra: {
      eventType: 'leads_reassigned',
      old_assignee_user_id: oldUserId,
      new_assignee_user_id: newUserId,
      assigned_by: input.assignedBy || input.assigned_by || null,
      reason: input.reason || input.metadata?.reason || null,
    },
  });
  const dedupeBase = input.dedupeKey || `leads_reassigned:${leadIds.join(',') || count}:${oldUserId}:${newUserId}`;

  const newTpl = templates.leadsReassigned({ count, oldMemberName: oldUser?.full_name, newMemberName: newUser?.full_name, recipientRole: 'new_assignee' });
  await createUserNotification({
    userId: newUserId,
    type: 'leads_reassigned',
    title: newTpl.title,
    body: newTpl.body,
    metadata: baseMeta,
    eventType: 'leads_reassigned',
    dedupeKey: `${dedupeBase}:new`,
    email: newTpl.email,
    emailType: newTpl.emailType,
  }, runner);

  const oldTpl = templates.leadsReassigned({ count, oldMemberName: oldUser?.full_name, newMemberName: newUser?.full_name, recipientRole: 'old_assignee' });
  await createUserNotification({
    userId: oldUserId,
    type: 'leads_reassigned',
    title: oldTpl.title,
    body: oldTpl.body,
    metadata: baseMeta,
    eventType: 'leads_reassigned',
    dedupeKey: `${dedupeBase}:old`,
    email: oldTpl.email,
    emailType: oldTpl.emailType,
  }, runner);

  const rmList = recipients.dedupeRecipients([
    await recipients.getUserRm(oldUserId, runner),
    await recipients.getUserRm(newUserId, runner),
  ]);
  for (const rm of rmList) {
    await createUserNotification({
      userId: rm.id,
      type: 'leads_reassigned',
      title: 'Team Lead Reassignment',
      body: `${count} lead(s) moved from ${oldUser?.full_name || 'old member'} to ${newUser?.full_name || 'new member'}.`,
      metadata: { ...baseMeta, rm_user_id: rm.id },
      eventType: 'leads_reassigned',
      dedupeKey: `${dedupeBase}:rm:${rm.id}`,
      email: templates.shell({
        title: 'Team Lead Reassignment',
        body: `${count} lead(s) moved from ${oldUser?.full_name || 'old member'} to ${newUser?.full_name || 'new member'}.`,
        actionUrl: templates.frontendUrl('/leads'),
      }),
      emailType: 'leads_reassigned_new_assignee',
    }, runner);
  }

  const admins = await recipients.getAdminsAndSuperAdmins(runner);
  const adminTpl = templates.leadsReassigned({ count, oldMemberName: oldUser?.full_name, newMemberName: newUser?.full_name });
  for (const admin of recipients.dedupeRecipients(admins)) {
    await createUserNotification({
      userId: admin.id,
      type: 'leads_reassigned',
      title: adminTpl.title,
      body: adminTpl.body,
      metadata: baseMeta,
      eventType: 'leads_reassigned',
      dedupeKey: `${dedupeBase}:admin:${admin.id}`,
    }, runner);
  }
  const userSheets = require('../userGoogleSheetsService');
  await Promise.all(leadIds.map(leadId => userSheets.enqueueLeadSync(leadId, {
    eventType: 'lead_reassigned',
    source: 'reassignment',
    userId: baseMeta.assigned_by,
  })));
  return true;
}

async function notifyLeadAssigned(userIdOrInput, count, metadata = {}, runner = null) {
  if (userIdOrInput && typeof userIdOrInput === 'object' && !Array.isArray(userIdOrInput)) {
    const input = userIdOrInput;
    const actualRunner = count || runner;
    const assignmentType = input.assignmentType || input.assignment_type || input.metadata?.assignment_type;
    if (['manual_reassign', 'auto_reassign'].includes(assignmentType) || input.previousUserId || input.oldAssigneeUserId) {
      return notifyLeadsReassigned({
        ...input,
        oldAssigneeUserId: input.previousUserId || input.oldAssigneeUserId,
        newAssigneeUserId: input.assignedToUserId || input.userId,
        leadIds: input.leadIds || [input.leadId || input.lead_id].filter(Boolean),
        count: input.count || 1,
      }, actualRunner);
    }
    return notifyLeadsAssigned({
      ...input,
      assignedToUserId: input.assignedToUserId || input.userId,
      leadIds: input.leadIds || [input.leadId || input.lead_id].filter(Boolean),
      count: input.count || 1,
    }, actualRunner);
  }

  const assignmentType = metadata?.assignment_type || metadata?.assignmentSource;
  const input = {
    assignedToUserId: userIdOrInput,
    count,
    leadIds: metadata?.lead_ids || [metadata?.lead_id].filter(Boolean),
    assignedBy: metadata?.assigned_by || metadata?.assignedBy || null,
    assignmentSource: assignmentType,
    metadata,
  };
  if (['manual_reassign', 'auto_reassign'].includes(assignmentType)) {
    return notifyLeadsReassigned({
      ...input,
      oldAssigneeUserId: metadata.previous_user_id || metadata.previousUserId || metadata.old_assignee_user_id,
      newAssigneeUserId: userIdOrInput,
    }, runner);
  }
  return notifyLeadsAssigned(input, runner);
}

async function notifyLeadRequestCreated(input, runner = null) {
  const requester = await recipients.getUser(input.requesterId, runner);
  const requestType = input.requestType || (input.requesterRole === 'rm' ? 'rm' : input.requesterRole === 'partner' ? 'partner' : 'lead_request');
  const tpl = templates.requestSubmitted({
    requesterName: input.requesterName || requester?.full_name,
    quantity: input.quantity,
    category: input.category,
    requestType,
  });
  const metadata = {
    event_type: tpl.type,
    request_id: input.requestId,
    requester_id: input.requesterId,
    requester_role: input.requesterRole || requester?.role,
    requested_count: input.quantity,
    lead_category: input.category || null,
    assigned_count: input.assigned || 0,
    created_at: new Date().toISOString(),
  };
  const dedupeBase = `${tpl.type}:${input.requestId}`;

  await createUserNotification({
    userId: input.requesterId,
    type: tpl.type,
    title: tpl.title,
    body: tpl.body,
    metadata,
    eventType: tpl.type,
    entityType: 'lead_request',
    entityId: input.requestId,
    dedupeKey: `${dedupeBase}:requester`,
    email: tpl.email,
    emailType: tpl.emailType,
  }, runner);

  const rm = input.rmId ? await recipients.getUser(input.rmId, runner) : await recipients.getUserRm(input.requesterId, runner);
  if (rm && rm.id !== input.requesterId) {
    await createUserNotification({
      userId: rm.id,
      type: tpl.type,
      title: 'Team Member Requested Leads',
      body: tpl.adminBody,
      metadata: { ...metadata, rm_user_id: rm.id },
      eventType: tpl.type,
      entityType: 'lead_request',
      entityId: input.requestId,
      dedupeKey: `${dedupeBase}:rm:${rm.id}`,
      email: templates.shell({ title: tpl.adminBody, body: tpl.adminBody, actionUrl: templates.frontendUrl('/requests') }),
      emailType: tpl.emailType,
    }, runner);
  }

  const admins = await recipients.getAdminsAndSuperAdmins(runner);
  for (const admin of recipients.dedupeRecipients(admins)) {
    await createUserNotification({
      userId: admin.id,
      type: 'lead_request_needs_approval',
      title: tpl.adminTitle,
      body: tpl.adminBody,
      metadata,
      eventType: 'lead_request_needs_approval',
      entityType: 'lead_request',
      entityId: input.requestId,
      dedupeKey: `${dedupeBase}:admin:${admin.id}`,
      email: templates.shell({ title: 'New lead request received', body: tpl.adminBody, actionUrl: templates.frontendUrl('/partner-requests') }),
      emailType: tpl.emailType,
    }, runner);
  }
}

async function notifyLeadRequestResolved(input, runner = null) {
  const requester = await recipients.getUser(input.requesterId, runner);
  const requestType = input.requestType || (requester?.role === 'rm' ? 'rm' : requester?.role === 'partner' ? 'partner' : 'lead_request');
  const tpl = templates.requestResolved({
    quantity: input.quantity,
    approvedCount: input.assigned ?? input.approvedCount ?? input.approved_count,
    status: input.status,
    reason: input.note || input.reason,
    requestType,
    approverName: input.approverName,
    requesterName: requester?.full_name,
  });
  const metadata = {
    event_type: tpl.type,
    request_id: input.requestId,
    requester_id: input.requesterId,
    requested_count: input.quantity,
    approved_count: input.assigned ?? input.approvedCount ?? input.approved_count ?? 0,
    rejected_count: input.status === 'rejected' ? input.quantity : Math.max(0, Number(input.quantity || 0) - Number(input.assigned || 0)),
    approved_by_user_id: input.approvedByUserId || input.resolvedByUserId || null,
    rejected_by_user_id: input.status === 'rejected' ? (input.rejectedByUserId || input.resolvedByUserId || null) : null,
    reason: input.note || input.reason || null,
    created_at: new Date().toISOString(),
  };
  const dedupeBase = `${tpl.type}:${input.requestId}`;

  await createUserNotification({
    userId: input.requesterId,
    type: tpl.type,
    title: tpl.title,
    body: tpl.body,
    metadata,
    eventType: tpl.type,
    entityType: 'lead_request',
    entityId: input.requestId,
    dedupeKey: `${dedupeBase}:requester`,
    email: tpl.email,
    emailType: tpl.emailType,
  }, runner);

  const rm = await recipients.getUserRm(input.requesterId, runner);
  if (rm && rm.id !== input.requesterId) {
    await createUserNotification({
      userId: rm.id,
      type: tpl.type,
      title: tpl.title.replace('Lead Request', 'Team Lead Request'),
      body: `${requester?.full_name || 'Team member'}: ${tpl.body}`,
      metadata: { ...metadata, rm_user_id: rm.id },
      eventType: tpl.type,
      entityType: 'lead_request',
      entityId: input.requestId,
      dedupeKey: `${dedupeBase}:rm:${rm.id}`,
      email: templates.shell({ title: tpl.title, body: `${requester?.full_name || 'Team member'}: ${tpl.body}`, actionUrl: templates.frontendUrl('/requests') }),
      emailType: tpl.emailType,
    }, runner);
  }

  const admins = await recipients.getAdminsAndSuperAdmins(runner);
  for (const admin of recipients.dedupeRecipients(admins)) {
    await createUserNotification({
      userId: admin.id,
      type: tpl.type,
      title: tpl.adminTitle,
      body: tpl.adminBody,
      metadata,
      eventType: tpl.type,
      entityType: 'lead_request',
      entityId: input.requestId,
      dedupeKey: `${dedupeBase}:admin:${admin.id}`,
    }, runner);
  }
}

module.exports = {
  createUserNotification,
  notifyUser,
  notifyUsers,
  notifyAdmins,
  notifyLeadAssigned,
  notifyLeadsAssigned,
  notifyLeadsReassigned,
  notifyLeadRequestCreated,
  notifyLeadRequestResolved,
  notifyPartnerRequestApproved: (input, runner) => notifyLeadRequestResolved({ ...input, requestType: 'partner', status: 'approved' }, runner),
  notifyPartnerRequestRejected: (input, runner) => notifyLeadRequestResolved({ ...input, requestType: 'partner', status: 'rejected' }, runner),
};
