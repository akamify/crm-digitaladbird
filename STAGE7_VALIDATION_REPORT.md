# Stage 7 — Validation and production gate

## Overall result: FAIL — Production pilot blocked

**Recommendation: NOT READY. Production pilot NO-GO.**

Local automated functional checks pass. This is not a functional staging PASS: no designated staging URL, connection profile, deployed release, or staging-only account access was supplied or found in the deployment documentation inspected. Access details were requested. Browser tooling remains blocked. Do not substitute local tests for staging, visual or counselor acceptance.

No production migration, deployment or production-counselor activation occurred. Stage 7 changes only test tooling and evidence documents. Application code, timer policies, schema migrations and user edits remain unchanged.

## Environment and migration

| Gate | Evidence/result |
| --- | --- |
| Latest Stage 1–6 code in local workspace | Tested current working tree; prior stage work and user edits remain uncommitted. |
| Latest release deployed to staging | BLOCKED — target/release identity unavailable. |
| Migration 074 | PASS locally: verbatim additive SQL applied twice against isolated PostgreSQL 18.3 with 50,000 existing synthetic leads; 33 ms combined. |
| Safe defaults/prospective behavior | Local tests pass: migration does not enroll existing records or create history; reads do not backfill; per-counselor activation dates enforced. |
| Required indexes | Exercised by local query-plan tests. |
| Real staging migration/ledger/application startup | NOT RUN. No existing staging or production database was connected. |
| Business timezone | Tests exercise explicit Asia/Kolkata calculations; the scale fixture uses a UTC database session. Deployed clock/configuration unverified. |
| Default-off/pilot scope | Local tests pass for member/partner isolation, future dates, malformed flags and disable. |

Local regression command, from `backend`, with a Stage 7 report path:

```powershell
$env:COUNSELOR_WORKFLOW_PLAN_REPORT='../../../../STAGE7_QUERY_PLANS.json'
node scripts/test-counselor-workflow-postgres.mjs --recovery
```

The script creates its own loopback-only temporary cluster; it does not read `DATABASE_URL` or `.env`. Its schema is a minimal test representation, not the full staging application schema. Migration 074 adds empty workflow tables/indexes without changing legacy lead rows. Emergency rollback should retain that additive schema, as documented in Stage 6.

## Backup/restore rehearsal

**PASS locally:** the completed clean-shutdown run verified all 12 public/readiness tables with matching row counts and content fingerprints. Backup took **7,538 ms**; restore, startup and validation took **44,694 ms**. Health SQL and restored workflow-service reads passed. Both source and restored clusters shut down cleanly. See `STAGE7_RECOVERY_RESULTS.json` for table/index evidence and retained temporary backup locations. **The real staging backup/restore gate remains pending.**

The available embedded distribution contains PostgreSQL server tools but no `pg_dump`/`pg_restore`, and no external client installation was found. The local rehearsal therefore uses a **cold physical backup**: fingerprint test records, cleanly stop PostgreSQL, copy the entire test cluster into a backup directory, copy the backup into a separate recovery directory, start the recovered cluster, then compare every public/readiness table's row count and content fingerprint. It also executes the health SQL and reads a recovered managed lead through the actual workflow service with an injected test database.

Only fresh temporary `crm-workflow-test-*` directories are accepted by the helper. No data is deleted. Evidence is written to `STAGE7_RECOVERY_RESULTS.json` only after validation succeeds. This does not validate a full CRM backup, a hosted staging snapshot, cross-version recovery, deployed application login, or production RTO/RPO. A separate staging backup/restore remains a production gate.

The first attempt was interrupted. On retry, the embedded package's Windows `stop()` used forced process termination and left a child/port behind. The helper was corrected to use `pg_ctl stop -m fast -w` and to handle failed-start cleanup without ending the same pool twice. Only explicitly identified test processes were stopped. These failures are retained here rather than counted as successful restores.

## Browser and responsive QA: BLOCKED

Browser skill setup was attempted and retried after the user's continuation. Both attempts failed before page access:

`codex/sandbox-state-meta: missing field sandboxPolicy`

No screenshots were captured. **320, 360, 375, 390, 430 px, tablet and desktop are all unverified.** Overflow, clipping, overlap, fixed-toolbar spacing, tab-strip containment, selected-tab scrolling, keyboard behavior, filter-sheet interaction, card geometry and browser pagination cannot be signed off by static rendering tests.

The exact 22-tab key order passes the frontend regression test: Received, New, Old, Worked, Pending, CC, Responded, CI, CM, DIM, PM, Follow-Up, Quotation, Hot, Warm, SC, CR, RM, NT, Converted, Cold, PI. Versioned-workspace tests also verify no removed page-level buttons or permanent inline filters are rendered. Disabled counselors intentionally retain their preexisting legacy workspace. Actual click/selected-state QA remains blocked.

## Workflow smoke matrix

Every PASS below means **isolated service/PostgreSQL or policy test**, not a deployed staging/browser pass. The staging result for each row remains pending.

| Scenario | Local result and assertion |
| --- | --- |
| Received + New | PASS — post-activation assignments enroll prospectively. |
| Untouched New | PASS — approved daytime/overnight boundaries; Pending directly, no Old/work event. |
| CC | PASS — +1h Old, +20h more Pending; primary/Old overlap and cleanup. |
| Responded | PASS — before/exactly 21:30 same-day cutoff, after cutoff next day; +20h Pending. |
| Common Meeting / DIM | PASS — +15h Old, +20h more Pending. |
| PM / Quotation | PASS — +1h Old, +5h more Pending. |
| Follow-Up | PASS — +18h Old, +6h more Pending. |
| Hot / Warm / PI | PASS — +6h Old, +18h more Pending. |
| CNR and configured retryables | PASS — +2h Old, +22h more Pending; exclusions retain existing behavior. |
| NRAC / NRACM / NRAPM / NRAF / NRAQ | PASS — 09:00/17:00 boundary coverage, daytime +2h or applicable 10:00; +14h Pending. |
| Primary/secondary | PASS — explicit included primary required; secondaries retained without competing timers. |
| Custom follow-up | PASS — default aging blocked even after follow-up time; explicit keep/clear behavior tested. Actual staging reminder delivery is unverified. |
| Current state/history | PASS — Pending hides active primary/Old; immutable prior transitions retained. |
| All tab classifications | PASS — shared count/list predicates; unique pagination, search/filter/date coverage. |

### Worked N/O and list

Tests confirm New work produces N=1/O=0/Worked=1; later work on the same lead from Old produces N=1/O=1/Worked=2. Each source deduplicates lead IDs within the period, while cross-source contribution is allowed. Untouched New creates no work. Work date and received date are independent. The frontend renders a single card with both source badges. These checks include negative statuses, legacy free-text work, midnight boundaries, reassignment and custom overrides.

### Journey tracker

Immutable event history supplies the tracker, with eight compact recent events and separately paginated full history. Tests cover New→CC→OL→Pending, distinct current state, and complete history across multiple pages. Typography, wrapping and usability on devices remain visually unverified.

## Pilot isolation, authorization and rollback drill

Local tests pass for an enabled counselor versus a disabled counselor, current-owner write checks, previous-owner read-only access, cross-counselor scope rejection, denied Admin/RM roles on counselor-only routes, actor-specific caches, generation conflicts, idempotency and disable preserving stored history. Flags do not grant permissions.

Route tests use mocked authentication; they do not verify deployed JWT/cookie behavior. A real two-counselor staging exercise through direct IDs, bulk remarks and call-outcome endpoints remains required, as do Admin/RM browser smoke checks. No live account was activated.

The local disable drill confirms versioned ticks/saves stop and history remains. Browser fallback usability was not exercised. Do not blindly re-enable after legacy edits while disabled; follow the Stage 6 resume audit and explicit-primary requirements. No destructive schema rollback was attempted.

## Worker and monitoring

Local tests pass for advisory-lock exclusion, no overlapping timer callbacks, per-lead failure rollback/retry, stale generations, duplicate requests, custom overrides, durable deadlines and a reconstructed service processing Old then Pending exactly once. Shutdown tests verify that the job waits for an active batch.

**A reconstructed service in a test is not a deployed backend restart.** The required staging process stop/restart with a persisted future deadline is still pending. The local physical recovery restarts PostgreSQL, not the full backend with all production jobs. Long-running staging backlog behavior and instance configuration are unverified.

The controlled failure test checks structured error logging and verifies the injected private error text is absent. Local query/health checks exercise the Stage 6 SQL. No deployed dashboard, alert delivery, worker heartbeat collector or sustained monitoring window has been verified. Alert and pilot-check procedures remain in `STAGE6_ROLLOUT_READINESS.md`.

## Performance and query evidence

See `STAGE7_QUERY_PLANS.json`: 50 synthetic counselors, 50,000 leads/assignments and 500,000 work events. This is a local fixture, not a representative staging restore. The frontend build ran concurrently, so these are observed timings rather than isolated benchmarks.

| Query | Execution time |
| --- | --- |
| Shared tab/count/list classification, including date/search | 57.789–147.623 ms |
| Compact page history | 0.881–2.091 ms |
| Worker enrollment selection | 55.209 ms |
| Worker deadline selection, no due candidates | 1.692 ms |
| Full history page | 0.059 ms |

Existing work-source, assignment and history indexes are exercised; single sequential scans of access sets also occur. No speculative indexes were added. The shared classification avoids count/list divergence and batched history avoids initial N+1 requests. Production-sized skew, deep pagination, heavy reassignment history, concurrent traffic and due-backlog throughput still require staging measurements.

## Automated checks

| Check | Result |
| --- | --- |
| Ordinary backend Jest | PASS — 15 suites, 266 tests; 170 database tests skipped in this mode. |
| Workflow/PostgreSQL run | PASS — 6 suites, 324 tests, including policies, concurrency, worker, rollout and authorization contracts. |
| Frontend focused rendering/hook tests | PASS — 14 tests. |
| Typecheck | PASS — `tsc --noEmit --incremental false`. |
| Frontend lint | PASS with existing repository warnings. |
| Frontend production build | PASS — 47 static pages generated; no deployment. |
| Backend lint | BLOCKED — installed ESLint 9 cannot find `eslint.config.js/mjs/cjs`; not PASS. |
| Recovery-helper/runner syntax | PASS. |
| Local synthetic backup/restore | PASS — 12 tables verified, service reads and health SQL succeeded. |
| Diff whitespace check | PASS; Git reports LF/CRLF conversion notices. |

Test totals overlap and must not be added into a unique-test total. These checks ran during this Stage 7 task; no production verification is inferred from them.

## Issues, fixes and remaining blockers

| ID | Classification | Status |
| --- | --- | --- |
| QA-1 | P2 test-tooling defect: Windows forced shutdown undermined a clean local recovery rehearsal and left test processes. | Fixed in recovery helper using `pg_ctl`; not an application/runtime policy change. |
| GATE-1 | Environment blocker, not a diagnosed application P0/P1: staging target and approved account/connection details unavailable. | OPEN. |
| GATE-2 | Tooling/acceptance blocker: browser cannot connect. Visual usability severity cannot be assigned without observing it. | OPEN. |
| GATE-3 | Acceptance blocker: full staging backup restore, real backend restart, live auth/legacy smoke matrix and pilot-user acceptance not performed. | OPEN. |
| TOOL-1 | Existing verification limitation: backend ESLint 9 configuration missing. | OPEN, documented. |

No new application P0/P1 defect was demonstrated by the executed tests. This is not proof that none exists in staging. No business-rule fixes or UI redesign were made.

Stage 7 files changed: `backend/scripts/verify-workflow-recovery.mjs` (new), `backend/scripts/test-counselor-workflow-postgres.mjs` (opt-in recovery), `backend/src/services/__tests__/counselorWorkflowReadiness.test.js` (separate evidence output), this report, and Stage 7 JSON evidence. Earlier stage files and user edits were preserved.

## Required to finish acceptance

Provide the staging URL and approved staging-only connection/profile location, with dedicated test accounts. Do not send secrets in chat. Then run the deployed migration/status, full backup/restore, auth/legacy smoke, worker restart and disable drills from the Stage 6 runbook. Restore browser access or supply a documented manual visual approval at all required widths. Obtain pilot-counselor acceptance and resolve any P0/P1 before recommending a controlled production pilot.

Until those gates pass: **FAIL — Production pilot blocked. NOT READY.** No production action is authorized by this report.
