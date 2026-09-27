# Stage 4: New timeouts, Call Issues and NR family

## Result and scope

PASS for Stage 4 backend implementation and tests. GO for review; production rollout has not been performed. Stage 5 has not started.

Root cause addressed: the versioned workflow had no unworked-assignment deadline, no retryable Call Issue/NR aging, and no shared CI classification. This stage adds those rules to the existing policy and transition service.

Stage 3 durations and Responded cutoff behavior are unchanged. No UI, Admin/RM dashboard, report definition, final Worked count, schema, migration or deployment configuration was changed.

## Files changed in Stage 4

- `backend/src/services/counselorWorkflowPolicies.js`: New, retryable Call Issue and NR deadline policies; approved CI status groups.
- `backend/src/services/counselorWorkflowService.js`: assignment enrollment deadlines, reassignment validation, counselor-note checks, and received/CI membership predicates.
- `backend/src/services/__tests__/counselorWorkflowPolicies.test.js`: policy and boundary tests; remove Stage 3 exclusions superseded by Stage 4.
- `backend/src/services/__tests__/counselorWorkflow.test.js`: PostgreSQL coverage for New, CI, NR, overrides, reassignment, concurrency and paginated classification.
- This report.

Existing user changes, including `authController.js` and Stage 1 frontend work, were preserved. No commit or reset was made.

## New Lead deadline and boundaries

All business boundaries use Asia/Kolkata, independently of server timezone. Both New and NR use the same inclusive office interval: **09:00:00.000 through 17:00:00.000**.

| Assignment time in Kolkata | Untouched New becomes Pending |
| --- | --- |
| 09:00 exactly | 11:00 same day |
| 15:30 | 17:30 same day |
| 17:00 exactly | 19:00 same day |
| 17:00:00.001 or later | 10:00 next day |
| 18:00 or 23:30 | 10:00 next day |
| Before 09:00, including 07:30 | 10:00 same day |

The two-hour daytime deadline is based on the stored assignment time, not worker enrollment time, and is never clamped to 17:00. At the applicable 10:00 deadline, the existing processor may transition; one millisecond before it cannot. Calendar rollover includes month/year changes and leap days. There is no weekend/holiday exception in the supplied rules.

`new_assignment_v1` persists only `move_to_pending_at`. An untouched New lead never receives an Old deadline. It remains in the current managed Received view while moving from New to Pending. Assignment metadata and logical assignment/transition times remain in history.

A counselor remark through an existing adapter invalidates the New generation. An explicit primary starts its policy; a legacy note without a primary cancels aging and awaits an explicit primary. The New worker also checks for counselor notes written outside the adapters before expiring the assignment. It records an observed legacy activity without inventing a primary. Assignment context from another actor does not count as the assigned counselor's work. Terminal legacy changes still invalidate New when observed.

## Approved reassignment

A managed lead may start a fresh New timeout only when the current active assignment audit record has a new ID, is after the rollout cutoff, and matches the current assignment timestamp exactly. The lead must still be unworked by the new counselor since that assignment and nonterminal.

An owner/timestamp change without matching fresh history invalidates the previous workflow and waits for a primary; it does not invent an approved assignment. A valid reassignment clears active primary/queue context into New while preserving the previous journey in transition history. Existing follow-up overrides remain respected.

Enrollment continues to use the existing bounded worker scan. First appearance can lag by a job interval or backlog, while its persisted deadline remains anchored to assignment time. Already managed Stage 2/3 records are not backfilled with new deadlines on reads/ticks. The fixed `COUNSELOR_WORKFLOW_ROLLOUT_AT` gate remains unchanged; no environment setting was modified.

## Retryable Call Issue mapping

`call_issue_v1` uses **2 hours to Old, then 22 additional hours to Pending**, around the clock:

| Existing code | Existing meaning |
| --- | --- |
| `cnr` | Call Not Received |
| `recall` | Recall |
| `busy` | Busy |
| `cb` | Call Busy |
| `rnr` | Ringing No Response |
| `cw` | Call Waiting |
| `nn` | No Network |
| `so` | Switch Off |
| `nc` | Not Connected |
| `call_cut_busy` | Call Cut / Busy |
| `switched_off` | Existing long-form Switch Off code |

The first ten codes reuse `RETRYABLE_CONTACT_ISSUES` from the CRM's existing classification. `switched_off` already exists in the lead-status list and is the equivalent long-form reachability status. Codes are preserved in state/history and responses; no duplicate enum values were introduced.

### Intentionally untimed

`in`, `invalid_number`, `wrong_number`, `ni` (No Incoming), and `language_barrier` retain the repository's terminal lead-quality classification. They may appear as explicit active CI subtypes but receive no retry-aging policy. `ccb` exists in older enums but is absent from the current retryable classification and lacks a clear equivalent mapping there; it remains unchanged and outside the new aggregate CI group.

SC, CR, RM, NT, Converted and Cold remain untimed. RM alone never reassigns ownership; CR retains an existing follow-up/reminder. No generic fallback timer was added.

## NR family

`nr_family_v1` covers exactly:

- `nrac`: Not Responding After Conversation.
- `nracm`: Not Responding After Common Meeting.
- `nrapm`: Not Responding After Personal Meeting.
- `nraf`: Not Responding After Follow-Up.
- `nraq`: Not Responding After Quotation.

During the inclusive office interval, Old starts two hours after saving the primary. Outside it, Old starts at 10:00 the same morning for pre-09:00 saves, or next morning for post-17:00 saves. Pending is always **14 additional hours after the logical Old deadline**. These codes were already accepted by the Stage 2 versioned workflow and require no legacy enum migration.

## Membership, worker and overrides

Call Issue/NR journeys remain active alongside Old. Pending clears both active CI/journey and Old membership while retaining primary context and history. A new primary replaces deadlines and increments generation; queued jobs from the older generation cannot transition it. Duplicate worker execution remains idempotent.

The existing worker and scheduler are reused unchanged. Logical deadline times are recorded even when processing is late. After downtime, an overdue Old transition is processed before its Pending transition on a subsequent tick. No browser timers or second scheduler were introduced.

`leads.next_followup_at` and the persisted override flag still block automatic aging, including New timeouts and every mapped Call Issue/NR policy. A follow-up added after entry into Old also blocks Pending. As in Stage 2/3, elapsed follow-up time alone does not clear the override or define a new resume policy.

## API/query changes

Existing Stage 2 routes and authorization remain unchanged. The versioned workspace endpoint now accepts:

- `view=received`: current managed assignments for the requesting counselor, regardless of queue. This is not a historical assignment-count report.
- `view=call_issues`: active primary belonging to the retryable, NR or existing lead-quality groups above.

Existing subtype, New, Old and Pending views still work. Secondary statuses do not put a lead into CI. Each response preserves the actual primary code. Count and paginated rows share the same materialized classification query; no separate client-side count logic was added. Stage 1 tab order and frontend connections remain untouched.

## Verification

Executed from `backend`:

- `node node_modules/jest/bin/jest.js --runInBand`: **12 suites passed; 243 tests passed**, with 119 database cases skipped in this ordinary run.
- `node scripts/test-counselor-workflow-postgres.mjs`: **2 suites passed; 250 checks passed**, including all **119 PostgreSQL integration tests**. The remaining 131 checks overlap the ordinary run.
- `node --check` on all four changed JavaScript files: **passed**.
- `git diff --check`: **passed**.
- `node node_modules/eslint/bin/eslint.js src/`: **blocked** by the repository's missing ESLint 9 `eslint.config.*` file.

Coverage includes daytime/overnight New, direct Pending without Old, all mapped retryable statuses, office/evening/morning paths for every NR subtype, inclusivity and calendar boundaries, interruption before Old/Pending, duplicate workers, stale generation, New-versus-remark race, reassignment guards, legacy note reconciliation, N/O source preservation, all overrides, CI/Old/Pending parity, and prospective legacy behavior. Stage 3 policy regressions continue to pass.

A 27-lead CI fixture verified page sizes 25 and 2 with the same total and no repeated/missing IDs. `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` used the workflow-owner index and lead primary-key index; that fixture query took 0.401 ms. This is a small-fixture diagnostic, not a production-scale performance claim.

Tests created and stopped a separate temporary loopback PostgreSQL cluster. The unchanged Stage 2 migration was applied only to the isolated minimal fixture schema. No existing CRM database or production migration was used. Temporary test data is retained for inspection.

The final Jest run reported all 250 checks passed. Its Node launcher remained alive after database shutdown and was explicitly closed after process inspection confirmed that the test PostgreSQL server had stopped. The wrapper therefore ended with exit code 1; the passing result above refers to Jest's observed suite results, not a clean wrapper exit.

Backend has no typecheck/build script. No frontend code changed, so frontend typecheck/build/browser verification was not rerun. Full-schema staging and HTTP smoke testing were not performed.

## Legacy conflicts and Stage 5 notes

Legacy call attempts use their existing 09:00–19:00 schedule and retry sequence, and older reports use separate unworked thresholds. Those rules remain unchanged; the new 09:00–17:00 aging applies to the versioned counselor workflow. Legacy V2 mappings and APIs remain separate, as documented in Stage 3. NR statuses and the full primary set should use the versioned remark API; older remark validators do not accept all of them.

Nontransactional legacy assignment paths with mismatched audit/current timestamps cannot authorize a new managed reassignment timeout; they await an explicit primary. UI integration, reconciliation of mixed legacy mutation paths, full-schema staging, and production-scale plans remain rollout considerations.

Stage 5 must preserve the stored pre-remark source: `new`, `old`, or null. The same lead may have both N and O events; deduplicate separately within each source/reporting period, never across N and O. Untouched New-to-Pending transitions are not work. No final Worked query, counter or UI was implemented here.

No production migration, deployment, or Stage 5 work was performed. Stop for Stage 4 review.
