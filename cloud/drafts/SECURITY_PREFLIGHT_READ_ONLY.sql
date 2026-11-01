-- ShoppingApp · read-only security preflight (2026-11-01)
-- Run only in disposable lab. Returns violations; ZERO rows = preliminary PASS.
-- Does not replace authenticated A/B HTTP or concurrency tests.
WITH expected_tables(name) AS (
  VALUES ('shopping_lists'),('shopping_items'),('list_members'),
         ('item_operations'),('list_changes'),('ownership_events'),('user_notifications')
), table_checks AS (
  SELECT 'missing_table_or_rls_disabled' AS violation, e.name AS object_name
  FROM expected_tables e LEFT JOIN pg_class c
    ON c.relname=e.name AND c.relnamespace='public'::regnamespace
  WHERE c.oid IS NULL OR NOT c.relrowsecurity
), prohibited_grants AS (
  SELECT 'unsafe_table_privilege' AS violation, t.table_name||':'||t.grantee||':'||t.privilege_type AS object_name
  FROM information_schema.role_table_grants t
  WHERE t.table_schema='public'
    AND t.grantee IN ('anon','authenticated')
    AND (t.grantee='anon' OR t.privilege_type IN ('UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
      OR (t.privilege_type='INSERT' AND t.table_name <> 'shopping_lists')
      OR (t.privilege_type='SELECT' AND t.table_name NOT IN ('shopping_lists','shopping_items','list_members','user_notifications')))
), expected_grants AS (
  SELECT 'missing_required_grant' AS violation, x.tablename||':'||x.priv AS object_name
  FROM (VALUES
    ('shopping_lists','SELECT'),('shopping_lists','INSERT'),
    ('shopping_items','SELECT'),('list_members','SELECT'),('user_notifications','SELECT')
  ) x(tablename,priv)
  WHERE NOT has_table_privilege('authenticated', 'public.'||x.tablename, x.priv)
), function_checks AS (
  SELECT 'unsafe_function_execute' AS violation, p.proname||':'||r.rolname AS object_name
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  CROSS JOIN (VALUES ('anon'),('authenticated')) r(rolname)
  WHERE n.nspname='public' AND p.proname='prepare_account_deletion'
    AND has_function_privilege(r.rolname, p.oid, 'EXECUTE')
), effective_checks AS (
  SELECT 'unsafe_effective_table_privilege' AS violation,
    x.tablename||':'||x.role_name||':'||x.priv AS object_name
  FROM (SELECT name AS tablename FROM expected_tables) t
  CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
  CROSS JOIN (VALUES ('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
  CROSS JOIN LATERAL (SELECT t.tablename,r.role_name,p.priv) x
  WHERE has_table_privilege(x.role_name, 'public.'||x.tablename, x.priv)
  UNION ALL
  SELECT 'unsafe_effective_anon_read_or_write', t.name||':'||p.priv
  FROM expected_tables t CROSS JOIN (VALUES ('SELECT'),('INSERT')) p(priv)
  WHERE has_table_privilege('anon','public.'||t.name,p.priv)
)
SELECT * FROM table_checks
UNION ALL SELECT * FROM prohibited_grants
UNION ALL SELECT * FROM expected_grants
UNION ALL SELECT * FROM function_checks
UNION ALL SELECT * FROM effective_checks
ORDER BY violation, object_name;
