-- Read-only investigation of hosted Supabase ACL provenance and callable functions.
-- Run ONLY in shoppingapp-migration-lab SQL Editor. No changes.
WITH role_names AS (
 SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')
), app_tables AS (
 SELECT c.oid,c.relname,c.relacl,c.relowner
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
), app_functions AS (
 SELECT p.oid,p.proname,p.proargtypes,p.proacl,p.proowner,p.prosecdef
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
)
SELECT 'table_acl' AS section,t.relname AS object_name,
       'owner='||pg_get_userbyid(t.relowner)||'; acl='||coalesce(t.relacl::text,'<NULL: default owner privileges>') AS detail
FROM app_tables t
UNION ALL
SELECT 'function_acl',f.oid::regprocedure::text,
       'owner='||pg_get_userbyid(f.proowner)||'; definer='||f.prosecdef||
       '; acl='||coalesce(f.proacl::text,'<NULL: default function privileges>')
FROM app_functions f
UNION ALL
SELECT 'function_execute',f.oid::regprocedure::text||'|'||r.rolname,
       has_function_privilege(r.rolname,f.oid,'EXECUTE')::text
FROM app_functions f CROSS JOIN role_names r
UNION ALL
SELECT 'schema_usage',n.nspname||'|'||r.rolname,
       has_schema_privilege(r.rolname,n.oid,'USAGE')::text
FROM pg_namespace n CROSS JOIN role_names r
WHERE n.nspname IN ('public','auth','extensions')
UNION ALL
SELECT 'role_membership',r.rolname||'->'||g.rolname,
       pg_has_role(r.rolname,g.oid,'MEMBER')::text
FROM role_names r CROSS JOIN pg_roles g
WHERE g.rolname IN ('anon','authenticated','service_role')
UNION ALL
SELECT 'rls_auto_enable_owner',f.oid::regprocedure::text,
       'owner='||pg_get_userbyid(f.proowner)||'; acl='||coalesce(f.proacl::text,'<NULL>')
FROM app_functions f WHERE f.proname='rls_auto_enable'
ORDER BY 1,2,3;
