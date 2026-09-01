# CRM Digital AdBird Engineering Instructions

## Scope and Ownership

- Follow the user's request exactly and keep every change limited to the requested feature, bug, audit, or verification scope.
- Do not add new features, redesign unrelated screens, change unrelated CRM workflows, or modify database schema/migrations unless the user explicitly requests it.
- Preserve existing business metric semantics, attribution rules, permissions, API contracts, and historical data unless the requested change requires a documented correction.
- Before editing, inspect the relevant frontend, backend, tests, configuration, and current git status. Do not assume that similarly named code paths have identical semantics.
- Never discard, reset, overwrite, or revert existing user changes. If an uncommitted change directly conflicts with the requested work, pause and explain the conflict.

## Implementation Standards

- Prefer the smallest production-safe change that solves the reported issue.
- Reuse existing service abstractions, shared query foundations, validation, authorization, loading/error patterns, and design-system components.
- For SQL, inspect the complete generated query and parameter flow before changing it. Keep aliases in scope, use explicit ownership/attribution semantics, avoid duplicated metric definitions, and preserve distinct-lead versus event-row counting intentionally.
- Do not solve slow SQL only by increasing timeouts. First identify the expensive query path, reduce repeated work safely, and verify with realistic query plans or production-safe diagnostics.
- Do not fabricate historical records, fake attempt states, or infer historical snapshots from current mutable state when reliable history is unavailable.
- Keep authoritative filtering and metric calculations on the server. Do not move business logic into React merely to hide backend inconsistencies.
- Preserve security boundaries. Every protected endpoint must retain authentication, authorization, and correct error classification.
- Keep logs useful and safe: include endpoint, correlation context, duration, and real internal error details where appropriate, but never log credentials, tokens, or sensitive personal data.

## Change Workflow

1. Inspect the relevant implementation and tests, then state the intended narrow change.
2. Check for existing uncommitted work before editing.
3. Edit only the necessary files using the repository's established patterns.
4. Add or update focused tests for the changed behavior, especially boundary, parity, authorization, attribution, and failure cases.
5. Run syntax checks, focused tests, full relevant tests, frontend typecheck, and production build as applicable.
6. Review the final diff for unrelated changes, generated artifacts, schema changes, accidental logging, and semantic regressions.
7. Report exactly what changed, what was verified, what could not be verified, and whether the result is GO or NO-GO.

## Testing and Verification

- Do not claim a test, build, deployment, endpoint, or production result passed unless it was actually run and observed.
- When a command cannot run, report the exact blocker and use the safest available alternative.
- For metric/report work, verify summary, rows, aggregation, filters, issue buckets, and drill-downs against the same definitions.
- For UI work, verify loading, error, empty, responsive, pagination/filter state, and accessibility behavior without changing backend semantics.
- For deployment issues, distinguish repository code, CI/CD, process manager, reverse proxy, database, and browser errors before proposing a fix.
- Do not report production as fixed until the relevant deployed commit, running process, endpoint response, and browser behavior are verified.

## Deployment and Database Safety

- Never run destructive commands such as `git reset --hard`, `git checkout --`, recursive deletion, or database data changes without explicit approval.
- Do not change migrations or database schema for a bugfix unless explicitly authorized.
- Treat PostgreSQL query cancellation (`57014` / `statement timeout`) as a query-performance investigation first: inspect active queries, wait events, query duration, filters, indexes, and execution plans.
- Treat SQL programming errors, such as out-of-scope aliases, separately from missing-schema errors. Only classify an error as schema-missing when the required object is genuinely absent.
- Before production deployment, ensure the target repository is clean or intentionally reconciled, the correct PM2 process is identified, and the health check targets the correct CRM backend.
- Keep CRM processes and domains distinct from other applications hosted on the same VPS.

## Communication

- Use concise, clear explanations and include file/function references for code findings.
- Surface tradeoffs and uncertainty honestly; do not hide residual risks.
- For audits, findings come first, ordered by severity, followed by assumptions, tests, and recommendations.
- For implementation tasks, finish the work end-to-end when feasible rather than stopping at a proposed solution.
- Final responses should include the requested PASS/FAIL, files changed, tests run, build result, and any intentionally unresolved issue.
