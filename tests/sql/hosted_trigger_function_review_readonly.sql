-- Read-only final review: function kinds, ownership, trigger binding and
-- rls_auto_enable definition. Run only in disposable shoppingapp-migration-lab.
SELECT 'function' AS section,
       p.oid::regprocedure::text AS object_name,
       concat('kind=',p.prokind,'; return=',p.prorettype::regtype,
              '; definer=',p.prosecdef,'; owner=',pg_get_userbyid(p.proowner),
              '; definition=',pg_get_functiondef(p.oid)) AS detail
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND (p.proname='rls_auto_enable'
       OR p.prorettype='pg_catalog.trigger'::regtype
       OR p.prorettype='pg_catalog.event_trigger'::regtype)
UNION ALL
SELECT 'event_trigger', e.evtname,
       concat('event=',e.evtevent,'; enabled=',e.evtenabled,
              '; function=',e.evtfoid::regprocedure::text)
FROM pg_event_trigger e
UNION ALL
SELECT 'default_acl', coalesce(n.nspname,'<all>')||'|'||
       pg_get_userbyid(d.defaclrole)||'|'||d.defaclobjtype,
       d.defaclacl::text
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
WHERE n.nspname='public' OR d.defaclnamespace=0
ORDER BY 1,2,3;
