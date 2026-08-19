const CUSTOMER_NOTE_APPROVAL_STATUSES = ['pending_rm_approval', 'approved', 'rejected'];
const CUSTOMER_NOTE_USER_ROLES = ['rm', 'member', 'partner'];

function normalizeOption(value) {
  return String(value || '').trim().toLowerCase();
}

function isCustomerNoteApprovalStatus(value) {
  return CUSTOMER_NOTE_APPROVAL_STATUSES.includes(normalizeOption(value));
}
function isCustomerNoteUserRole(value) {
  return CUSTOMER_NOTE_USER_ROLES.includes(normalizeOption(value));
}


module.exports = {
  CUSTOMER_NOTE_APPROVAL_STATUSES,
  CUSTOMER_NOTE_USER_ROLES,
  isCustomerNoteApprovalStatus,
  isCustomerNoteUserRole,
};
