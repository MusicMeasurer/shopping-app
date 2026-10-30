# Security gate after draft 014

Branch: feature/cloud-schema-draft. Draft SQL only; nothing deployed.

## Current posture
- 012 validates initial list revision and server timestamps.
- 013 changes the self-owned list read policy to permit INSERT ... RETURNING.
- 014 disables prepare_account_deletion until a durable deletion workflow exists.
- All changes require actual PostgreSQL/PostgREST runtime tests.

## High findings from CODEX_AUDIT_REPORT_011
- H-01: Incomplete account deletion lifecycle. The destructive preparation
  endpoint is now disabled, but account deletion itself is NOT implemented.
  The owner FK remains RESTRICT; verify this in a disposable DB.
- H-02: Privileged deletion endpoint authorization. 014 replaces the
  function body with an unconditional exception and revokes named roles;
  effective inherited grants and backend routes still need verification.
- H-03: Stale REPEATABLE READ membership snapshot. NOT fixed.
  Do not support long-lived or caller-controlled REPEATABLE READ transactions
  for membership-sensitive RPCs until tested and redesigned.

## Self-review findings and gates
1. Confirm all SQL files 001-014 apply in order without a syntax or
   privilege error, with external API access disabled during migrations.
2. Inspect actual function owners, SECURITY DEFINER, effective EXECUTE
   grants, table/column ACLs, schema CREATE/TRIGGER privileges and RLS.
3. Verify 013 INSERT RETURNING for a real authenticated user; also verify
   a non-owner/non-member cannot read the list.
4. Verify 014 raises SQLSTATE 0A000 for every authorized invocation and
   causes zero changes to memberships, lists, events and notifications.
5. Confirm that deletion of auth.users owning lists is rejected.
6. Reproduce H-03 with a controlled REPEATABLE READ session and a second
   session removing membership. Do not claim a fix before a verified result.
7. Validate revoked membership under READ COMMITTED and cross-list isolation.

## Production decision
BLOCKED. No real cloud service, billing, auth account or user data should be
connected to these drafts. Independent Codex audit is required after the
next completed security block, followed by isolated database tests.
