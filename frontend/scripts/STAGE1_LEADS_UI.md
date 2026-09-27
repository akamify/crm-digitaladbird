# Stage 1 counselor leads UI

## Scope

Only the member/partner branch of `/leads` uses `CounselorLeadsWorkspace`.
Admin/RM page branches and the shared dashboard workspace are unchanged.
The existing `LeadFilters` layout remains the default; only the new counselor
toolbar opts into its panel presentation.

Search, filters, selected view, period and pagination use URL parameters.
The mobile Search/Filter/Actions bar is portaled below the existing 64px topbar
so ancestor overflow and animation styles do not prevent fixed positioning.
Filter and Actions use native modal dialogs for focus containment, Escape and
background interaction blocking. Filters appear as a bottom sheet on mobile
and an anchored panel on desktop.

## Data and actions

Reuses `/counselor-workspace/leads` and, only on unsupported views,
`/counselor-workspace/summary`. Existing campaign and label filter lookups are
unchanged. No API, permission, metric, schema or workflow changes are included.

Supported tabs retain their current backend meanings: Leads Received, New
Leads, Worked, Pending, CI, Common Meeting, PM, Follow-Up, Quotation, Converted
and Cold. Stage 1 does not apply the proposed timers to these existing views.

The following tabs display an unavailable count (`—`) and explanatory content,
and do not request an unrelated list:

- Old Leads
- CC
- Responded
- DIM
- Hot
- Warm
- SC
- CR
- RM
- NT
- PI

Responded is not mapped to the broader Responses backend view. DIM is not
mapped to TTE. Existing Responses and TTE remain accessible through Actions,
including existing URLs. Call and Open remain on each card and are also
available for a lead selected from the current page in Actions.

## Verification

Run `node --test scripts/counselor-leads.test.cjs` from `frontend`.
Tests render the real components with query fixtures and check ordering,
unsupported queue handling, filter/query parameters, real counts, action
links, pagination, placeholder-data isolation, empty/error states, legacy
views and the opt-in filter panel. These are rendering tests, not browser tests.

Manual acceptance still requires an authenticated member and partner at
320, 360, 375, 390, 430px, tablet and desktop widths. Verify scrolling, bounded
tab overflow, keyboard tab navigation, long labels, filter/date dialogs,
focus restoration, Call/Open and pagination. Also smoke-test unchanged
Admin/RM views. The in-app browser tool failed during setup in this session,
so these responsive and interactive checks have not been claimed as passed.

Stage 2 has not been started.
