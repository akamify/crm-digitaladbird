# Stage 6 — Rollout readiness and operator runbook

## Decision

**PASS for readiness preparation and local automated verification. GO for review and a dedicated staging rehearsal. NO-GO for production activation today.**

Production backup/restore validation, a staging smoke run, production-capacity validation, and pilot acceptance have not occurred. Responsive visual acceptance is separately pending. This report is not deployment authorization. No production migration, deployment, configuration change, or user activation was performed.

## Findings fixed

1. A timestamp alone previously enabled every counselor. The workflow now defaults off and supports explicit pilot activation dates per member/partner.
2. Disabled counselors previously saw an unavailable versioned workspace. They now receive the existing `CounselorLifecycleWorkspace`. Admin/RM page selection remains unchanged.
3. Overlapping timer ticks and multiple process instances could repeat database work, despite per-lead transition protection. A PostgreSQL advisory lock now admits one versioned batch; local ticks do not overlap, and shutdown waits for the active batch.
4. A failed lead previously aborted the remainder of its batch. Per-lead failures now roll back, are logged, and retry next tick while other leads continue.
5. Manual lead initial remarks missed the work-event adapter. They now use their saved remark ID in the existing transactional observer.
6. Legacy lifecycle record/complete/close/reopen and personal-meeting paths could leave versioned deadlines active. They now invalidate existing managed state transactionally, without inventing a primary or work event. A subsequent explicit primary restarts the journey.
7. Workflow query caches lacked counselor identity. List, detail, and flag caches now include the caller ID; placeholder data cannot cross counselors.

No approved timer duration, queue policy, role permission, reporting definition, or schema was changed in Stage 6.

## Scope and changed files

- `backend/src/services/counselorWorkflowRollout.js` — new fail-closed flag parser and per-counselor activation boundary.
- `backend/src/services/counselorWorkflowService.js` — gates, batch locking, failure isolation, structured logs, legacy invalidation.
- `backend/src/services/counselorWorkspaceService.js` — includes legacy invalidation in compact history.
- `backend/src/routes/lifecycle.js` — authenticated counselor configuration endpoint.
- `backend/src/jobs/lifecycleDeadlineJob.js`, `backend/src/server.js` — nonoverlapping execution and shutdown drain.
- `backend/src/controllers/leadController.js`, `backend/src/services/lifecycleService.js` — narrow legacy adapters.
- `frontend/src/hooks/useCounselorWorkflow.ts`, `frontend/src/app/leads/page.tsx` — caller-scoped caches and pilot/legacy selection.
- `frontend/src/components/leads/CounselorJourneyTracker.tsx` — labels non-remark legacy updates accurately.
- `backend/src/services/__tests__/counselorWorkflow{,Rollout,Readiness,Routes,Worker}.test.js` — rollout, regression, API, concurrency, shutdown, migration and scale verification.
- `frontend/scripts/counselor-leads.test.cjs` — cache isolation coverage.
- `backend/counselor-workflow.env.example`, `backend/scripts/counselor-workflow-health.sql` — operator configuration and read-only monitoring.
- `STAGE6_QUERY_PLANS.json` — synthetic query-plan evidence; no customer data.

Existing user edits, including `authController.js`, are preserved. The repository remains dirty with Stage 1–6 work; reconcile and review it before creating an immutable release artifact.

## Flags and prospective rollout

| Setting | Meaning |
| --- | --- |
| `COUNSELOR_WORKFLOW_MODE=off` | Default. No versioned enrollment, remark commands, deadline transitions, or legacy observers. Reads report disabled. History remains stored. |
| `COUNSELOR_WORKFLOW_MODE=pilot` | Only member/partner IDs listed in PILOTS with an activation time already reached are eligible. |
| `COUNSELOR_WORKFLOW_MODE=all` | All member/partner users are eligible after the global cutoff. Existing pilot dates remain effective. |
| `COUNSELOR_WORKFLOW_ROLLOUT_AT` | Explicit ISO timestamp with offset. Required, and must have arrived. This alone never enables the feature. |
| `COUNSELOR_WORKFLOW_PILOTS` | JSON object: counselor UUID to ISO activation timestamp. Empty by default. |
| `COUNSELOR_WORKFLOW_WORKER_ENABLED=false` | Disable versioned batch processing on an API-only instance. Does not disable writes or the independent legacy lifecycle worker. Default is enabled. |

Example configuration to prepare, never copy without substituting approved values:

```dotenv
COUNSELOR_WORKFLOW_MODE=pilot
COUNSELOR_WORKFLOW_ROLLOUT_AT=2026-10-01T09:00:00+05:30
COUNSELOR_WORKFLOW_PILOTS={"11111111-1111-4111-8111-111111111111":"2026-10-01T09:00:00+05:30"}
COUNSELOR_WORKFLOW_WORKER_ENABLED=true
```

The example UUID is synthetic. Malformed configuration fails closed with `WORKFLOW_CONFIG_INVALID`; it never broadens scope. Store real values in the approved environment/configuration mechanism and restart all backend instances consistently. No production `.env` file was read or modified for activation.

Expansion: internal accounts → small member/partner pilot → larger pilot map → all. Add each new counselor with their actual activation instant, without backdating. On expansion to all, keep existing pilot entries and set the global cutoff to the expansion instant for everyone else. Never move an existing counselor's start backwards.

Post-activation assignments may enter New. Older assignments remain unenrolled until real new activity, and do not receive fabricated New attribution. Existing stored state/history remains intact when a user leaves the pilot.

`GET /api/counselor-workflow/v1/config` returns `{success:true,data:{enabled:boolean}}` for the authenticated member/partner only. It exposes no pilot list. The frontend polls configuration every 30 seconds; API write gates apply immediately on the restarted backend. A stale browser form receives a disabled response. Configuration errors display retry rather than silently enabling a workspace.

## Migration review

Migration order is lexical. `074_counselor_workflow_foundation.sql` follows `073_counselor_lifecycle_v2.sql`; the ordinary migrator executes all pending files, so inspect the migration ledger before using it.

074 adds two tables and five indexes. It does not alter existing lead columns, backfill leads, or synthesize events. Existing records therefore have no workflow row. New state defaults include generation 1, inactive journey, no queue/primary/deadline, and false override/awaiting flags, with explicit enrollment/start times required by the service. Events default to empty status/context containers and `is_work=false`; nullable work source must be New or Old when present.

The DDL is transactional and uses `IF NOT EXISTS`. Applying it twice was tested. **Repeat-safe does not mean schema-drift-safe:** existing tables/indexes with wrong definitions must be compared against the reviewed migration; `IF NOT EXISTS` does not repair them.

Old application code tolerates unused additive tables. Deploy 074 before an enabled backend. Foreign keys retain the CRM's existing explicit deletion semantics. Event history is append-only through the service, not protected from privileged DBA edits by a database trigger.

Indexes are ordinary CREATE INDEX on initially empty new tables, so the first rollout does not build indexes over the large lead table. Foreign-key DDL briefly locks referenced parent tables; use lock timeout and an approved low-traffic window. If the tables already contain data and an index is missing, stop and design a separate concurrent-index operation; do not blindly rerun DDL under load.

Synthetic migration evidence: 50,000 existing leads, no workflow rows initially; applying 074 twice took 20 ms locally. This excludes production lock contention, I/O, replica lag, and a populated workflow schema. Budget a maintenance window and repeat on an isolated production-sized restore before scheduling production.

## Backup and recovery requirements

Before any production migration, the operator must:

1. Record target database, current release, migration ledger, row counts, database size, free disk, replication health and owner of the change window.
2. Take a provider snapshot/PITR checkpoint and a protected logical backup using the site's approved database credentials. Record backup location, checksum and retention. Do not place backups or credentials in this repository.
3. Verify the archive can be listed, then restore it into a **separate empty recovery database**. Listing alone is not a restore test. Verify tables, row counts, required extensions/roles, application reads and restored migration ledger. Record elapsed restore time against agreed RTO/RPO.
4. Keep the last known-good backend/frontend artifacts and sanitized configuration diff available.

If migration fails, the transaction rolls back. Investigate and retry only after verifying the ledger/schema. If the application fails, disable the feature and roll back application artifacts first; leave additive tables/indexes in place. A full database restore is a last resort because it can discard unrelated writes after the backup. Fence writes and get incident-owner authorization before choosing a recovery point. Never drop the workflow tables as an automatic rollback.

## Worker readiness

- Existing PM2 configuration runs one `crm-backend` process. `startLifecycleDeadlineJob` starts at boot, then every 60 seconds.
- Versioned enrollment and deadline selections each default to 100 rows and cap at 200. Processing is sequential and each lead has its own transaction. The coordinator occupies one extra connection; keep `DB_POOL_MAX >= 2` (repository default 20).
- Transaction advisory lock `(74001,1)` allows one versioned batch across processes. Other instances skip it. Mark non-designated API instances worker-disabled if the deployment scales beyond one process. Legacy jobs still have their own existing behavior.
- Lock order for versioned work is lead then workflow state. Generation, assignment identity, exact deadline, primary, override and terminal checks remain active. A unique `(lead_id,idempotency_key)` guards duplicate event writes.
- A failing lead rolls back and retries at the next tick; other selected leads continue. Persistent errors require intervention and can consume bounded batch capacity. There is no infinite retry loop inside a batch.
- Default aging is suppressed by either the stored custom-follow-up override or the live lead follow-up field. The override remains effective after its timestamp passes, as previously approved.
- Deadlines are durable. Restart resumes eligible due rows. If both Old/Pending elapsed during downtime, Old is recorded first and Pending on a later tick. Event time preserves the deadline; `recorded_at` shows actual processing time.
- Shutdown stops new intervals and drains the active tick before closing the pool. PM2 may force termination after its existing 10-second timeout. PostgreSQL rolls back the in-flight transaction and releases its advisory lock; already committed leads remain committed and unprocessed rows retry after restart. Drain completion is not guaranteed for a full slow batch.
- Expected load is two bounded selection queries plus per-lead lock/read/write/event transactions, not an unbounded in-memory queue. Monitor tick duration and backlog; increasing process count does not increase the single coordinator's throughput.

## Business time and data validation

No timer policy changed. Tests pass with process TZ set to UTC and America/New_York (121 policy cases in each). Business-date calculation explicitly uses Asia/Kolkata; elapsed durations and stored instants do not depend on local server time. PM2's existing Asia/Kolkata setting is retained. Verify NTP, Node clock, `SHOW timezone` and `SELECT NOW()` in staging/production; these deployed settings were not remotely inspected.

Worked still means N+O: distinct leads per actor/source within Kolkata work-date bounds, deduplicated within each source and allowed in both. A lead appears once in the list with both badges. Untouched New timeout contributes no work. Received uses assignment date. One shared SQL classification supplies all 22 count/list definitions; Worked counter and unique pagination total intentionally differ.

The PostgreSQL scenarios cover New→CC→Old→Pending, Responded cutoff, PM, CNR, NR day/overnight, untouched New, override, N/O and combined work, deduplication, work-date/received-date separation, permissions and count/list parity. These are isolated service/database smoke tests, not a deployed staging smoke run.

## Query/index findings

See `STAGE6_QUERY_PLANS.json`. Synthetic fixture: 50 counselors, 50,000 leads and assignments, 500,000 work events; 1,000 leads and 10,000 events for the queried counselor. PostgreSQL 18.3 on the local test machine, UTC database session, warmed cache, one concurrent test client.

| Query | Observed execution |
| --- | --- |
| Shared tab classification, counts, page, work-date/search filter | 66.083–81.708 ms |
| Compact history for a page | 0.688–1.085 ms |
| Enrollment selection | 18.033 ms |
| Deadline selection with no due candidates | 0.133 ms |
| Full history pagination | 0.051 ms |

Work-source and history indexes were used. Assignment owner/date indexing from migration 071 is represented in the fixture. The planner also selected sequential scans on leads/assignment access sets; these were single scans, not per-card queries. Batched history avoids N+1 requests. The fixture does not reproduce skewed high-volume counselors, many reassignment records, years of history, real row widths, concurrent traffic, busy deadlines, or the deployed PostgreSQL version. No new index is justified by this measurement alone. Do not call this a production latency guarantee. Repeat the plans on an isolated representative restore and measure p95 API latency/worker lag under expected traffic before expanding.

## Authorization, API compatibility and legacy boundaries

- Versioned routes require authentication and member/partner roles. Current owner is required to write. Historical access still requires the existing previous-owner assignment audit; it grants read-only access only.
- Flags never replace authorization. Admin/RM remain on their existing UI and API contracts. Route tests verify denied roles and preserved response envelopes; they mock authentication, while database tests verify ownership boundaries. They do not substitute for a real staging JWT/session test.
- Old endpoints and their request/response shapes remain. Disabled mode requires no workflow tables in legacy write paths. Enabled legacy saves call the centralized observer inside the existing transaction. Primary remains explicit; an old client that cannot send it leaves a managed lead awaiting an explicit primary instead of guessing from status order.
- Manual/bulk remarks use `createLeadInteraction` or the new manual-create adapter. Call-log remarks use their saved remark IDs. Call-attempt success/terminal remark paths use `createLeadInteraction`; retry outcomes use the existing attempt-ID adapter. Conversion and legacy lead-level adapters remain.
- Lifecycle actions and personal meetings invalidate managed deadlines as **non-work** state updates. They do not silently add N/O, create a new timer, or rewrite old history. Their original permission checks remain.
- Legacy lifecycle actions, call retry schedules, action queue and reports retain their own definitions. The versioned UI does not consume their queue membership. They may still expose legacy reminders/actions outside `/leads`; completing them invalidates versioned state and requires a new primary. Validate this visible interaction with pilot users. Stage 6 does not redesign those screens or reconcile historical reports.
- Assignment changes are detected using current owner/timestamp and the assignment audit; stale jobs cannot apply to the new assignment. No historical state reconstruction is performed.
- Do not write workflow-affecting columns directly through SQL/import tooling. Such writes bypass API transactions and are outside the validated adapter contract. Audit any deployment-specific integrations before activation.

## Observability and alerts

Existing Pino logs are used; no monitoring stack is added. Filter `component=counselor_workflow`. Events include `worker_batch`, `worker_batch_failed`, `worker_lock_skipped`, `enrollment_failed`, `transition_success`, `transition_failed`, `stale_skipped`, `duplicate_skipped`, `override_skipped` and `transition_skipped`. IDs, generation, policy version, transition and deadline lag are included where available. Error logs use error codes, not remark text, customer contacts or request payloads.

Batch results expose selected, enrolled, transitioned, failed and duration. A committed transition is logged after its transaction completes. Most custom-follow-up rows are filtered before selection; use the health SQL's aggregate override count in addition to race-time skip logs. Replayed deadline jobs often classify as stale because their due field was already cleared; stale/duplicate skips must not be treated as transition failures.

Run `backend/scripts/counselor-workflow-health.sql` through an operator connection after 074. It is read-only and bounds statement time to five seconds. It reports version/queue usage, override/awaiting counts, due backlog/lag, transitions and recorded delay. Counts include paused/nonpilot records; restrict to the approved active pilot when creating alerts. It is not exposed as a public endpoint and creates no scheduler.

Recommended initial alerts (tune against the staging baseline):

- No worker batch heartbeat for 3 minutes while an eligible worker should be enabled.
- Active-scope backlog rises for 5 consecutive minutes, or oldest eligible deadline lag exceeds 5 minutes.
- Any repeated batch failure, or transition failures above 1% over 5 minutes; inspect codes before retrying configuration/schema errors.
- Counselor API 5xx above 1% over 5 minutes, or p95 above 1 second for 5 minutes.
- Database query latency >2× staging baseline, pool exhaustion, lock waits, replica lag or repeated statement timeouts.
- Any migration error: stop the rollout immediately.

These thresholds and dashboards are recommendations, not installed production alerts. Existing migration logging remains in the migrator. Run migrations through a protected operator console, not public application logs.

## Dedicated staging/pilot smoke checklist

No designated staging environment was supplied; this checklist was not executed against a deployed application. Use test accounts and disposable test leads only. Do not shorten real policies or edit real customer deadlines.

1. Restore a sanitized representative backup to isolated staging, rehearse 074, deploy backend with mode off, then frontend. Confirm old counselor, Admin and RM behavior, strict DB health, authorization and no workflow enrollment.
2. Activate one internal member and one partner at current timestamps. Keep another counselor outside the pilot. New assigned test leads must appear in Received+New only for enabled counselors; historical assignments must not be backfilled.
3. Save explicit CC: New disappears, CC appears, N=1. At +1h expect CC+Old; at +21h expect Pending only, preserving New→CC→OL→Pending history.
4. On a separate lead, save PM: Old at +1h, Pending at +6h. Save CNR: Old at +2h, Pending at +24h.
5. Save Responded before 21:30 Kolkata: Old at the approved cutoff, Pending +20h. Test equality/after-cutoff boundaries using the isolated clock-controlled suite rather than changing server time.
6. Test NRAC during 09:00–17:00: Old +2h, Pending +14h more. Outside that window use the next applicable 10:00 Kolkata deadline, then +14h. Untouched New uses the approved 2h/10:00 rule and moves directly to Pending without work.
7. Work a New lead, then work it again from Old. Expect N=1, O=1, Worked=2 and one card with both badges. Repeat saves without increasing either bucket. Verify a lead received yesterday is Worked today without appearing in today's Received.
8. Set a custom follow-up, cross the default deadlines, confirm no aging; keep/clear it through the explicit-primary form and verify the approved behavior.
9. Exercise all 22 tabs with search, filter, date range, pagination and empty results. Compare server summary and membership; distinguish Worked total from unique cards.
10. Verify current/history separation, legacy actions requiring a new primary, reassigned read-only leads, invalid ownership requests, duplicate save retries, restart/retry and multi-instance lock skips.
11. Verify mobile/browser acceptance at 320/360/375/390/430 px, tablet and desktop, including overflow, internal tab scrolling, selected-tab visibility, toolbar, sheets, sticky spacing, cards, N/O, history, pagination and loading/error states.
12. Disable the flag, restart all backends, verify writes stop and old UI returns after config refresh; counts/history rows must remain stored. Do not re-enable until the resume review below is complete.

Pilot acceptance requires a full longest tested timer cycle (at least 24 hours), stable worker/API metrics, correct N/O, no disappearing/unauthorized leads, no duplicate transitions, override success and usable mobile UI. Expand only after a named reviewer records these results; a passing local test suite alone is insufficient.

## Exact future rollout steps — NOT executed

Commands below target Linux/PM2, matching `ecosystem.config.js`. The operator must choose and verify `CRM_RELEASE_DIR`, backup location, `PGSERVICE` entries and the approved immutable release. Service entries use protected credential storage; do not paste database passwords into shell history. Avoid the repository's broad deployment scripts until their migration/restart effects are reviewed.

```bash
# Read-only preflight, from the approved release directory.
cd "$CRM_RELEASE_DIR"
git status --short
git rev-parse HEAD
pm2 describe crm-backend
pm2 describe crm-frontend
curl --fail http://127.0.0.1:4000/health/db-strict
psql 'service=crm-production' -X -v ON_ERROR_STOP=1 -c 'SELECT filename,applied_at FROM schema_migrations ORDER BY filename;'

# Backup to a protected, existing directory chosen by the operator.
umask 077
pg_dump 'service=crm-production' --format=custom --file="$CRM_BACKUP_FILE"
sha256sum "$CRM_BACKUP_FILE"
pg_restore --list "$CRM_BACKUP_FILE"
# crm-recovery must be a separately provisioned EMPTY recovery database.
pg_restore --dbname='service=crm-recovery' --exit-on-error "$CRM_BACKUP_FILE"
```

Verify the restored backup and a provider recovery checkpoint before proceeding. Confirm 001–073 are applied, the reviewed 074 is the only pending change, and any existing workflow schema matches. Stop for any unexpected migration or schema drift.

```bash
# Apply only reviewed 074 and its ledger entry, in one transaction.
cd "$CRM_RELEASE_DIR/backend"
psql 'service=crm-production' -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
\i src/db/migrations/074_counselor_workflow_foundation.sql
INSERT INTO schema_migrations(filename)
VALUES ('074_counselor_workflow_foundation.sql') ON CONFLICT DO NOTHING;
COMMIT;
SELECT filename,applied_at FROM schema_migrations
WHERE filename='074_counselor_workflow_foundation.sql';
SELECT indexname FROM pg_indexes
WHERE tablename IN ('counselor_workflow_state','counselor_workflow_events');
SQL
```

Then install/deploy the reviewed backend artifact with mode off. Ensure the process's actual configuration source contains mode off (PM2 inherited environment can override dotenv). Build artifacts in CI or the release directory with the approved production frontend configuration:

```bash
cd "$CRM_RELEASE_DIR/backend"
npm ci
cd "$CRM_RELEASE_DIR/frontend"
npm ci
npm run build
cp -a public .next/standalone/
mkdir -p .next/standalone/.next
cp -a .next/static .next/standalone/.next/
cd "$CRM_RELEASE_DIR"
COUNSELOR_WORKFLOW_MODE=off pm2 restart ecosystem.config.js --only crm-backend --update-env
curl --fail http://127.0.0.1:4000/health
curl --fail http://127.0.0.1:4000/health/db-strict
pm2 restart ecosystem.config.js --only crm-frontend --update-env
```

Verify running release/cwd, frontend asset delivery, old behavior, authenticated config response and worker health. This new frontend expects the config endpoint; rolling back the backend to a pre-Stage-6 version also requires rolling back the frontend.

Only after separate production authorization: set the approved pilot JSON/timestamps in the actual process configuration, set mode pilot, and restart all backend instances with `--update-env`. Verify eligible and noneligible authenticated config responses, execute the pilot checklist, collect metrics, then approve each expansion phase. Do not put an example UUID into production or enable mode all initially.

```bash
# Read-only operational sampling after an authorized migration/activation.
cd "$CRM_RELEASE_DIR/backend"
psql 'service=crm-production' -X -v ON_ERROR_STOP=1 -f scripts/counselor-workflow-health.sql
pm2 logs crm-backend --lines 100 --nostream
```

## Rollback and resume

1. Set `COUNSELOR_WORKFLOW_MODE=off` in the authoritative configuration and restart **every** backend instance. For the current single-process deployment:

```bash
cd "$CRM_RELEASE_DIR"
COUNSELOR_WORKFLOW_MODE=off pm2 restart ecosystem.config.js --only crm-backend --update-env
curl --fail http://127.0.0.1:4000/health/db-strict
```

2. Verify an authenticated counselor config read reports disabled and a versioned save is rejected. No new batch should run on restarted processes. An old process can finish a transaction before it stops; disabling is not a cross-process instantaneous transaction cancel.
3. Stored state, queued deadlines, work events and journey history remain in the additive tables. Queued deadlines are dormant, not deleted. Legacy UI resumes after the flag query refreshes. Legacy activity while disabled is not retrospectively added to versioned Worked.
4. If needed, restore both backend/frontend artifacts and their known-good configuration, keeping the schema. Never use a hard reset, delete workflow tables or reconstruct old state automatically.
5. **Resume is a reviewed operation.** Legacy edits during the disabled interval are not captured by disabled observers. Blindly re-enabling the same scope could resume obsolete stored deadlines. Audit affected managed leads against post-disable legacy activity and establish a new explicit primary through the authorized API before resuming automated aging for those leads. Do not bulk infer their prior queue or work source. Keep the versioned worker disabled during a controlled resume review; if that reconciliation cannot be demonstrated, remain off and NO-GO.

## Verification record and remaining gates

- Ordinary backend suite: 15 suites pass; 266 tests pass, 170 database-only tests skip in that mode and run separately below.
- Isolated PostgreSQL workflow suite: 6 suites, 324 tests pass, including rollout, work attribution, timer regressions, migration repeatability, locking/failure/restart protection and synthetic-scale checks.
- Policy timezone runs: 121 tests pass under UTC, and 121 under America/New_York. These overlap the workflow suite.
- Frontend focused rendering/hook tests: 14 pass. They verify contracts/output and cache isolation, not CSS geometry or actual browser interaction.
- TypeScript and frontend lint pass; lint retains existing repository warnings. Frontend production build passes.
- Backend syntax checks pass. Backend lint remains blocked by ESLint 9's missing `eslint.config.js/mjs/cjs`; no unrelated tooling migration was made.
- Diff whitespace check passes. No production data was used in tests.
- Browser reconnect was attempted using the browser skill; setup still fails with `codex/sandbox-state-meta: missing field sandboxPolicy`. All requested responsive widths remain **unverified**.
- Production PostgreSQL version/volume, restore capability, staging JWT/legacy integration smoke tests, deployment configuration, alerts and pilot experience remain unverified.

GO requires the rehearsed migration/backup restore, healthy worker, acceptable representative performance, verified auth/legacy interactions, controlled pilot, rollback rehearsal and named approval. Any destructive migration, unsafe query behavior, authorization leak, conflicting legacy writes, duplicate transition, count/list defect, broken override or inability to disable transitions is NO-GO. Mobile visual acceptance remains a separate recorded gate and is required before recommending wider counselor rollout.

Stop after readiness preparation. Await explicit production authorization.
