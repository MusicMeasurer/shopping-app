# PostgreSQL 17 baseline vs disposable Supabase lab — 2026-11-01

Sources: hosted read-only export `Supabase Snippet Untitled query 2(1).csv` (153 rows) and GitHub Actions `pg17-baseline-security-inventory.zip` (152 rows), workflow `rebuild-baseline-17.yml`, commit `69fcfea`.

## Comparison

Rows matched by (section, object_key), preserving embedded `|` delimiters in table_privilege keys.

- Columns: 45/45 equal.
- Constraints: 23/23 equal.
- Policies: 10/10 equal.
- Table RLS settings: 7/7 equal.
- Application function security: 11/11 equal.
- Table privileges: 51/56 equal.
- Hosted-only function: `public.rls_auto_enable()` with SECURITY DEFINER, volatile, `search_path=pg_catalog`; not in application migrations. Its provenance and whether it is platform-managed are not verified.

## Hosted permissions true, local CI permissions false

- `list_members|authenticated|SELECT`
- `shopping_items|authenticated|SELECT`
- `shopping_lists|authenticated|INSERT`
- `shopping_lists|authenticated|SELECT`
- `user_notifications|authenticated|SELECT`

All other sampled anon/authenticated SELECT/INSERT/UPDATE/DELETE table privileges agree. The CI environment uses simulated Supabase roles and does not reproduce all hosted default grants. Do not assume these differences are harmless until the provenance and effective privilege paths are reviewed.

## Limits and release gate

The inventory does not compare full function bodies, trigger/index definitions, function EXECUTE grants, column-level privileges, sequence privileges, role inheritance, schema grants, Supabase auth configuration, platform triggers, or a true restore operation. This is not a hosted backup and is not authorization to deploy 017.

Next: inspect 001-016 GRANT statements and Supabase platform defaults; compare effective function EXECUTE/schema permissions and hosted `rls_auto_enable` ownership. Validate a rebuild/recovery drill before seeking explicit user approval to replace the backup requirement for the disposable lab.

## Follow-up inspection of migration ACLs

The atomic 001–016 migration file contains REVOKE statements for forbidden client writes and explicit GRANT EXECUTE on selected RPC functions, but does not explicitly GRANT the five hosted table privileges. Therefore a clean PostgreSQL 17 database with only stub Supabase roles does not reproduce the hosted initial ACL baseline. The five differences are not evidence of changed RLS policies; their origin remains unverified.

Read-only hosted follow-up query: `tests/sql/hosted_acl_provenance_readonly.sql`. It inventories raw table/function ACLs, function EXECUTE permissions, schema USAGE, role membership, and ownership of `rls_auto_enable()`. Do not infer hosted function accessibility from table SELECT alone.

## Hosted ACL follow-up (74 rows)

The hosted raw ACLs explicitly contain the five table grants to authenticated. All seven application tables are owned by postgres. Anon/authenticated/service_role have no cross-membership among these three roles.

Application SECURITY DEFINER RPCs (apply_item_change, can_access_list, is_list_owner, pull_item_changes, remove_list_member, transfer_list_ownership) are executable by authenticated and not anon or service_role. prepare_account_deletion is executable by none of these three roles. Five ordinary trigger/helper functions (guard_item_identity, guard_new_list_metadata, reject_item_list_change, set_updated_at) and hosted-only rls_auto_enable have NULL proacl and effective EXECUTE=true for anon, authenticated, service_role, reflecting PostgreSQL default PUBLIC function EXECUTE. These functions' direct invocation properties and platform trigger bindings need verification before any changes. Data API remains OFF.

The ACL provenance is established as stored grants, but whether they came from Supabase initial defaults or later changes cannot be determined from a current ACL snapshot. No historical ACL provenance is claimed.

Next read-only query: tests/sql/hosted_trigger_function_review_readonly.sql. No authorization to deploy 017.

## Hosted trigger/default ACL review (18 rows, 2026-11-01)

The hosted read-only export reports four public ordinary trigger-returning functions owned by postgres with SECURITY INVOKER: guard_item_identity, guard_new_list_metadata, reject_item_list_change, set_updated_at. It also reports public.rls_auto_enable() owned by postgres, SECURITY DEFINER, returning event_trigger, search_path=pg_catalog. Active event trigger ensure_rls binds rls_auto_enable() to ddl_command_end. Six pg_default_acl rows show explicit public-schema defaults for postgres and supabase_admin; notably supabase_admin has broad table/function/sequence defaults for anon/authenticated/service_role, while postgres defaults differ. The present table ACLs and default ACLs are compatible with a Supabase-managed baseline, but current snapshots cannot prove when each specific table GRANT was issued.

Other active hosted event triggers: issue_graphql_placeholder, issue_pg_cron_access, issue_pg_graphql_access, issue_pg_net_access, pgrst_ddl_watch, pgrst_drop_watch. CI baseline does not reproduce Supabase platform event triggers; the workflow is a portable application-schema rebuild, not a full hosted restoration.

Four application trigger functions return trigger and cannot be invoked as ordinary SQL RPCs; rls_auto_enable returns event_trigger. EXECUTE defaults alone do not establish an exploitable client call path. No hosted ACL modifications recommended on this evidence. Remaining: functional rebuild drill, application function-body parity and hosted H01-H15 tests; explicit user approval before any migration 017 deployment.
