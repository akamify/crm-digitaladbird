const config = require('../../config/env');

const CATEGORY_LABELS = {
  trader: 'Trader Lead',
  partner: 'Partner Lead',
  unknown: 'Lead',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function plural(count, word) {
  return `${count} ${word}${Number(count) === 1 ? '' : 's'}`;
}

function frontendUrl(path) {
  const base = (config.email?.frontendUrl || process.env.APP_FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function categoryLabel(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS.unknown;
}

function categoryBreakdownText(breakdown = {}) {
  const safeBreakdown = breakdown && typeof breakdown === 'object' ? breakdown : {};
  const counts = {
    trader: Number(safeBreakdown.trader || 0),
    partner: Number(safeBreakdown.partner || 0),
    unknown: Number(safeBreakdown.unknown || 0),
  };
  const parts = [];
  if (counts.trader > 0) parts.push(`Trader Leads: ${counts.trader}`);
  if (counts.partner > 0) parts.push(`Partner Leads: ${counts.partner}`);
  if (counts.unknown > 0) parts.push(`Unknown: ${counts.unknown}`);
  return parts.join(', ');
}

function countTitle(count, singular, pluralText = null) {
  return Number(count) === 1 ? singular : `${count} ${pluralText || singular}`;
}

function shell({ title, body, actionUrl, actionLabel }) {
  const safeUrl = actionUrl || frontendUrl('/dashboard');
  return {
    subject: title,
    html: `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f1f5f9"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<tr><td style="background:#0f172a;color:#fff;padding:22px 24px"><div style="font-size:20px;font-weight:700">DigitalADbird CRM</div></td></tr>
<tr><td style="padding:26px"><h1 style="font-size:21px;margin:0 0 14px">${escapeHtml(title)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 20px">${escapeHtml(body)}</p>
<p style="margin:22px 0"><a href="${escapeHtml(safeUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:700">${escapeHtml(actionLabel || 'Open CRM')}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">Open link: ${escapeHtml(safeUrl)}</p>
<p style="margin-top:22px;font-size:13px;color:#64748b">This is an automated notification from DigitalADbird CRM.</p>
</td></tr></table></td></tr></table></body></html>`,
    text: `${title}\n\n${body}\n\n${safeUrl}\n\nThis is an automated notification from DigitalADbird CRM.`,
  };
}

function leadsAssigned({ count, category, categoryBreakdown, memberName, assignmentSource }) {
  const breakdown = categoryBreakdownText(categoryBreakdown);
  const hasSingleCategory = category && category !== 'unknown' && !breakdown;
  const title = hasSingleCategory
    ? `${count} New ${categoryLabel(category)}${Number(count) === 1 ? '' : 's'} Assigned`
    : countTitle(count, 'New Lead Assigned', 'New Leads Assigned');
  const body = breakdown
    ? `You have received ${plural(count, 'new lead')}. ${breakdown}. Please start follow-up from your dashboard.`
    : `You have received ${plural(count, 'new lead')}. Please start follow-up from your dashboard.`;
  return {
    type: assignmentSource === 'auto' ? 'auto_leads_distributed' : 'leads_assigned',
    title,
    body,
    emailType: assignmentSource === 'auto' ? 'auto_leads_distributed' : 'leads_assigned',
    email: shell({ title: `${count} new lead${Number(count) === 1 ? '' : 's'} assigned to you`, body, actionUrl: frontendUrl('/leads'), actionLabel: 'Open assigned leads' }),
    adminTitle: 'Lead Assignment Completed',
    adminBody: `${plural(count, 'lead')} assigned${memberName ? ` to ${memberName}` : ''}.`,
  };
}

function leadsReassigned({ count, oldMemberName, newMemberName, recipientRole }) {
  if (recipientRole === 'old_assignee') {
    const title = `${count} Leads Reassigned From You`;
    const body = `${plural(count, 'lead')} were reassigned from your account${newMemberName ? ` to ${newMemberName}` : ''}.`;
    return { title, body, emailType: 'leads_reassigned_old_assignee', email: shell({ title, body, actionUrl: frontendUrl('/leads') }) };
  }
  if (recipientRole === 'new_assignee') {
    const title = `${count} Leads Reassigned to You`;
    const body = `${plural(count, 'lead')} have been reassigned to you. Please review them.`;
    return { title, body, emailType: 'leads_reassigned_new_assignee', email: shell({ title, body, actionUrl: frontendUrl('/leads') }) };
  }
  const title = 'Lead Reassignment Completed';
  const body = `${plural(count, 'lead')} reassigned${oldMemberName ? ` from ${oldMemberName}` : ''}${newMemberName ? ` to ${newMemberName}` : ''}.`;
  return { title, body, emailType: 'leads_reassigned_new_assignee', email: shell({ title, body, actionUrl: frontendUrl('/leads') }) };
}

function requestSubmitted({ requesterName, quantity, category, requestType = 'lead_request' }) {
  const label = requestType === 'rm' ? 'RM lead request' : requestType === 'partner' ? 'partner lead request' : 'lead request';
  const cat = category ? ` (${categoryLabel(category)})` : '';
  const title = requestType === 'rm' ? 'RM Lead Request Submitted' : 'Lead Request Submitted';
  const body = `You requested ${quantity} lead${Number(quantity) === 1 ? '' : 's'}${cat}. Your request is pending approval.`;
  const adminBody = `${requesterName || 'A user'} requested ${quantity} lead${Number(quantity) === 1 ? '' : 's'}${cat}.`;
  return {
    type: requestType === 'rm' ? 'rm_lead_request_created' : requestType === 'partner' ? 'partner_request_created' : 'lead_request_created',
    title,
    body,
    adminTitle: 'Lead Request Needs Approval',
    adminBody,
    emailType: requestType === 'rm' ? 'rm_request_submitted' : requestType === 'partner' ? 'partner_request_submitted' : 'lead_request_submitted',
    email: shell({ title: `Your ${label} has been submitted`, body, actionUrl: frontendUrl('/requests') }),
  };
}

function requestResolved({ quantity, approvedCount, status, reason, requestType = 'lead_request', approverName, requesterName }) {
  const rejected = status === 'rejected';
  const partial = !rejected && Number(approvedCount || 0) < Number(quantity || 0);
  const typePrefix = requestType === 'rm' ? 'rm_lead_request' : requestType === 'partner' ? 'partner_request' : 'lead_request';
  const title = rejected
    ? 'Lead Request Rejected'
    : partial
      ? 'Lead Request Partially Approved'
      : 'Lead Request Approved';
  const body = rejected
    ? `Your request for ${quantity} lead(s) was rejected${reason ? `: ${reason}` : ''}.`
    : partial
      ? `You requested ${quantity} lead(s). ${approvedCount} lead(s) were approved.`
      : `Your request for ${quantity} lead(s) has been approved. ${approvedCount || quantity} lead(s) were assigned to you.`;
  const eventType = rejected ? `${typePrefix}_rejected` : partial ? `${typePrefix}_partially_approved` : `${typePrefix}_approved`;
  const emailType = requestType === 'rm'
    ? (rejected ? 'rm_request_rejected' : 'rm_request_approved')
    : requestType === 'partner'
      ? (rejected ? 'partner_request_rejected' : partial ? 'partner_request_partially_approved' : 'partner_request_approved')
      : (rejected ? 'lead_request_rejected' : partial ? 'lead_request_partially_approved' : 'lead_request_approved');
  const adminBody = rejected
    ? `${approverName || 'Admin'} rejected ${requesterName || 'user'}'s request for ${quantity} lead(s).`
    : `${approverName || 'Admin'} approved ${approvedCount || quantity} lead(s) for ${requesterName || 'user'}.`;
  return {
    type: eventType,
    title,
    body,
    adminTitle: title,
    adminBody,
    emailType,
    email: shell({ title, body, actionUrl: frontendUrl('/requests') }),
  };
}

module.exports = {
  categoryLabel,
  categoryBreakdownText,
  frontendUrl,
  leadsAssigned,
  leadsReassigned,
  requestSubmitted,
  requestResolved,
  shell,
};
