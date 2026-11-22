# Security gate after draft 014 — preflight checklist

Status: DESIGN/STATIC CHECK ONLY. No Supabase database has been provisioned; none of the SQL migrations has been executed.

## Scope
- 013 changes the shopping_lists SELECT policy so a newly created, self-owned row can satisfy INSERT ... RETURNING without querying a row that has not yet been inserted.
- 014 replaces prepare_account_deletion(uuid) with a fail-closed exception and revokes named-role EXECUTE grants. It intentionally does not implement account deletion.
- Prior High findings from CODEX_AUDIT_REPORT_011.md must not be marked resolved by static inspection alone.

## Required runtime checks (disposable database only)
1. Apply 001–014 in order with external API disabled. Capture first failing migration, if any.
2. Inspect pg_proc function owner, SECURITY DEFINER status, effective EXECUTE privileges, inherited role memberships and PUBLIC grants for prepare_account_deletion.
3. As anon, authenticated A, service_role, and administrative owner, attempt the deletion-preparation call against A and B. All calls must fail or be denied; assert no list, membership, notification or ownership-event change.
4. Verify the shopping_lists.owner_id FK is ON DELETE RESTRICT and that deleting an owner with surviving lists is rejected.
5. As authenticated A, insert a self-owned list with RETURNING id, revision, created_at; confirm normal representation return succeeds. As B and anon, verify no access to A's private list. Verify members retain authorized reads.
6. Verify initial revision/date guard rejects forged values, and item RPC can still advance revision.
7. Check READ COMMITTED membership revocation with overlapping pull/mutation and remove RPC. Separately test a long-lived REPEATABLE READ snapshot; until fixed, do not claim strict revocation for that isolation level.
8. Verify direct table and column privileges for shopping_lists, list_members, shopping_items and administrative functions under real authenticated/anon roles.
9. Confirm all destructive account deletion routes remain unavailable in the application/backend; the disabled SQL function alone is not proof of route isolation.

## Unresolved security work
- H-01: implement an authenticated, fenced, durable, recoverable account-deletion lifecycle before enabling deletion.
- H-02: define and verify the actual administrative role/backend authorization contract. The 014 function gate reduces current exposure but is not the final design.
- H-03: establish supported isolation semantics or implement revocation that remains safe against stale transaction snapshots.
- M-012-01: verify 013 INSERT ... RETURNING compatibility against real Postgres/PostgREST.

Next independent Codex audit should examine 013 and 014 together with this checklist, not merely re-audit 012.
