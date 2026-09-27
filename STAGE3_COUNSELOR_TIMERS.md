# Stage 3: main journey remark timers

## Result

PASS for Stage 3 backend implementation and timer tests. GO for code review. No production migration or deployment was performed. Stage 4 has not started.

Root cause addressed: Stage 2 persisted independent journey/queue state and supported deadline processing, but explicit primary remarks did not calculate their aging deadlines.

## Files changed in Stage 3

- Added `backend/src/services/counselorWorkflowPolicies.js`: pure deadline calculation and the `main_journey_v1` policy version.
- Updated `backend/src/services/counselorWorkflowService.js`: select policy from the explicit primary during the existing atomic remark transaction; support Stage 1 `cc`/`responded` query keys.
- Added `backend/src/services/__tests__/counselorWorkflowPolicies.test.js`: duration, Kolkata cutoff, timezone, boundary and excluded-status tests.
- Updated `backend/src/services/__tests__/counselorWorkflow.test.js`: persisted policy transitions, shared classification, interruption, overrides, history and prospective behavior; updated two Stage 2 assertions that previously expected timer-free main journeys.
- Added this report.

No schema, migration, frontend, auth controller, report, or deployment configuration was changed in this stage. Earlier uncommitted Stage 1/2 and user changes remain intact.

## Policy configuration

Only these exact primary status keys start automatic aging:

| Journey | Stored primary key | Remark to Old | Additional time from Old to Pending |
| --- | --- | --- | --- |
| CC | `communication_completed` | 1 hour | 20 hours |
| Responded | `respond_hi` | Next applicable 21:30 Asia/Kolkata | 20 hours |
| Common Meeting | `common_meeting` | 15 hours | 20 hours |
| DIM | `dim` | 15 hours | 20 hours |
| Personal Meeting | `personal_meeting` | 1 hour | 5 hours |
| Quotation | `quotation` | 1 hour | 5 hours |
| Follow-Up | `follow_up` | 18 hours | 6 hours |
| Hot | `hot` | 6 hours | 18 hours |
| Warm | `warm` | 6 hours | 18 hours |
| Process Incomplete | `process_incomplete` | 6 hours | 18 hours |

The policy uses the server's remark-processing time after obtaining the lead lock. Clients cannot backdate workflow deadlines. Both absolute timestamps and the policy version are saved with state/history in one transaction and one new remark generation. No backfill runs on reads, worker ticks, or process restart.

### Responded boundary

The business calendar date is obtained with `Intl.DateTimeFormat` explicitly using `Asia/Kolkata`. The cutoff is 21:30 at UTC+05:30, independent of server-local timezone:

- 15:00 or 21:29: Old at 21:30 the same day.
- Exactly 21:30:00.000: current day's cutoff; eligible at the next worker run.
- 21:30:00.001 or later: next day's 21:30 cutoff.
- Pending is exactly 20 hours after that Old deadline.

Year/month/leap-day rollover and alternate server timezones are covered by tests.

## API and query behavior

The Stage 2 routes and request contract remain in place. `primary_status` must be an explicit member of `statuses`; secondary statuses never choose a policy. Existing canonical primary keys remain unchanged. For example, Responded is submitted as `respond_hi`, not inferred from `interested` or a legacy stage.

`GET /api/counselor-workflow/v1/leads?view=...` supports all ten primary keys plus `old` and `pending`. Added aliases `cc` and `responded` match the Stage 1 tab keys. Count and rows continue to use the same materialized classification query; no frontend filtering or separate count definition was introduced.

A saved primary immediately leaves New/Old/Pending and activates its journey. At the first deadline the journey remains active and Old becomes active. At Pending both active journey and Old membership end, while the primary and full history remain stored. The list API still returns workflow state rows as defined in Stage 2. This stage does not wire those responses into the existing frontend or change tab order.

## Worker and concurrency

The existing worker and scheduling cadence are reused without modification. It reads persisted deadlines, checks the generation and current assignment under locks, and applies idempotent transitions. A new primary save replaces both timestamps and increments generation, invalidating previously selected jobs. Repeated saves using the same request key remain idempotent and do not restart aging.

When processing is delayed, Old history records the original Old deadline and Pending history records the original Pending deadline. Pending is never recalculated from the time the worker happens to run. If both are overdue, the existing worker records Old first, then Pending on a subsequent tick. Actual visible changes follow the worker cadence and backlog; the logical deadlines remain exact.

## Custom follow-up

The existing `leads.next_followup_at` and persisted override flag retain priority. Default deadlines can be stored while suspended, but neither Old nor Pending is processed while either guard is active. Omitted follow-up preserves the existing schedule. Explicitly clearing it while saving a new primary starts that new remark's policy.

No automatic expiry or resume policy was added: passing the follow-up timestamp alone does not remove the Stage 2 override. There is no second reminder scheduler. CR retains any existing reminder, and RM status does not reassign ownership.

## Prospective activation and legacy boundaries

The existing `COUNSELOR_WORKFLOW_ROLLOUT_AT` gate remains authoritative. Absent/future cutoff disables new workflow commands and processing. Once enabled, newly saved explicit main primaries acquire `main_journey_v1` deadlines. Old CRM records and already managed Stage 2 journeys are not retrospectively scheduled. No environment setting was changed by this task.

Stage 2 adapters that pass an explicit primary use this same policy calculation. Existing legacy adapters without a primary retain Stage 2 behavior: invalidate aging and await an explicit primary without guessing from status-array order.

Legacy V2 still combines CC/Responded into broader stages, and TTE is not DIM. Native V2 lifecycle actions, personal-meeting records, sheet imports and admin-created initial notes remain legacy contracts; they are not explicit primary commands and do not gain these new timers. Legacy manual routes also restrict statuses through their older allowlist, so use the versioned Stage 2 remark endpoint for the full set of ten policies. No legacy permissions, reporting definitions or mappings were changed.

The new timers and classification apply to the versioned counselor workflow. The current Stage 1 frontend still reads legacy workspace APIs; identical behavior across both interfaces is not claimed. Full interface integration and reconciliation of mixed legacy mutation paths remain rollout considerations.

## Excluded rules

No automatic policy was added for SC, CR, RM, NT, Converted or Cold. Saving them invalidates an older main-journey generation without assigning a replacement aging timer.

Stage 4/5 work remains excluded: New unworked timeout, CNR/Busy/Call Cut/Switch Off/other Call Issue aging, NRAC/NRACM/NRAPM/NRAF/NRAQ and overnight rules, and final Worked N/O counters/UI. Unknown/unlisted statuses have no fallback policy.

## Verification

Commands executed from `backend`:

- `node node_modules/jest/bin/jest.js --runInBand`: **12 suites passed; 165 tests passed**, with 49 database tests skipped in this ordinary run.
- `node scripts/test-counselor-workflow-postgres.mjs`: **2 suites passed; 102 tests passed**, including all 49 PostgreSQL integration tests. The other 53 validation/policy tests overlap the ordinary run.
- `node --check` for all four changed/new JavaScript files: **passed**.
- `git diff --check`: **passed**.
- `node node_modules/eslint/bin/eslint.js src/`: **blocked**, because the repository has no ESLint 9 `eslint.config.*` file.

The database run used a newly created isolated local PostgreSQL cluster, a minimal referenced schema and the unchanged Stage 2 migration. It did not connect to existing CRM data. No production migration was run, and no new migration is required by Stage 3.

Tests cover every policy, CC at 59/60 minutes, Responded cutoff boundaries, Old/journey overlap, Pending removal, exact history times after downtime, duplicate workers, stale jobs, a replacement remark one minute before Old/Pending, secondary-status exclusion, follow-up suspension, count/list parity, unsupported statuses, and no retrospective scheduling. Existing authorization, transaction rollback and concurrency regressions also pass.

Backend package scripts define no typecheck or build command. Frontend typecheck/build/browser verification was not rerun because no frontend files changed. Full-schema staging, HTTP smoke tests and production-scale query-plan verification were not performed. Lint configuration remains a repository issue.
