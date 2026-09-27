# Counselor workflow in the original UI

## Current result

The original Leads page and Step 1 remark-card design are retained. Counselor functionality is active by default, as explicitly requested. There is no environment or pilot switch controlling the member/partner UI. The replacement dropdown remark form remains hidden on the lead profile.

## Visible changes

- Removed the counselor Leads page's Latest Notes and Personal Meetings buttons.
- Main boxes: Assigned Leads, New Leads, Old Leads, Worked Leads, Pending.
- Existing small-chip row: CC, R, CI, CM, DIM, PM, Follow-up, Quotation, Hot, Warm, SC, CR, RM, NT, Converted, Cold, PI, Responses and TTE.
- Kept the original gradient header, date control, inline filters, labels, row structure, Call/Open actions and expandable details.
- Worked box shows N/O totals; Worked rows show the recorded N and/or O badges without duplicating a lead.
- New remark options appear as cards inside the existing Step 1 design. The selected primary is submitted explicitly by counselor clients. Admin/RM remark options and dashboard layout retain their existing selection.

- Common Meeting reuses its existing Step 1 card and saves the CM journey status; no duplicate CM card is added. Historical attendance records remain unchanged.
- Original lead rows reuse the compact journey tracker. A bounded batch query loads recent recorded events; expanded history retains earlier steps, including after Pending.

## Backend behavior

The original counselor workspace endpoint supports a journey projection selected by the Leads page. This is a request for the documented data model, not an activation flag. Noncounselor roles cannot opt into these counselor-specific views. The dashboard keeps its original projection.

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
