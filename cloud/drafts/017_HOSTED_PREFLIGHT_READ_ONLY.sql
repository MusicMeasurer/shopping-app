-- READ ONLY: run only against approved disposable migration lab.
-- Do not run migration 017 or change Data API settings.
select current_database() as database_name, current_user as sql_role,
       current_setting('server_version') as postgres_version;
select e.extname, n.nspname as installed_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname='pgcrypto';
select to_regprocedure('extensions.gen_random_bytes(integer)') as random_bytes,
       to_regprocedure('extensions.digest(bytea,text)') as digest_bytes,
       to_regprocedure('extensions.digest(text,text)') as digest_text;
select x.table_name, to_regclass('public.'||x.table_name) as relation
from (values ('shopping_lists'),('list_members'),('ownership_events'),
 ('user_notifications'),('list_invitation_links')) as x(table_name);
select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('shopping_lists','list_members','list_invitation_links')
and c.relkind in ('r','p');
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('transfer_list_ownership','create_list_invitation_link',
  'accept_list_invitation_link','revoke_list_invitation_link',
  'list_pending_invitation_links')
order by p.proname;
select c.relname as table_name,
       has_table_privilege('anon',c.oid,'SELECT') as anon_select,
       has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
       has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
       has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
       has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('shopping_lists','list_members','list_invitation_links')
and c.relkind in ('r','p')
order by c.relname;
