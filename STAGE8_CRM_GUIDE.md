# Stage 8 — CRM Guide

## Result

Implementation complete; browser visual verification pending. No deployment or production approval is implied. Stop here for UI review.

## Feature and source of truth

- `/crm-guide`, titled **CRM Workflow Guide**, appears directly after Leads in the shared desktop/mobile navigation for member and partner counselors.
- The page and `GET /api/counselor-workflow/v1/guide` restrict access to these roles. Admin/RM navigation and workflow behavior are unchanged.
- The read-only response contains counselor descriptions and calculated intervals, without database records, locking details, or security configuration. It performs no database writes.
- Durations come from `journeyDeadlines` and `newAssignmentDeadlines`, evaluated at a reference office-opening time. Cutoff descriptions use the same exported clock constants as those calculators. The frontend has no separate duration table.
- All supported `STATUS_VALUES` appear exactly once, plus untouched New Leads. Categories: Journey, Call Issues, Not Responding, Special, Queues. Local search matches codes, names, status names and meanings.
- Cards show vertical timelines and explicit untimed states. Reference sections explain custom follow-up, Worked N/O, primary/secondary remarks, queue overlap and history. Loading, retry and empty-search states are included.
- Accounts outside the enabled workflow pilot see an explicit notice that their existing workspace may behave differently.

## Policies verified against current code

All times use Asia/Kolkata. The second interval below starts when Old begins.

| Workflow | Initial interval to Old | Additional interval to Pending |
| --- | --- | --- |
| Communication Completed (CC) | 1 hour | 20 hours |
| Common Meeting (CM), Discussed in Meeting (DIM) | 15 hours | 20 hours |
| Personal Meeting (PM), Quotation (Q) | 1 hour | 5 hours |
| Follow-Up (FLP) | 18 hours | 6 hours |
| Hot, Warm, Process Incomplete (PI) | 6 hours | 18 hours |
| Responded | Same-day 21:30 if saved at/before cutoff; next-day 21:30 otherwise | 20 hours |
| Retryable call issues | 2 hours, around the clock | 22 hours |
| NRAC, NRACM, NRAPM, NRAF, NRAQ | Office-hours delay of 2 hours; otherwise applicable 10:00 deadline | 14 hours |
| Untouched New | Never enters Old; same office-hours rule goes directly to Pending | Not applicable |

Office hours include exactly 09:00:00.000 and 17:00:00.000. Before opening, the deadline is 10:00 that same day; after closing, 10:00 the next day. The daytime delay is not clamped to closing. There are no weekend/holiday exclusions.

Retryable codes are `cnr`, `recall`, `busy`, `cb`, `rnr`, `cw`, `nn`, `so`, `nc`, `call_cut_busy`, and `switched_off`. Existing report labels are reused where available. Terminal contact-quality codes (`in`, `invalid_number`, `wrong_number`, `ni`, `language_barrier`) have no automatic timer. `ni` means No Incoming, distinct from `not_interested`.

SC, CR, RM, NT, Converted, Cold and other unlisted legacy/manual statuses show **No automatic Old/Pending timer**. Coverage includes `interested`, `not_interested`, `callback_requested`, `custom_remark`, `session_730_attend`, `yes_after_730_session`, `ccb`, and `talk_response`.

## Requirements/documentation versus code audit

Compared the Stage 8 request and existing Stage 2–5 reports with the policy calculators, workflow service, report labels and frontend remark options. Existing Stage 4 details already describe several boundaries more precisely than the request's shorthand.

| Remark/topic | Documentation/request wording | Current code and guide |
| --- | --- | --- |
| New/NR outside office hours | Next-morning deadline | Before 09:00 uses today's 10:00; after 17:00 uses tomorrow's 10:00. |
| New/NR office boundary | Office-hours window | Both exact endpoints inclusive; after 17:00:00.000 is outside. |
| Responded | Before/after 21:30 | Equality uses today's cutoff. |
| Custom follow-up | New remark can take over; valid active schedule overrides | Existing override persists unless explicitly cleared/replaced, including after its scheduled time. New remark alone does not remove it. Guide explains this limitation. |
| Worked | Any remark counts as work | All real remarks are work, but N/O only count work while in New/Old. Repeated work deduplicates by counselor, lead, bucket and reporting period. |
| Common Meeting attendance | Similar meeting terminology | Legacy attendance status is separate from timed `common_meeting`; guide preserves both. |
| Call Issue shorthand | Busy / Call Cut | Actual retryable codes are used. Ambiguous legacy `ccb` has no timer; guide does not infer one. |
| NR full names | NR-family code list | No authoritative expanded names were found; guide retains each code with a Not Responding label. |
| Primary remark | Any remark starts corresponding journey | An explicit primary selects the workflow; secondary statuses are context. Legacy forms without primary can leave selection pending. |

No requested named core workflow was missing from the current policy set. Additional legacy/terminal statuses above are supported but have no timed journey. Their inclusion does not claim that each has a dedicated workspace tab. The guide does not invent NR/CCB expansions or silently change their behavior.

## Stage 8 files

- `backend/src/services/counselorGuideService.js` — safe guide projection.
- `backend/src/services/counselorWorkflowPolicies.js` — shared clock constants; identical values and transition behavior.
- `backend/src/routes/lifecycle.js` — counselor-only guide endpoint.
- `backend/src/services/__tests__/counselorGuide.test.js` — all-status coverage, policy parity, cutoff and office boundary tests, untimed states and safe response fields.
- `backend/src/services/__tests__/counselorWorkflowRoutes.test.js` — guide authentication and role tests.
- `frontend/src/app/crm-guide/page.tsx` — route entry.
- `frontend/src/components/leads/CrmGuide.tsx` — guide UI and local search.
- `frontend/src/components/layout/Sidebar.tsx` — role-scoped CRM Guide link.
- `frontend/scripts/counselor-leads.test.cjs` — role contract, search/category filtering and rendered reference text.
- `STAGE8_CRM_GUIDE.md` — this report.

Existing unrelated edits, including `authController.js`, were preserved. No schema, migration, timer duration, transition, queue, Worked, follow-up or Admin/RM behavior was changed.

## Verification

- Full ordinary backend Jest run: **314 passed, 170 skipped**, 16 passing suites. The skipped integration tests are not claimed as executed in Stage 8.
- Final focused guide/policy/route run, including the added unauthenticated test: **178 passed**, 3 suites.
- Frontend rendering/search tests: **15 passed**, including the final rerun after component extraction.
- Standalone TypeScript passed. The first production build identified prohibited named exports in the Next.js route; helpers were moved to `CrmGuide.tsx`. The corrected production build **passed (exit 0)**, including type checking and lint with existing repository warnings, and generated all 48 pages. `/crm-guide` is present in its route manifest (3.14 kB route size).
- Backend guide syntax check and `git diff --check`: passed.
- Backend lint: blocked; ESLint 9 cannot find `eslint.config.js/mjs/cjs`. Existing repository configuration was not changed for this feature.
- Browser connection failed with `codex/sandbox-state-meta: missing field sandboxPolicy`. No visual PASS or screenshots are claimed. Check 320, 360, 375, 390, 430px, tablet and desktop after reconnection: overflow, wrapping, navigation, search/chips, empty/error states and timeline legibility.
- No deployment or production verification performed. **NO-GO for final visual acceptance until browser QA is completed.**
