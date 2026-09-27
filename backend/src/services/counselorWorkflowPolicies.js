const HOUR_MS = 60 * 60 * 1000;
const CLOCKS = Object.freeze({responded:'21:30',opening:'09:00',closing:'17:00',overnight:'10:00'});
const POLICY_VERSION = 'main_journey_v1';
const { RETRYABLE_CONTACT_ISSUES, TERMINAL_LEAD_QUALITY_ISSUES } = require('../constants/counselorReportOptions');
// Reuse real CRM reachability codes. switched_off is the existing long form
// of so; keep both original codes in state/history instead of rewriting them.
const RETRYABLE_ISSUES = Object.freeze([...RETRYABLE_CONTACT_ISSUES, 'switched_off']);
const NR_STATUSES = Object.freeze(['nrac', 'nracm', 'nrapm', 'nraf', 'nraq']);
const CALL_ISSUE_STATUSES = Object.freeze([...RETRYABLE_ISSUES, ...NR_STATUSES, ...TERMINAL_LEAD_QUALITY_ISSUES]);

// Hours in journey, then additional hours in Old. Unlisted statuses have no
// automatic aging policy; never fall back to a generic timer.
const DURATIONS = Object.freeze({
  communication_completed: Object.freeze([1, 20]),
  common_meeting: Object.freeze([15, 20]),
  dim: Object.freeze([15, 20]),
  personal_meeting: Object.freeze([1, 5]),
  quotation: Object.freeze([1, 5]),
  follow_up: Object.freeze([18, 6]),
  hot: Object.freeze([6, 18]),
  warm: Object.freeze([6, 18]),
  process_incomplete: Object.freeze([6, 18]),
});
const kolkataDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

function nextRespondedCutoff(start) {
  const parts = Object.fromEntries(kolkataDate.formatToParts(start).map(part => [part.type, part.value]));
  // Asia/Kolkata uses UTC+05:30. Build the business date explicitly, never
  // through server-local getters. Equality belongs to the current cutoff.
  const cutoff = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${CLOCKS.responded}:00.000+05:30`);
  return new Date(start.getTime() <= cutoff ? cutoff : cutoff + 24 * HOUR_MS);
}

// Both New and NR use inclusive 09:00:00.000 through 17:00:00.000.
// A daytime deadline is not clamped to office hours. Outside that interval,
// early-morning work uses today's 10 AM; evening work uses tomorrow's 10 AM.
function officeDeadline(startedAt) {
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw new TypeError('A valid workflow start time is required.');
  const parts = Object.fromEntries(kolkataDate.formatToParts(start).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const opening = Date.parse(`${day}T${CLOCKS.opening}:00.000+05:30`);
  const closing = Date.parse(`${day}T${CLOCKS.closing}:00.000+05:30`);
  const tenAm = Date.parse(`${day}T${CLOCKS.overnight}:00.000+05:30`);
  const time = start.getTime();
  return new Date(time >= opening && time <= closing
    ? time + 2 * HOUR_MS
    : tenAm + (time > closing ? 24 * HOUR_MS : 0));
}

function newAssignmentDeadlines(assignedAt) {
  return { policy_version: 'new_assignment_v1', move_to_old_at: null,
    move_to_pending_at: officeDeadline(assignedAt) };
}

function journeyDeadlines(primaryStatus, startedAt) {
  if (RETRYABLE_ISSUES.includes(primaryStatus) || NR_STATUSES.includes(primaryStatus)) {
    const start = new Date(startedAt);
    if (!Number.isFinite(start.getTime())) throw new TypeError('A valid workflow start time is required.');
    const isNr = NR_STATUSES.includes(primaryStatus);
    const oldAt = isNr ? officeDeadline(start) : new Date(start.getTime() + 2 * HOUR_MS);
    return { policy_version: isNr ? 'nr_family_v1' : 'call_issue_v1', move_to_old_at: oldAt,
      move_to_pending_at: new Date(oldAt.getTime() + (isNr ? 14 : 22) * HOUR_MS) };
  }
  if (primaryStatus !== 'respond_hi' && !Object.hasOwn(DURATIONS, primaryStatus)) return null;
  const start = new Date(startedAt);
  if (!Number.isFinite(start.getTime())) throw new TypeError('A valid workflow start time is required.');
  const oldAt = primaryStatus === 'respond_hi'
    ? nextRespondedCutoff(start)
    : new Date(start.getTime() + DURATIONS[primaryStatus][0] * HOUR_MS);
  const oldHours = primaryStatus === 'respond_hi' ? 20 : DURATIONS[primaryStatus][1];
  return {
    policy_version: POLICY_VERSION,
    move_to_old_at: oldAt,
    move_to_pending_at: new Date(oldAt.getTime() + oldHours * HOUR_MS),
  };
}

module.exports = { journeyDeadlines, newAssignmentDeadlines, POLICY_VERSION, RETRYABLE_ISSUES, NR_STATUSES, CALL_ISSUE_STATUSES, CLOCKS };
