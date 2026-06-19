function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function shell({ title, greeting, content, buttonLabel, resetUrl, footer }) {
  return `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;background:#f1f5f9"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
<tr><td style="background:#0f172a;padding:24px;color:#ffffff"><div style="font-size:20px;font-weight:700">DigitalADbird CRM</div></td></tr>
<tr><td style="padding:28px"><h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1><p style="margin:0 0 16px">${escapeHtml(greeting)}</p>${content}
<p style="margin:24px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:6px;font-weight:700">${escapeHtml(buttonLabel)}</a></p>
<p style="font-size:12px;color:#64748b;word-break:break-all">If the button does not work, open:<br>${escapeHtml(resetUrl)}</p>
<p style="margin:20px 0 0;font-size:13px;color:#64748b">${escapeHtml(footer)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

function resetEmail({ user, resetUrl, expiresMinutes }) {
  const content = `<p style="line-height:1.6">Use the secure link below to set a new password. This link expires in <strong>${expiresMinutes} minutes</strong> and can be used once.</p>`;
  return {
    subject: 'Reset your DigitalADbird CRM password',
    html: shell({ title: 'Reset your password', greeting: `Hello ${user.full_name},`, content, buttonLabel: 'Reset password', resetUrl, footer: 'If you did not request this reset, ignore this email.' }),
    text: `Hello ${user.full_name},\n\nReset your DigitalADbird CRM password: ${resetUrl}\n\nThis link expires in ${expiresMinutes} minutes and can be used once. If you did not request this reset, ignore this email.`,
  };
}

function onboardingEmail({ user, resetUrl, loginUrl, expiresMinutes }) {
  const content = `<p>Your CRM account is ready.</p><table role="presentation" cellspacing="0" cellpadding="5" style="font-size:14px"><tr><td><strong>Role</strong></td><td>${escapeHtml(user.role)}</td></tr><tr><td><strong>Email</strong></td><td>${escapeHtml(user.email)}</td></tr><tr><td><strong>Phone</strong></td><td>${escapeHtml(user.phone || 'Not set')}</td></tr><tr><td><strong>CP ID</strong></td><td>${escapeHtml(user.cp_id)}</td></tr><tr><td><strong>CRM login</strong></td><td>${escapeHtml(loginUrl)}</td></tr></table><p style="line-height:1.6">For your security, we do not send passwords by email. Please set your password using the secure link below. The link expires in <strong>${expiresMinutes} minutes</strong>.</p>`;
  return {
    subject: 'Your DigitalADbird CRM account is ready',
    html: shell({ title: 'Welcome to DigitalADbird CRM', greeting: `Hello ${user.full_name},`, content, buttonLabel: 'Set your password', resetUrl, footer: 'Keep your login details private and contact your administrator if this account was not expected.' }),
    text: `Hello ${user.full_name},\n\nYour DigitalADbird CRM account is ready.\nRole: ${user.role}\nEmail: ${user.email}\nPhone: ${user.phone || 'Not set'}\nCP ID: ${user.cp_id}\nLogin: ${loginUrl}\n\nFor your security, we do not send passwords by email. Set your password: ${resetUrl}\nThis link expires in ${expiresMinutes} minutes.`,
  };
}

function adminResetEmail({ user, resetUrl, requestedBy, expiresMinutes }) {
  const initiator = requestedBy?.full_name || requestedBy?.name || 'your administrator';
  const content = `<p style="line-height:1.6">A password reset was initiated by <strong>${escapeHtml(initiator)}</strong>. Use the secure link below within <strong>${expiresMinutes} minutes</strong>.</p>`;
  return {
    subject: 'DigitalADbird CRM password reset link',
    html: shell({ title: 'Password reset link', greeting: `Hello ${user.full_name},`, content, buttonLabel: 'Set a new password', resetUrl, footer: 'If you were not expecting this email, contact your administrator.' }),
    text: `Hello ${user.full_name},\n\nA password reset was initiated by ${initiator}. Set a new password: ${resetUrl}\nThis link expires in ${expiresMinutes} minutes.`,
  };
}

module.exports = { resetEmail, onboardingEmail, adminResetEmail };
