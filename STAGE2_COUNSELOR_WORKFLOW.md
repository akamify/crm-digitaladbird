# Stage 2: counselor workflow foundation

## Completion report

Result: PASS for Stage 2 foundation verification. GO for code review; production rollout remains pending. Stage 3 has not started.

Root cause addressed: legacy journey mappings combine statuses and do not represent an independent durable Old/Pending queue with an explicit primary and per-source work history.

Checks run:

- Backend Jest: 11 suites passed, 122 tests passed; 21 PostgreSQL tests skipped in this ordinary run.
- Isolated PostgreSQL runner: 31 checks passed, including all 21 database cases and the 10 validation tests also included above.
- New migration executed twice successfully over the isolated fixture schema.
- All 11 changed/new JavaScript files passed `node --check`; `git diff --check` passed.
- ESLint failed to start because this repository lacks an ESLint 9 `eslint.config.*` file. No lint success is claimed.
- Backend has no typecheck/build script. Frontend typecheck/build and Stage 1 browser verification were not rerun for this backend-only task.
- No deployment, production migration, production query-plan verification, or full application HTTP smoke test was performed. The database tests use a minimal referenced schema, not the entire production migration history.

Files added: this report; `backend/src/db/migrations/074_counselor_workflow_foundation.sql`; `backend/src/services/counselorWorkflowService.js`; `backend/src/services/__tests__/counselorWorkflow.test.js`; `backend/scripts/test-counselor-workflow-postgres.mjs`.

Files updated: `backend/src/controllers/leadController.js`; `backend/src/routes/index.js`; `backend/src/routes/lifecycle.js`; `backend/src/jobs/lifecycleDeadlineJob.js`; `backend/src/services/leadInteractionService.js`; `backend/src/services/leadCallService.js`; `backend/src/services/leadCallAttemptService.js`; `backend/src/services/lifecycleService.js`.

Existing user changes in `authController.js` and Stage 1 frontend files were preserved. The working tree still contains those changes; no commit or reset was made. Legacy integration boundaries and rollout requirements are detailed below.

## Scope and activation

This implementation adds a versioned backend foundation for member/partner counselors. No frontend changes, business timer durations, Worked report queries, or Stage 3 policies are included.

Apply `074_counselor_workflow_foundation.sql` through the existing migration runner before activation. Set `COUNSELOR_WORKFLOW_ROLLOUT_AT` to one fixed ISO timestamp with a timezone on every API and worker replica. An absent or future timestamp disables the new writes and worker. Do not move the cutoff on restarts. Activation and production migration have not been performed by this task.

The migration creates two new tables and their indexes. It does not backfill, rewrite existing lead statuses, or change report queries:

- `counselor_workflow_state`: explicit primary, active journey, nullable New/Old/Pending queue, policy version, generation, assignment reference/time/owner, enrollment/start times, persisted deadlines, follow-up override, and an awaiting-primary marker.
- `counselor_workflow_events`: append-only service history, before/after snapshots, actor, timestamps, source, originating activity, submitted statuses, generation, idempotency/hash, work source and metadata.

Queue and journey are separate. Old may overlap an active journey. Pending hides active journey membership while retaining the primary and history. Database checks reject invalid combinations. There are no event update/delete APIs; existing explicit lead/user deletion semantics remain intact through foreign keys. Database administrators can still modify records directly.

## API contracts

All three endpoints require authentication and the member/partner role:

- `GET /api/counselor-workflow/v1/leads?view=old&page=1`: own managed assignments only; `view` accepts `all`, `new`, `old`, `pending`, or a supported primary status. Count and paginated rows use the same materialized classification query and database snapshot. Page size is 25. Rows expose workflow state, not a replacement full lead-list response.
- `GET /api/counselor-workflow/v1/leads/:id?page=1`: assigned counselor only; state and 50 history events per page. Legacy leads remain readable with `managed: false`. `assignment_current` identifies a stale assignment snapshot.
- `POST /api/counselor-workflow/v1/leads/:id/remarks`: assigned counselor only; returns 201, or 200 for an identical retry. Uses the existing `{ success, data }` envelope.

Example body:

```json
{
  "statuses": ["cnr", "communication_completed"],
  "primary_status": "communication_completed",
  "remark": "Spoke with the customer",
  "expected_generation": 0,
  "idempotency_key": "client-generated-unique-key"
}
```

Read the current generation before submitting; use zero for an unmanaged lead. Primary must explicitly belong to the submitted status array. Only primary drives the new journey. Secondaries remain in history and `lead_remarks.call_statuses`. Missing/invalid primary is rejected. Stale generation or reused key with different content returns 409. Retrying identical content is safe even if the generation subsequently changed.

Optional `next_followup_at` reuses `leads.next_followup_at`: omission preserves it, explicit null clears it, and a value requires an ISO timestamp with timezone. An override or an existing follow-up blocks automatic queue aging. Expiry/resumption behavior is deferred to later policy work.

## Central service and compatibility

`services/counselorWorkflowService.js` owns validation, state transitions, history, source attribution, deadline scheduling and processing. Versioned saves atomically insert the existing remark plus state and history. They intentionally leave legacy call-status enums and lifecycle V2 state unchanged. Consumers needing the new journey must read the versioned API.

Manual/detail/bulk remarks and workflow Step 1 use `createLeadInteraction`, which accepts optional `primaryStatus` from the existing HTTP `primary_status` field. Call logs also accept it. These adapters retain their existing legacy side effects and record the new workflow in the same transaction. Scheduled call outcomes, lead-level changes, and conversion actions also notify the central service.

Legacy calls without an explicit primary remain accepted. They never infer primary from array order: a managed lead retains its previous primary as context, loses active queue/journey membership, cancels stored deadlines, increments generation, and awaits an explicit primary. This prevents obsolete automatic aging after a legacy remark. Only work by the assigned counselor is marked as counselor work; unrelated roles retain their existing permissions.

Existing V2 maps CC and Responded into broader journey stages, including Common Meeting. That mapping remains unchanged. V2 settings, jobs, native lifecycle events/actions, personal-meeting workflows, sheet imports and initial lead-creation notes remain legacy contracts; they are not new explicit-primary commands. The new deadline policy has no production callers yet. Stage 3 must resolve these remaining legacy mutation paths before enabling automatic policies for users who mix both interfaces. Do not infer the new primary from legacy derived stages.

## Prospective enrollment

The existing lifecycle job polls up to 100 assignments per tick (hard maximum 200), restricted to counselor assignments on/after the cutoff. A genuinely new unworked assignment enters New without deadlines. Existing remarks, a reassignment, or terminal legacy data prevent inventing New membership. A new counselor remark can enroll an older lead, but no historical New/Old/Pending events are reconstructed. Reassignment invalidates prior deadlines and awaits a primary; its eventual business policy is deferred.

Assignment timestamps retain PostgreSQL precision. Lists and workers exclude snapshots belonging to another owner or assignment. Polling introduces up to one existing job interval of enrollment delay, with additional ticks for large batches. Saving a remark enrolls under the same lock immediately.

## Deadlines and concurrency

The existing `lifecycleDeadlineJob` calls the foundation processor independently of V2 feature settings. The foundation's failures are logged separately so the existing V2 tick can continue. No second scheduler is created.

`schedule(client, ...)` is an internal transaction-based integration point for future policies; there is no HTTP endpoint for setting automatic deadlines. It persists a named policy version and absolute Old/Pending deadlines and increments generation. Stage 2 never invokes it outside tests. An unworked New lead cannot schedule Old.

All new transitions lock the lead first, then state. Remark saves and deadline replacement increment generation; the worker verifies generation, exact deadline, assignment, ownership, current membership and follow-up before writing. Unique `(lead_id, idempotency_key)` constraints and transaction boundaries prevent duplicate history/work. Old is processed before Pending after downtime; both retain the policy generation. A concurrent newer remark cancels remaining deadlines and wins. History insertion failure rolls back the entire transaction.

The worker uses bounded database queries and persisted timestamps, so process restart loses no scheduled state. Production-volume execution plans and throughput must be checked during staging rollout; the integration fixture is deliberately small.

## Work attribution for Stage 5

Every counselor work event records the queue immediately before the remark: `new`, `old`, or null when neither applies. Never coerce null into N/O. Later reporting should deduplicate distinct lead IDs separately within actor, reporting period, and source. The same lead may contribute once to N and once to O in that period. Repeated O events remain useful history and can be deduplicated within O. No Worked report or UI was added.

## Verification and next stages

Run from `backend`:

```text
node node_modules/jest/bin/jest.js --runInBand
node scripts/test-counselor-workflow-postgres.mjs
```

The second command creates a separate temporary loopback PostgreSQL cluster, runs the new migration twice over a minimal referenced schema, tests transactions, and stops the server. It never reads the production database URL. Temporary data is retained for inspection. Ordinary Jest runs skip the PostgreSQL cases unless the dedicated test URL is provided.

Coverage includes primary/secondary validation, overlapping journey/Old, Pending history, duplicate remarks/deadlines, generation replacement, concurrent worker/remark saves, prospective rollout, legacy reads and invalidation, follow-up preservation, N/O attribution and per-source deduplication, permissions, reassignment and atomic rollback.

Before Stage 3: agree canonical status mappings (including CI), reconcile remaining V2/legacy mutation paths, specify timezone/calendar policies, terminal and reassignment behavior, and custom-follow-up expiry. Use the central schedule/service contract; do not add controller timers or reuse V2 mappings implicitly. Production migration, full-schema staging verification, and frontend integration remain separate deployment work. Stop after Stage 2 review.
