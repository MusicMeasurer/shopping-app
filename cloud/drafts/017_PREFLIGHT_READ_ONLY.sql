-- Migration 017 PRE-FLIGHT (READ ONLY).
-- Run against a disposable PostgreSQL/Supabase database AFTER schema 001..016.
-- This script does not install migration 017 or modify data.
-- A failed assertion indicates a prerequisite mismatch.

do $$
declare
 v_missing text;
begin
 select string_agg(obj, ', ') into v_missing from (
  select 'public.shopping_lists' as obj where to_regclass('public.shopping_lists') is null
  union all select 'public.list_members' where to_regclass('public.list_members') is null
  union all select 'auth.users' where to_regclass('auth.users') is null
  union all select 'public.is_list_owner(uuid)' where to_regprocedure('public.is_list_owner(uuid)') is null
  union all select 'public.remove_list_member(uuid,uuid)' where to_regprocedure('public.remove_list_member(uuid,uuid)') is null
 ) x;
 if v_missing is not null then
  raise exception 'Missing prerequisites: %', v_missing;
 end if;
 if not exists (
  select 1 from pg_attribute
  where attrelid='public.shopping_lists'::regclass
   and attname='deleted_at' and not attisdropped
 ) then
  raise exception 'shopping_lists.deleted_at missing';
 end if;
 if not exists (
  select 1 from pg_attribute
  where attrelid='public.shopping_lists'::regclass
   and attname='owner_id' and not attisdropped
 ) then
  raise exception 'shopping_lists.owner_id missing';
 end if;
 raise notice 'Prerequisites present; this is not a migration 017 compile test';
end;
$$;

-- Inspect existing member table primary key and existing function signatures.
select c.conname, pg_get_constraintdef(c.oid) as definition
from pg_constraint c where c.conrelid='public.list_members'::regclass
order by c.conname;

select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
       p.proconfig as settings, p.proacl as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
 and p.proname in ('is_list_owner','remove_list_member','transfer_list_ownership')
order by p.proname;

-- When migration 017 has been installed on a disposable database:
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner, p.prosecdef as security_definer,
       p.proconfig as settings, p.proacl as grants
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
 and p.proname in (
 'create_list_invitation','accept_list_invitation',
 'finalize_list_invitation','revoke_list_invitation',
 'decline_list_invitation','get_incoming_list_invitations',
 'get_sent_list_invitations')
order by p.proname;

select schemaname, tablename, rowsecurity
from pg_tables where schemaname='public' and tablename='list_invitations';
