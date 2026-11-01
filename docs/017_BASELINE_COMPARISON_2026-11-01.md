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
