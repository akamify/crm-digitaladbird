# Counselor workflow in the original UI

## Current result

The original Leads page and Step 1 remark-card design are retained. Counselor functionality is active by default, as explicitly requested. There is no environment or pilot switch controlling the member/partner UI. The replacement dropdown remark form remains hidden on the lead profile.

## Visible changes

- Removed the counselor Leads page's Latest Notes and Personal Meetings buttons.
- Main boxes: Assigned Leads, New Leads, Old Leads, Worked Leads, Pending.
- Existing small-chip row: CC, R, CI, CM, DIM, PM, Follow-up, Quotation, Hot, Warm, SC, CR, RM, NT, Converted, Cold, PI, Responses and TTE.
- Kept the original gradient header, date control, inline filters, labels, row structure, Call/Open actions and expandable details.
- Worked box shows N/O and Previous totals; rows show recorded N/O badges or Previous work without duplicating a lead.
- New remark options appear as cards inside the existing Step 1 design. The selected primary is submitted explicitly by counselor clients. Admin/RM remark options and the dashboard layout retain their existing selection.

- Common Meeting reuses its existing Step 1 card and saves the CM journey status; no duplicate CM card is added. Historical attendance records remain unchanged.
- Original lead rows reuse the compact journey tracker. A bounded batch query loads recent recorded events; expanded history retains earlier steps, including after Pending.

## Backend behavior

The original counselor workspace endpoint supports a journey projection selected by the Leads page. This is a request for the documented data model, not an activation flag. Noncounselor roles cannot opt into these counselor-specific views. The dashboard now requests the same journey projection while keeping its original layout.

Counters and rows use one shared classified query. Existing analytics filters remain server-side. Old and remark membership can overlap; Pending ends active remark membership. Worked uses the actual actor's work date, deduplicates each lead within N/O, and retains previously assigned leads as read-only. Leads assigned to another counselor cannot appear in current queue counts. Assignment timestamps must match workflow state before it can classify a current queue.

The existing remark-save endpoint now receives the selected primary from counselor clients. New remark values pass through the existing validation/storage path; unsupported database enum values remain in the JSON status fields instead of requiring an enum migration. Existing retry-plan confirmation also handles the added remark cards. Explicit call-attempt outcomes restart the matching workflow policy.

Existing timer durations and cutoff rules are reused. Future custom follow-ups retain priority. Once due, a scheduled lead appears in Follow-up regardless of its assignment period; saving an explicit primary remark completes the due schedule and starts the new policy. Expiry alone does not resume background aging. Activation uses the stable 27 September 2026, midnight Asia/Kolkata assignment boundary. Older leads begin a recorded journey when a counselor saves a primary remark. Historical N/O counts are not reconstructed or guessed. The worker must run for automatic enrollment and deadline transitions; its process-only enable/disable switch remains separate from UI availability.

## Files changed

- Frontend: Leads page, CounselorLifecycleWorkspace, leadRemarkOptions, WorkflowPanel, CrmGuide, useLifecycle, useWorkflow and counselor-leads tests.
- Backend: lifecycleService, counselorWorkspaceService, counselorWorkflowService, counselorWorkflowRollout, leadWorkflowRemarkService, leadInteractionService, leadCallAttemptService, leadStatusOptions, routes/index, rollout tests and two new focused test suites.
- Documentation: this report and counselor-workflow.env.example.
- No database migration, authController change, production write or deployment.

## Verification

- Ordinary backend suite: 380 passed; 178 database tests skipped in that run.
- Isolated PostgreSQL run: 391 passed across eight suites, including original-workspace cases and 50,000-lead readiness checks for the existing workflow service.
- Frontend component/hook checks: 20 passed, including original row/filter rendering, dashboard isolation, N/O badges and explicit counselor primary payloads.
- SQL parameter typing issue found by PostgreSQL was corrected. Existing filters, aliases, actor scope and assignment joins were reviewed. A fixture EXPLAIN ANALYZE check is included for the new projection; this is not production-scale evidence for that query.
- Browser connection failed with `codex/sandbox-state-meta: missing field sandboxPolicy`. Responsive visual verification and screenshots remain pending.
- Production build and TypeScript checks passed; frontend lint completed with existing warnings.
- Final isolated rerun passed all 391 tests (exit 0); the original projection fixture EXPLAIN ANALYZE completed in 2.077 ms. This is test-fixture evidence, not a production benchmark.
- Backend lint remains blocked by the previously identified missing ESLint 9 configuration. Diff checks passed.

GO for code review. Live deployment and final visual acceptance remain pending. This report supersedes the earlier default-UI activation and emergency rollback instructions.


## Legacy queue carry-forward correction

The first journey projection required a matching workflow-state record, so older assigned leads disappeared from Pending/Worked. The dashboard still classified every untouched lead as New regardless of its age.

Both existing screens now use the same server classification. This is a read-time compatibility migration: it does not rewrite historical data or fabricate journey events.

- Unmanaged and awaiting-primary leads retain legacy Pending, Call Issues, meeting, follow-up and terminal memberships using the existing lifecycle records.
- Untouched legacy leads remain New only before their first-contact deadline. After that deadline they appear in Pending. The clock uses assignment time, falling back to creation time when no assignment time exists; fresh reassignment must not inherit the lead's original age. The policy matches the existing 09:00-17:00 inclusive / two-hour / applicable 10:00 IST rules.
- Future custom follow-ups retain priority. Terminal leads cannot re-enter New/Pending through the legacy fallback.
- Previous work uses qualifying records since the current assignment and before the first explicit workflow-remark transaction. It retains the former assignment-period semantics. N/O keeps the existing work-period semantics. Total Worked is N + O + Previous; a lead counted in N/O is excluded from Previous in that period. No historical N/O attribution is guessed.
- An explicit primary remark immediately takes over from legacy queue membership and starts the existing remark policy. Previously recorded work remains available. Legacy membership does not restart historical timers or invent an Old history.
- The request-lead widget's Pending Work still uses the pre-existing unworked-lead metric. It is distinct from the workspace Pending action queue; distribution eligibility rules were not changed.

Changed files for this correction: lifecycleService.js, CounselorLifecycleWorkspace.tsx, useLifecycle.ts, counselorWorkflowClassicWorkspace.test.js, counselor-leads.test.cjs and this report.

No schema migration or production data write is required for carry-forward. Deployment of both backend and frontend is required. Live counts and responsive browser QA remain unverified.


### Correction verification

- Ordinary backend suite: 380 passed, 180 database-dependent tests skipped in that run.
- Final isolated PostgreSQL workflow suite: 394 passed across eight suites, including legacy carry-forward, terminal/future-follow-up exclusions, summary/row parity, owner scope, fresh reassignment, IST boundary parity and first-primary transaction attribution.
- Frontend component/hook suite: 21 passed, including dashboard journey-query parity and Previous work rendering.
- Production Next.js build, TypeScript and frontend lint completed successfully; existing lint warnings remain. Backend lint was not rerun; its previously reported missing ESLint 9 config remains unresolved.
- Node syntax and git diff checks passed. Original workspace fixture EXPLAIN ANALYZE: 1.458 ms; not a production-scale performance guarantee.
- Production deployment and live/browser acceptance remain pending. GO for code review; no production PASS claim.


## Navigation and row clarity correction

- Fixed competing URL writers: the parent Leads page no longer overwrites counselor workspace parameters, including during auth loading.
- Open links carry a validated local return URL. Back to leads, missing-lead return and post-delete return preserve the selected date/range, tab, filters and page. Dashboard workspace links retain their own context. Direct profile visits still default to /leads.
- Pagination is initialized from and written to the URL. Reloading a saved list URL preserves the same selection.
- The backend exposes workflow_next_queue from the same stored deadline used by the worker. Rows show Moves to Old Leads or Moves to Pending with the deadline; custom follow-ups retain their own label. Existing legacy meeting actions retain their action labels because they do not have a new-workflow automatic transition to promise.
- Rows display the authoritative workflow primary, falling back to the recorded last call result for legacy leads. Removed the duplicate stage/result line.
- Removed More details and expandable history from list rows. Compact recorded journey steps remain; profile history is unchanged.
- Timer policies, membership rules, schema and historical data are unchanged.

Files: lifecycleService.js and its PostgreSQL workspace tests; CounselorLifecycleWorkspace.tsx; useLifecycle.ts; Leads list/detail pages; LeadProfileHeader.tsx; new leadReturnPath.ts; frontend regression tests; this report.

Verification: 24 frontend tests passed; production build passed with existing lint warnings; final TypeScript check passed after the parent URL guard change. Node syntax and diff checks passed. Browser connection retry failed with `codex/sandbox-state-meta: missing field sandboxPolicy`; live back-navigation and visual verification remain pending. No deployment was performed.

Final navigation/deadline regression run: 395 PostgreSQL tests passed across eight suites (exit 0). Frontend: 24 tests passed. Final diff check passed. GO for code review; deployment and browser acceptance remain pending.


## Tab loading and refresh correction

Root cause: the workspace treated every isFetching result as a tab transition, fading and blocking already-loaded rows during its existing 60-second polling. Its 15-second stale window also triggered frequent refetches when returning to tabs.

- Initial loads and uncached tab/filter/page changes retain Loading text and skeletons. Previous-tab rows are not presented as current-tab results.
- Cached current results remain visible and usable during background refresh, including stale-cache revalidation and mutation-triggered refresh.
- Workspace tab data stays fresh for 60 seconds. Existing 60-second active polling, reconnect handling and remark-save invalidation remain enabled. No infinite cache or disabled freshness checks.
- A 16px refresh icon in a 36px rounded button appears beside the results count. It spins during fetches, prevents duplicate refresh clicks, has an accessible label and respects reduced-motion settings. Manual refresh requests the current query immediately.
- Error/retry and empty states remain intact. Backend policies, database and list layout are unchanged.

Files: useLifecycle.ts, CounselorLifecycleWorkspace.tsx, counselor-leads.test.cjs and this report.

Verification: 26 frontend checks passed, including real QueryClient cache reuse/invalidation, first load, placeholder transitions, background refresh and errors. Final TypeScript and diff checks passed. Browser visual verification and production deployment remain pending.

Reference: https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults


## Simplified lead profile workflow

- Removed Step 2 Lead Category and Step 3 Follow-up Tracker controls and the obsolete four-step progress bar.
- Step 1 Remark is always open, without an accordion toggle or green outer completion border. Step 4 Conversion remains available as an open section.
- Removed the outer Call Issues & Retry Plan accordion, its enclosing card styling, and active retry-plan container borders/shadows. Individual action controls retain visible selection and focus styling.
- Conversion no longer requires the removed Step 3 completion flag. Existing access, category and payment checks remain. Completion inserts a workflow record with its required user_id when absent, or updates only conversion fields on an existing record.
- Historical category/follow-up records, history labels, remark timers and retry behavior remain intact; no database schema change.

Files: WorkflowPanel.tsx, CallAttemptTracker.tsx, lead profile page, backend/routes/index.js, frontend regression suite and conversionWithoutRetiredSteps.test.js.

Checks: 27 frontend tests passed; existing backend suite 380 passed (182 database-dependent tests skipped), plus two new conversion-handler tests passed. Node syntax and diff checks passed. Browser visual QA and production deployment remain pending; backend lint configuration limitation is unchanged.


## Pending work attribution correction

The user clarified the reporting rule: work performed while New belongs to N; work performed while Old or Pending belongs to O. Previously applyRemark only recognized New/Old and recorded a null work_source for Pending.

- New Pending remarks now record work_source=old in the same transaction as the remark and workflow event.
- Both workspace queries use the same source expression. Previously saved is_work events with a null source and previous_state.queue=pending count as O on their actual work date and for their recorded actor. Current lead state is never used to guess historical work.
- Repeated Pending/Old work deduplicates within O for the reporting period. Existing N remains independent. A lead counted in O is excluded from Previous by the existing carry-forward predicate.
- No database rewrite/schema migration is required. Events lacking historical queue evidence remain unattributed rather than being guessed. Live screenshot records were not directly inspected.
- Guide and O-badge tooltip now explicitly include Pending. No queue timers or UI layout changed.

Files: counselorWorkSource.js (shared attribution), counselorWorkflowService.js, counselorWorkspaceService.js, lifecycleService.js, their tests, CrmGuide.tsx and CounselorLifecycleWorkspace.tsx.

Frontend regression suite: 27 passed. TypeScript check passed. Build/lint not rerun for the text-only frontend changes; prior lint limitations remain. Production deployment and live count verification remain pending.

Final checks for Pending attribution: ordinary backend 388 passed / 184 skipped; isolated PostgreSQL 397 passed across eight suites (exit 0). Query-plan checks passed on fixtures, not production benchmarks. GO for review; production verification pending.


## Remark outline, mobile CC tile and contextual header

- Remark now has one neutral outer border with responsive padding; it remains permanently open without an added ring/shadow or surrounding second card.
- The two-column mobile/tablet summary has a sixth CC tile next to Pending, using the same live CC count and selection as the existing chip. The desktop summary retains its five columns.
- Counselor Leads header reads the selected workspace_view from the URL. Remark tabs show short codes and full descriptions, e.g. CC / Communication Completed and CM / Common Meeting. Queue tabs use descriptive titles/subtitles, e.g. Pending / Leads awaiting action. Unknown views fall back to Assigned Leads. Other roles keep their existing header.
- Heading wording follows descriptive-heading guidance: https://www.w3.org/WAI/WCAG21/Understanding/headings-and-labels
- Files: WorkflowPanel.tsx, CounselorLifecycleWorkspace.tsx, counselorLeadTabs.ts, app/leads/page.tsx, frontend regression tests and this report. Earlier Pending/O work remains intact.
- No backend, schema or timer changes in this UI update. Deployment and responsive browser verification remain pending.

UI update verification: 29 frontend tests passed; production build/typecheck passed (exit 0), with existing frontend lint warnings. Diff check passed. GO for code review; deployment and browser visual acceptance pending.

## Conversion numbering and compact Leads spacing

- Conversion is displayed as Step 2 after Remark. Stored workflow step IDs and historical labels retain their existing meaning.
- Both visible steps have one neutral outer border, without an extra surrounding card or shadow.
- Leads list and profile opt into 12px mobile / 16px larger-screen page padding. Removed the additional workflow wrapper padding and reduced Leads workspace header/body padding. Other pages retain their existing shell spacing.
- Existing controls and their touch target sizes are preserved. Spacing uses consistent increments, following https://m1.material.io/layout/metrics-keylines.html.
- Verification: 29 frontend regression tests passed; TypeScript, targeted lint and the final production build completed successfully with existing lint warnings; diff check passed. Browser visual verification and production deployment remain pending.


## Lead profile scrolling, collapsed Conversion and journey placement

- Compact Leads pages use overflow-x-clip instead of overflow-x-hidden, avoiding an implicit vertical scroll container. Profile content uses one main landmark and a normal-flow sidebar rather than a tall sticky sidebar. The screenshot symptom still requires browser confirmation.
- Remark remains open with one outer border. Step 2 Conversion uses a native details/summary disclosure, closed by default, with keyboard support and its existing form preserved when toggled.
- Lead Journey moved below Sessions / Webinar Attendance in the right column, using the existing cached lifecycle query and unchanged history. Long content wraps within cards. Columns follow actual content height rather than adding blank filler.
- Browser verification blocked by browser connection error: missing sandboxPolicy. Production deployment has not been performed.

Verification: 30 frontend tests passed. Production build, including typecheck and lint, passed with existing lint warnings. Diff check passed. GO for code review; responsive visual acceptance and production verification remain pending.


## Remove embedded Communication and correct document scroll ownership

- Removed Communication panel from the lead profile. Header/mobile Chat actions and Call Logs & Remarks remain. No backend communication data or endpoints were removed.
- Root cause in global CSS: both html and body had fixed 100% height with overflow-x:hidden. The body computed overflow-y:auto and scrolled independently. Body now grows with content using min-height:100% and overflow-x:clip; the document root owns page scrolling.
- Isolated Edge browser comparison using actual global base CSS reproduced body scrolling with the old rules at 320, 360, 375, 390, 430, 768 and 1280px. Corrected rules passed at all seven widths: body scrollTop=0, document scrolling active, no horizontal overflow, 12px intended bottom padding, and native Conversion disclosure geometry working. This is a CSS fixture, not authenticated full-profile visual QA.
- 31 frontend regression tests passed, including Communication removal and preserved Chat/history. In-app browser remains blocked by missing sandboxPolicy; production deployment and full-page visual verification are pending.

Final checks: production build (including typecheck/lint) passed with existing lint warnings; diff check passed. GO for review, live verification pending.


## Sidebar Call Logs & Remarks and current deadline

- Removed Lead Journey from the profile and moved Call Logs & Remarks to its place below Sessions / Webinar Attendance. History records are retained.
- Free-text notes use padded amber surfaces; legacy Status: entries use padded sky surfaces. General badges are replaced with Note/Remark; counselor/RM attribution remains. Status entries no longer show a potentially conflicting call-status chip.
- The card shows the latest primary remark, current queue, next Old/Pending destination, deadline and relative time. It reads the existing counselor detail endpoint for member/partner roles only; no timer policy or backend mutation was introduced. Pending, follow-up overrides, awaiting-primary and outdated-assignment states are respected. Relative time refreshes every minute, existing query polling refreshes authoritative state.
- Verification: 33 frontend regression tests and TypeScript passed. Browser visual acceptance and production deployment remain pending.

Production build, including lint/typecheck, passed with existing lint warnings. Diff check passed. GO for review; live verification pending.


## Compact lead-row timeline and queue styling

- Rows display at most five recent history steps, with View timeline linking to the same profile/return URL as Open. Stored history is unchanged. The latest occurrence of the authoritative active primary remark is green and explicitly labelled Current; pending/history-only entries are not labelled current.
- Deadline actions have soft destination colours and the row countdown includes seconds. Countdown updates locally, preserves absolute due time, and waits for backend confirmation at expiry.
- Small workflow tabs use full names where defined; TTE retains its existing name because no authoritative expansion was found. Tabs continue scrolling inside their container with keyboard navigation.
- Assigned/New/Old/Worked/Pending summary tiles use soft indigo/yellow/orange/emerald/rose tones and expose selected state. Labels accompany colour per https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.
- 35 frontend tests passed. Existing uncommitted sidebar work preserved. Live responsive verification and deployment remain pending.

Final row UI checks: production build/typecheck passed; lint completed with warnings. Diff check passed. GO for review; production and full-page visual acceptance pending.


## Super Admin / RM workflow reporting ? 6 October 2026

Implemented in the existing Leads and View Distribution screens:
- Assigned Leads display name preserves the original received/created-date total, including existing unassigned records.
- New, Old, Pending and current remark tabs reuse counselor assignment-date membership. Worked uses recorded work dates; historical Previous work keeps its existing classification.
- Worked totals count distinct leads. N and O can overlap and are independently selectable.
- RM/counselor cards and labelled open links navigate to scoped `/leads` lists. Date, metric and supported list filters are retained; profile Back restores the list.
- Server-side RM/counselor authorization remains enforced. Reassigned work remains attributable and read-only outside the current team.
- Row labels, latest notes, workflow/session fields, call-attempt evidence and conversion evidence reuse existing query projections.
- No schema migrations, historical rewrites, workflow timer changes or production deployment.

Verification:
- Isolated PostgreSQL workflow suite: 406 tests passed (9 suites), including manager parity, authorization, dates, reassignment, pagination and N/O overlap.
- Legacy distribution/daily/all-time analytics: 18 tests passed.
- Frontend regression suite: 38 tests passed.
- Existing local Edge document-scroll fixture: passed at 320, 360, 375, 390, 430, 768 and 1280px. This is a fixture check, not authenticated CRM visual QA.
- Production build completed (48 pages), including type validation and frontend lint; repository lint warnings remain.
- Backend lint cannot run: ESLint 9 has no eslint.config file in the existing repository. Backend syntax checks passed.
- EXPLAIN ANALYZE executed on isolated reporting fixtures; production-scale query plans and live count parity still require staging verification.

Release gate: implementation complete; staging/live visual and count verification pending. No production PASS is claimed.


## Report date errors and loading ? 7 October 2026

- Daily manager metrics previously evaluated an unqualified `created_at` beside joined users. Users also have timestamps in the application schema; the isolated fixture omitted them. The fixture now includes both timestamps, and metric expressions are evaluated before user joins.
- Shared journey reports now narrow candidates before classification/history lookups. The union retains assignment-date leads, manager received-date leads, work-date evidence and due follow-up overrides. Counselor/RM ownership and history attribution remain unchanged.
- Manager lists reuse fresh tab data for 60 seconds. Manager, distribution and counselor list requests pass abort signals so superseded browser requests can be cancelled. Automatic failure retries are disabled; manual Retry remains available. This does not claim database cancellation after the server has accepted a request.
- Failed manager requests stop skeletons and do not render a false zero-lead empty list. Counselor failures show unavailable counts instead of zero.
- PostgreSQL: 408 tests passed, including date alias regression and existing workflow/permission parity. With 7,500 irrelevant historical leads, daily classification processed eight relevant leads; local EXPLAIN execution was 31.683 ms. This is fixture timing, not live response latency.
- Frontend regression tests: 43 passed. Production deployment and live server timings remain separate verification steps.
- Final production frontend build passed (48 pages), including typecheck and lint; existing lint warnings remain. Backend syntax checks and final diff check passed.
