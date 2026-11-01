-- Read-only structural/security inventory for disposable lab and CI.
-- Compare exported rows by section/key/value; do not treat as a backup.
WITH facts AS (
 SELECT 'table_security' AS section, c.relname::text AS object_key,
        concat('rls=',c.relrowsecurity,',force=',c.relforcerowsecurity) AS value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
 UNION ALL
 SELECT 'column', c.table_name||'.'||c.column_name,
        concat(c.data_type,'|',c.udt_name,'|nullable=',c.is_nullable,
               '|default=',coalesce(c.column_default,'<none>'))
 FROM information_schema.columns c WHERE c.table_schema='public'
 UNION ALL
 SELECT 'constraint', t.relname||'.'||con.conname,
        pg_get_constraintdef(con.oid)
 FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'policy', tablename||'.'||policyname,
        concat('cmd=',cmd,'|permissive=',permissive,'|roles=',array_to_string(roles,','),
               '|using=',coalesce(qual,'<none>'),'|check=',coalesce(with_check,'<none>'))
 FROM pg_policies WHERE schemaname='public'
 UNION ALL
 SELECT 'function_security', p.proname||'('||
       coalesce((SELECT string_agg(format_type(a.argtype,NULL),',' ORDER BY a.ord)
       FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY a(argtype,ord)),'')||')',
       concat('definer=',p.prosecdef,'|volatile=',p.provolatile,
              '|config=',coalesce(array_to_string(p.proconfig,','),'<none>'))
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 UNION ALL
 SELECT 'table_privilege', t.table_name||'|'||r.role_name||'|'||v.privilege,
        has_table_privilege(r.role_name,format('%I.%I',t.table_schema,t.table_name),v.privilege)::text
 FROM information_schema.tables t
 CROSS JOIN (VALUES ('anon'),('authenticated')) r(role_name)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) v(privilege)
 WHERE t.table_schema='public' AND t.table_type='BASE TABLE'
 AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r.role_name)
)
SELECT section,object_key,value FROM facts ORDER BY section,object_key,value;
