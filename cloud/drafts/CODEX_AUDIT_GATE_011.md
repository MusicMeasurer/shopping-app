# SQL privilege and lifecycle audit gate — 001 through 011

Status: SECURITY REVIEW REQUIRED. No migration has been executed.

## Explicit deployment blockers
1. Migration 008 temporarily replaces the owner-change trigger with a custom session setting. Migration 009 removes that guard and revokes client UPDATE; 008 MUST NEVER be deployed as a standalone accessible state. Prefer replacing 008 and 009 with a single atomic migration before any deployment.
2. SECURITY DEFINER functions require a verified trusted owner, fixed search_path, minimal EXECUTE grants, and checked RLS bypass behavior.
3. Verify actual table and column privileges for anon/authenticated, including TRUNCATE list_members, schema CREATE, function defaults and role inheritance. Revoke rights before exposing API.
4. Account deletion preparation (011) is administrative only and does not delete auth.users. Do not expose it to authenticated, anon or user-controlled service-role callers.
5. No safe invitation/add-member operation exists yet. Concurrent membership creation and account deletion cannot be declared safe.
6. 011 cannot guarantee atomicity with external Supabase Auth Admin API. Require backend orchestration and failure recovery.
7. Ownership audit events store user identifiers and have no retention/pseudonymization policy.
8. Current client list INSERT can set arbitrary revision, and initial snapshot/retention contract is missing.
9. Existing direct shopping_lists INSERT requires a privilege review; DELETE and UPDATE must stay blocked.
10. For multiple list locks, review PostgreSQL planner/locking order, deadlocks, isolation levels and retry strategy under actual concurrent tests.

## Verification matrix
- Function owners and SECURITY DEFINER effective roles.
- Grants and column grants for all public tables and routines.
- Public/anon/authenticated ability to invoke every routine.
- SQL and PostgREST access as owner, member, outsider, anonymous.
- Race: item mutation vs membership removal; pull vs removal.
- Race: voluntary transfer vs deletion preparation.
- Race: two account deletion preparations involving overlapping lists.
- Race: invitation acceptance vs deletion preparation (once implemented).
- Forced error halfway through preparation: all list changes roll back.
- Direct auth.users deletion before preparation fails; after preparation only permitted under controlled workflow.

## Audit request
Review SQL 001-011 as a sequence. Identify defects, security boundaries, unsupported assumptions and missing migrations. Separate code-confirmed issues from runtime hypotheses. Provide exact file and line, severity, minimal safe fix and readiness verdict. Do not change files or execute SQL against production.
