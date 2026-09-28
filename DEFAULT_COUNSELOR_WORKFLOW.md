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
