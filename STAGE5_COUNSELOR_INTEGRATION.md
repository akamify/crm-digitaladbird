# Stage 5 — Counselor leads integration

## Result

Implementation and automated functional verification: PASS. Responsive visual acceptance remains pending. No production migration, rollout configuration change, or deployment was performed.

## Problem and changes

The Stage 1 counselor workspace still consumed legacy workspace data and several tabs were unavailable. Stage 2–4 supplied versioned workflow events and timers, but the final work-date counters, history presentation, and counselor UI integration were missing.

Stage 5 connects all 22 counselor tabs to the versioned service. Admin/RM dashboard layouts and legacy reporting definitions are unchanged. Stage 3/4 timer policies are unchanged.

## Worked semantics

- N: distinct lead IDs with a qualifying counselor work event whose saved source was New, within the selected work-date period.
- O: distinct lead IDs with a qualifying counselor work event whose saved source was Old, within that period.
- Worked = N + O. The same lead can contribute once to both buckets. Multiple events in the same bucket contribute once.
- Events preserve source immediately before the action, actor, timestamp, primary/secondary context, and generation. Counts never infer source from the current queue.
- Negative statuses and free-text legacy remark events qualify as actual work. Untouched New timeout events do not qualify.
- Events without a New/Old source remain in history but do not receive an invented source or an Other counter.
- Date bounds are half-open Asia/Kolkata calendar days. Worked uses event time; Received uses assignment time. Other current tabs retain the assignment-date cohort.
- The Worked list renders each lead once with N/O badges. Its pagination total is the unique row count; the Worked counter is explicitly N+O.

## Query and API

Existing routes are reused:

- `GET /counselor-workflow/v1/leads`: adds all 22 summary counts, N/O totals, filtered unique rows, page metadata, allowed statuses, and compact history. Parameters include view, lead_view, from/to, page, search, source, category, stage, primary/call status, remark status, campaign, follow-up, and the caller's counselor scope.
- `GET /counselor-workflow/v1/leads/:id`: supplies status options, current state, read-only access, and paginated immutable history with `has_more`.
- `POST /counselor-workflow/v1/leads/:id/remarks`: existing explicit-primary contract, optimistic generation check, and idempotency key are used by the new form.

One shared materialized classification supplies summary and list predicates. Worked groups events by lead with separate New/Old flags. Search values are parameterized; search wildcard characters are escaped. Unsupported legacy filters are rejected by the API rather than interpreted as new workflow rules.

Rows are limited to 25 with stable ID ordering. A second batched query loads the latest eight relevant history events for those rows. Full history is requested only when expanded and paginated by 50. There are no per-card initial history queries. Current owner access and the existing previous-owner assignment audit govern read access; only the current owner can save.

No Stage 5 schema or index migration was added. Existing actor/work-time/source and lead/history indexes are reused. An isolated `EXPLAIN (ANALYZE, BUFFERS)` exercised summary, list, and work classification: the work-source index was used; the final fixture execution was 1.691 ms. This small fixture is not a production-scale performance benchmark. History pagination and compact-history limits are covered by integration tests.

## Frontend

The existing compact Search + Filter + Actions toolbar, internal tab scrolling, and filter sheet are retained. All 22 tabs have data, loading, error/retry, empty, and disabled-rollout states. Search/filter/date/page state remains in the URL. Previous-query rows are hidden while switching views.

Cards show current state separately from immutable history. Pending does not display an expired primary as active. Compact history wraps and exposes full paginated history. A lead appearing in both a primary journey and Old is intentional.

The counselor remark form requires an explicit primary status and supports secondary context and keep/set/clear custom follow-up. It submits one idempotent save and invalidates workspace/detail caches. The lead profile waits for the counselor contract before exposing its workflow form. Reassigned cards retain read access without Call/Add remark controls. Legacy Responses/TTE URLs remain available.

## Stage 5 files

Backend:

- `backend/src/services/counselorWorkspaceService.js` — shared query and filters (new).
- `backend/src/services/counselorWorkflowService.js` — workspace delegation and history/read access contract.
- `backend/src/services/__tests__/counselorWorkflow.test.js` — Stage 5 database cases and updated fixture/query checks.

Frontend:

- `frontend/src/hooks/useCounselorWorkflow.ts` — versioned data and mutation hooks (new).
- `frontend/src/components/leads/CounselorJourneyTracker.tsx` — immutable compact/full history (new).
- `frontend/src/components/leads/CounselorRemarkForm.tsx` — explicit-primary save (new).
- `frontend/src/components/leads/CounselorWorkflowFilters.tsx` — counselor filters (new).
- `frontend/src/components/leads/CounselorLeadsWorkspace.tsx` — final tabs, counters, cards, states.
- `frontend/src/components/leads/CounselorLeadsToolbar.tsx` — new filter contents and read-only action guard.
- `frontend/src/components/leads/counselorLeadTabs.ts` — all 22 view mappings.
- `frontend/src/app/leads/[id]/page.tsx` — counselor profile integration.
- `frontend/scripts/counselor-leads.test.cjs` — frontend regressions.

Other dirty files in the workspace include prior-stage work and user edits; they were not reverted. The existing `authController.js` edits were not changed for Stage 5.

## Validation

- Backend ordinary Jest suite: 12 suites pass, 243 tests pass, 162 database tests skip in this mode.
- Isolated PostgreSQL workflow run: 2 suites, 293 tests pass, including all 162 database tests and Stage 3/4 policy regressions. These overlap the ordinary suite and are not additive totals.
- Stage 5 adds 43 database scenarios: N/O cross-bucket work, repeated sources, negative remarks, legacy free text, untouched timeout, midnight work dates, all-tab classification parity, search/filters, invalid inputs, authorization, custom override, reassignment, legacy rows, and complete paginated history.
- Frontend static rendering regression suite: 13 tests pass. These verify contracts/rendered output, not browser interaction or CSS geometry.
- TypeScript: passes with `tsc --noEmit --incremental false`.
- Frontend lint: passes with existing repository warnings.
- Frontend production build: passes (`next build`, 47 static pages generated).
- Backend syntax checks: pass for both workflow/workspace service files.
- Backend lint: blocked because ESLint 9 cannot find `eslint.config.js`, `.mjs`, or `.cjs`; no unrelated tooling migration was made.
- `git diff --check`: passes; Git emits existing LF/CRLF conversion notices.

## Remaining acceptance and rollout limits

The in-app browser setup failed with `codex/sandbox-state-meta: missing field sandboxPolicy`. No responsive/browser acceptance is claimed at 320, 360, 375, 390, 430 px, tablet, or desktop. Overflow, sticky controls, dialog interaction, selected-tab visibility, clipping, and layout stability still require browser verification.

Legacy records are not backfilled and do not gain fabricated work events. Reassigned lead history depends on the existing previous-owner assignment audit. Old records without workflow enrollment remain readable as legacy records. The approved rollout gate and earlier foundation migration remain prerequisites; they were not enabled/applied to any existing database during this task.

GO for code review. NO-GO for declaring visual acceptance or deploying automatically. Stop after Stage 5 for review.
