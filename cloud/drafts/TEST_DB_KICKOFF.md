# ShoppingApp — isolated database test kickoff

Status: NOT EXECUTED. No Supabase project, database connection or live API is assumed.
Source: CODEX_AUDIT_REPORT_016.md at commit 1a54fa2b0d823e3c858e39ccfccaf07e2a85d69f.

## Safety boundaries
- Use a NEW disposable Supabase project, never production or an existing personal database.
- No real personal data, no shared family accounts, no actual purchases.
- Keep app and external API clients disconnected until migrations 001–016 finish successfully.
- No paid plan, add-on, SMTP provider, or secrets committed to GitHub.
- Stop on first migration failure; do not manually skip or reorder migrations.
- The cloud draft branch is NOT deployed to main.

## Stage A — prerequisites
1. User confirms whether a Supabase account already exists. Do not request credentials, API keys or passwords in chat.
2. User creates a fresh disposable project if needed, on a free tier if offered and sufficient; confirms no payment authorization is required.
3. Record PostgreSQL version, migration executor, Supabase/Auth/PostgREST versions where visible, and role used for migrations.
4. Before running SQL, obtain a complete ordered copy of 001–016 from the exact audited branch and record Git SHA.

## Stage B — migration smoke test
1. Execute 001 through 016 in numerical order in the isolated project, keeping all user-facing integrations disconnected.
2. Capture each migration success/failure and SQLSTATE. Abort on any error.
3. Verify final pg_get_functiondef for prepare_account_deletion, pull_item_changes, apply_item_change, remove_list_member, transfer_list_ownership.
4. Confirm owner FK RESTRICT, triggers, policies, role grants, and transaction isolation setting.
5. Never treat an SQL editor running as a privileged owner as proof that RLS works for authenticated clients.

## Stage C — security tests
- Create three test identities A(owner), B(member), C(outsider) using test-only addresses.
- Test list INSERT RETURNING, forged metadata rejection, private reads, deleted-list reads.
- Test deletion RPC returns 0A000/permission denied with no side effects.
- Test all four guarded RPCs under READ COMMITTED vs REPEATABLE READ and SERIALIZABLE.
- Test revocation races with two sessions, and direct-table reads from an old snapshot.
- Inspect effective ACLs, function owners, role inheritance, RLS and actual authenticated HTTP behavior.
- Capture evidence and compare with CODEX_AUDIT_REPORT_016.md section 10.

## Gate
Do not enable cloud sync, Auth account deletion, Siri endpoint, or production deployment until the migration chain, access-control tests, and concurrency tests pass. Record each failure as a reproducible issue with SQLSTATE and minimal reproduction.

## Current local execution environment
The assistant's current isolated shell has no psql, postgres, or docker binaries available; it cannot run the Supabase migration chain locally here. Runtime execution requires a disposable database environment or suitable connected tool.
