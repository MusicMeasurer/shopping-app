# Codex audit request — SQL sync prototype 001-005

Branch: feature/cloud-schema-draft. Review latest HEAD, not a cached earlier commit.
Scope: cloud/drafts/001_initial_schema.sql, 002_security_hardening.sql, 003_sync_tables.sql, 004_apply_item_change.sql, 005_pull_item_changes.sql, SYNC_PROTOCOL_V02.md, OWNERSHIP_TRANSFER_RULES.md.

Perform a READ-ONLY independent security, correctness and PostgreSQL/Supabase compatibility audit. Do not modify files or execute SQL against production.

Priority checks:
1. Can 001 through 005 execute in order on clean Supabase? Identify exact SQL errors, role/extension assumptions and privilege failures.
2. RLS/GRANT/REVOKE and SECURITY DEFINER: verify direct-table bypass, function ownership, EXECUTE defaults, schema CREATE, service-role behavior, TRUNCATE and auth.uid().
3. Item mutation: retry idempotency, cross-list operation UUID collisions, concurrent transactions, version conflicts, immutable identifiers, client-controlled timestamps, soft delete and tombstone correctness.
4. Pull changes: unauthorized access, cursor semantics, pagination, snapshot consistency, retention and deleted-list handling.
5. Membership and ownership: ensure item mutation locks coordinate with membership changes; account deletion currently cascades lists; approved voluntary and automatic ownership transfers are not implemented.
6. Evaluate whether revoked members can still use cached JWT to access data.
7. Test feasibility: propose reproducible isolated database tests with owner A, member B, outsider C and anonymous, including concurrent sessions.

For each finding report severity, exact file/line, exploit or failure scenario, expected behavior and minimal safe fix. Distinguish verified code defect from design gap and untested risk. Finish with explicit verdict: ready for test DB? ready for production? Do not claim runtime verification unless executed.

No changes to main or production app.
