-- RECOVERY REFERENCE ONLY. DO NOT EXECUTE AS A MIGRATION.
-- Live public function definitions captured read-only from shoppingapp-migration-lab on 2026-11-12.
-- These functions have dependencies on other tables, roles, extensions and privileges.
-- Their source order here is alphabetical, NOT a verified executable deployment order.
-- RLS trigger rls_auto_enable is lab/platform-specific; evaluate necessity before replay.
-- No grant/revoke, owner, schema dependencies, or restore verification are implied.
-- This file is a source-preservation aid, NOT an approved migration.

CREATE OR REPLACE FUNCTION public.create_siri_pairing(p_list uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid(); v_code text; v_id uuid;
begin
 if v_actor is null or p_list is null then raise exception 'Unauthorized'; end if;
 perform 1 from public.shopping_lists where id=p_list and owner_id=v_actor and deleted_at is null for update;
 if not found then raise exception 'List unavailable'; end if;
 if (select count(*) from public.siri_pairing_requests where owner_id=v_actor and created_at>now()-interval '1 hour') >= 5
 then raise exception 'Too many pairing requests'; end if;
 v_code:=replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');
 insert into public.siri_pairing_requests(owner_id,list_id,code_hash)
 values(v_actor,p_list,pg_catalog.sha256(pg_catalog.convert_to(v_code,'UTF8')))
 returning id into v_id;
 return jsonb_build_object('pairing_id',v_id,'pairing_code',v_code,'expires_in_seconds',600);
end $function$


-- NEXT CAPTURED FUNCTION --

CREATE OR REPLACE FUNCTION public.exchange_siri_pairing(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_pair public.siri_pairing_requests%rowtype; v_token text; v_credential uuid;
begin
 if p_code is null or p_code !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pairing code'; end if;
 select * into v_pair from public.siri_pairing_requests
 where code_hash=pg_catalog.sha256(pg_catalog.convert_to(p_code,'UTF8')) for update;
 if not found or v_pair.consumed_at is not null or v_pair.expires_at <= now()
 then raise exception 'Pairing unavailable'; end if;
 perform 1 from public.shopping_lists where id=v_pair.list_id and owner_id=v_pair.owner_id and deleted_at is null for update;
 if not found then raise exception 'Pairing unavailable'; end if;
 update public.siri_pairing_requests set consumed_at=now() where id=v_pair.id;
 v_token:=replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');
 insert into public.siri_shortcut_credentials(owner_id,list_id,token_hash,expires_at)
 values(v_pair.owner_id,v_pair.list_id,pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),null)
 returning id into v_credential;
 return jsonb_build_object('token',v_token,'credential_id',v_credential,'list_id',v_pair.list_id);
end $function$


-- NEXT CAPTURED FUNCTION --

CREATE OR REPLACE FUNCTION public.list_pending_invitation_links(p_list uuid)
 RETURNS TABLE(invitation_id uuid, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null then raise exception 'Permission denied'; end if;
 perform 1 from public.shopping_lists where id=p_list and owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Permission denied'; end if;
 return query select i.id,i.expires_at from public.list_invitation_links i
 where i.list_id=p_list and i.accepted_at is null and i.revoked_at is null
 and i.expires_at > clock_timestamp() order by i.created_at;
end;
$function$


-- NEXT CAPTURED FUNCTION --

CREATE OR REPLACE FUNCTION public.list_siri_shortcuts(p_list uuid)
 RETURNS TABLE(credential_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select c.id,c.created_at,c.expires_at,c.revoked_at
 from public.siri_shortcut_credentials c
 join public.shopping_lists l on l.id=c.list_id
 where l.id=p_list and l.owner_id=auth.uid() and l.deleted_at is null
   and c.owner_id=auth.uid()
 order by c.created_at desc
$function$


-- NEXT CAPTURED FUNCTION --

CREATE OR REPLACE FUNCTION public.revoke_all_siri_shortcuts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid := auth.uid(); v_count integer;
begin
 if v_actor is null then raise exception 'Unauthorized'; end if;
 update public.siri_shortcut_credentials
 set revoked_at=now()
 where owner_id=v_actor and revoked_at is null;
 get diagnostics v_count = row_count;
 return v_count;
end $function$


-- NEXT CAPTURED FUNCTION --

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$

