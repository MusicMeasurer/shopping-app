# Read-only lab recovery inventory (2026-11-12)

Source: shoppingapp-migration-lab, inspected live; **not a complete pg_dump**. No data rows, secrets, auth credentials or storage objects included. Restore not yet tested. SQL functions and policies below are evidence snapshots; review dependencies and security before executing. The repository's existing migrations remain authoritative for initial schema creation.

## functions

```json
[
  {
    "name": "accept_list_invitation_link",
    "args": "p_token text",
    "definition": "CREATE OR REPLACE FUNCTION public.accept_list_invitation_link(p_token text)\n RETURNS uuid\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_hash text; v_list uuid; v_inv public.list_invitation_links%rowtype; v_owner uuid;\nbegin\n if current_setting('transaction_isolation') <> 'read committed' then\n  raise exception 'READ COMMITTED required' using errcode='0A000';\n end if;\n if v_actor is null or p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then\n  raise exception 'Invalid invitation';\n end if;\n v_hash := encode(extensions.digest(p_token,'sha256'),'hex');\n -- First read is untrusted; lock the list before locking the invitation to\n -- serialize with transfer/revocation and avoid inverted lock order.\n select list_id into v_list from public.list_invitation_links where token_hash=v_hash;\n if v_list is null then raise exception 'Invalid invitation'; end if;\n select owner_id into v_owner from public.shopping_lists\n  where id=v_list and deleted_at is null for update;\n if not found then raise exception 'Invalid invitation'; end if;\n select * into v_inv from public.list_invitation_links\n  where token_hash=v_hash and list_id=v_list for update;\n if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null\n  or v_inv.expires_at <= clock_timestamp() or v_inv.created_by <> v_owner or v_actor=v_owner then\n  raise exception 'Invalid invitation';\n end if;\n if exists (select 1 from public.list_members where list_id=v_list and user_id=v_actor) then\n  raise exception 'Invalid invitation';\n end if;\n insert into public.list_members(list_id,user_id) values(v_list,v_actor);\n update public.list_invitation_links\n  set accepted_at=clock_timestamp(),accepted_by=v_actor where id=v_inv.id;\n return v_list;\nend;\n$function$\n"
  },
  {
    "name": "apply_item_change",
    "args": "p_operation uuid, p_list uuid, p_action text, p_item uuid, p_name text, p_purchased boolean, p_expected_version bigint",
    "definition": "CREATE OR REPLACE FUNCTION public.apply_item_change(p_operation uuid, p_list uuid, p_action text, p_item uuid, p_name text DEFAULT NULL::text, p_purchased boolean DEFAULT NULL::boolean, p_expected_version bigint DEFAULT NULL::bigint)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\ndeclare\r\n v_actor uuid := auth.uid();\r\n v_hash text;\r\n v_previous public.item_operations%rowtype;\r\n v_item public.shopping_items%rowtype;\r\n v_revision bigint;\r\n v_result jsonb;\r\nbegin\r\n if current_setting('transaction_isolation') <> 'read committed' then\r\n  raise exception 'Operation requires READ COMMITTED isolation'\r\n    using errcode = '0A000';\r\n end if;\r\n if v_actor is null or p_operation is null or p_list is null or p_item is null then\r\n  raise exception 'Invalid actor or identifiers';\r\n end if;\r\n if p_action not in ('add','update','delete') then\r\n  raise exception 'Unsupported action';\r\n end if;\r\n -- Lock the list before reading membership or mutating its items.\r\n perform 1 from public.shopping_lists\r\n  where id = p_list and deleted_at is null for update;\r\n if not found or not public.can_access_list(p_list) then\r\n  raise exception 'List unavailable';\r\n end if;\r\n -- A canonical text payload avoids relying on client-provided hashes.\r\n v_hash := md5(jsonb_build_array(p_list,p_action,p_item,p_name,p_purchased,p_expected_version)::text);\r\n select * into v_previous from public.item_operations\r\n  where actor_id = v_actor and operation_id = p_operation;\r\n if found then\r\n  if v_previous.payload_hash <> v_hash then\r\n   raise exception 'Operation ID payload mismatch';\r\n  end if;\r\n  return v_previous.result;\r\n end if;\r\n if p_action = 'add' then\r\n  if p_name is null or length(trim(p_name)) not between 1 and 120 then\r\n   raise exception 'Invalid name';\r\n  end if;\r\n  insert into public.shopping_items(id,list_id,name,purchased)\r\n   values(p_item,p_list,trim(p_name),coalesce(p_purchased,false))\r\n   returning * into v_item;\r\n else\r\n  select * into v_item from public.shopping_items\r\n   where id = p_item and list_id = p_list and deleted_at is null for update;\r\n  if not found then raise exception 'Item unavailable'; end if;\r\n  if p_expected_version is null or p_expected_version <> v_item.version then\r\n   raise exception 'Version conflict';\r\n  end if;\r\n  if p_action = 'update' then\r\n   if p_name is not null and length(trim(p_name)) not between 1 and 120 then\r\n    raise exception 'Invalid name';\r\n   end if;\r\n   update public.shopping_items\r\n    set name = coalesce(trim(p_name),name),\r\n        purchased = coalesce(p_purchased,purchased),\r\n        version = version + 1\r\n    where id = p_item returning * into v_item;\r\n  else\r\n   update public.shopping_items\r\n    set deleted_at = now(), version = version + 1\r\n    where id = p_item returning * into v_item;\r\n  end if;\r\n end if;\r\n update public.shopping_lists set revision = revision + 1\r\n  where id = p_list returning revision into v_revision;\r\n insert into public.list_changes(list_id,revision,item_id,kind,snapshot)\r\n  values(p_list,v_revision,p_item,p_action,\r\n   jsonb_build_object('id',v_item.id,'name',v_item.name,\r\n    'purchased',v_item.purchased,'version',v_item.version,\r\n    'deleted',v_item.deleted_at is not null));\r\n v_result := jsonb_build_object('operation_id',p_operation,\r\n  'list_revision',v_revision,'item_version',v_item.version);\r\n insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)\r\n  values(v_actor,p_operation,p_list,v_hash,v_result);\r\n return v_result;\r\nend;\r\n$function$\n"
  },
  {
    "name": "can_access_list",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.can_access_list(p_list uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\n  select exists (\r\n    select 1 from public.shopping_lists l\r\n    where l.id = p_list and l.deleted_at is null\r\n      and (l.owner_id = (select auth.uid())\r\n        or exists (select 1 from public.list_members m\r\n                   where m.list_id = l.id and m.user_id = (select auth.uid())))\r\n  );\r\n$function$\n"
  },
  {
    "name": "create_list_invitation_link",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.create_list_invitation_link(p_list uuid)\n RETURNS text\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_token text;\n        v_now timestamptz;\nbegin\n if current_setting('transaction_isolation') <> 'read committed' then\n  raise exception 'READ COMMITTED required' using errcode='0A000';\n end if;\n if v_actor is null or p_list is null then raise exception 'Permission denied'; end if;\n perform 1 from public.shopping_lists\n  where id=p_list and owner_id=v_actor and deleted_at is null for update;\n if not found then raise exception 'Permission denied'; end if;\n -- The list row lock serializes concurrent issuers for this list.\n v_now := clock_timestamp();\n if (select count(*) from public.list_invitation_links\n     where list_id=p_list and accepted_at is null and revoked_at is null\n       and expires_at > v_now) >= 10 then\n  raise exception 'Too many pending invitations';\n end if;\n -- Bound creation churn even if the owner revokes every link immediately.\n -- The same list lock serializes issuance; revoked/expired rows still count.\n if (select count(*) from public.list_invitation_links\n     where list_id=p_list and created_at > v_now - interval '24 hours') >= 20 then\n  raise exception 'Daily invitation creation limit reached';\n end if;\n v_token := encode(extensions.gen_random_bytes(32),'hex');\n insert into public.list_invitation_links(list_id,token_hash,created_by,created_at,expires_at)\n values(p_list,encode(extensions.digest(v_token,'sha256'),'hex'),v_actor,v_now,v_now+interval '24 hours');\n return v_token;\nend;\n$function$\n"
  },
  {
    "name": "create_siri_pairing",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.create_siri_pairing(p_list uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid:=auth.uid(); v_code text; v_id uuid;\nbegin\n if v_actor is null or p_list is null then raise exception 'Unauthorized'; end if;\n perform 1 from public.shopping_lists where id=p_list and owner_id=v_actor and deleted_at is null for update;\n if not found then raise exception 'List unavailable'; end if;\n if (select count(*) from public.siri_pairing_requests where owner_id=v_actor and created_at>now()-interval '1 hour') >= 5\n then raise exception 'Too many pairing requests'; end if;\n v_code:=replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');\n insert into public.siri_pairing_requests(owner_id,list_id,code_hash)\n values(v_actor,p_list,pg_catalog.sha256(pg_catalog.convert_to(v_code,'UTF8')))\n returning id into v_id;\n return jsonb_build_object('pairing_id',v_id,'pairing_code',v_code,'expires_in_seconds',600);\nend $function$\n"
  },
  {
    "name": "enroll_siri_shortcut",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.enroll_siri_shortcut(p_list uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_token text; v_id uuid;\nbegin\n if v_actor is null or p_list is null then raise exception 'Unauthorized'; end if;\n perform 1 from public.shopping_lists where id=p_list and owner_id=v_actor and deleted_at is null for update;\n if not found then raise exception 'List unavailable'; end if;\n v_token := replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');\n insert into public.siri_shortcut_credentials(owner_id,list_id,token_hash,expires_at)\n values(v_actor,p_list,pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),null)\n returning id into v_id;\n return jsonb_build_object('credential_id',v_id,'token',v_token);\nend $function$\n"
  },
  {
    "name": "exchange_siri_pairing",
    "args": "p_code text",
    "definition": "CREATE OR REPLACE FUNCTION public.exchange_siri_pairing(p_code text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_pair public.siri_pairing_requests%rowtype; v_token text; v_credential uuid;\nbegin\n if p_code is null or p_code !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pairing code'; end if;\n select * into v_pair from public.siri_pairing_requests\n where code_hash=pg_catalog.sha256(pg_catalog.convert_to(p_code,'UTF8')) for update;\n if not found or v_pair.consumed_at is not null or v_pair.expires_at <= now()\n then raise exception 'Pairing unavailable'; end if;\n perform 1 from public.shopping_lists where id=v_pair.list_id and owner_id=v_pair.owner_id and deleted_at is null for update;\n if not found then raise exception 'Pairing unavailable'; end if;\n update public.siri_pairing_requests set consumed_at=now() where id=v_pair.id;\n v_token:=replace(pg_catalog.gen_random_uuid()::text,'-','') || replace(pg_catalog.gen_random_uuid()::text,'-','');\n insert into public.siri_shortcut_credentials(owner_id,list_id,token_hash,expires_at)\n values(v_pair.owner_id,v_pair.list_id,pg_catalog.sha256(pg_catalog.convert_to(v_token,'UTF8')),null)\n returning id into v_credential;\n return jsonb_build_object('token',v_token,'credential_id',v_credential,'list_id',v_pair.list_id);\nend $function$\n"
  },
  {
    "name": "guard_item_identity",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.guard_item_identity()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$\r\nbegin\r\n if new.id is distinct from old.id\r\n or new.list_id is distinct from old.list_id\r\n or new.created_at is distinct from old.created_at then\r\n  raise exception 'Item identity is immutable';\r\n end if;\r\n return new;\r\nend;\r\n$function$\n"
  },
  {
    "name": "guard_new_list_metadata",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.guard_new_list_metadata()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$\r\nbegin\r\n  if new.revision is distinct from 0 then\r\n    raise exception 'Initial list revision must be zero'\r\n      using errcode = '22023';\r\n  end if;\r\n  if new.created_at is distinct from transaction_timestamp()\r\n     or new.updated_at is distinct from transaction_timestamp() then\r\n    -- Server defaults may use now() (= transaction_timestamp()).\r\n    raise exception 'Initial list timestamps must be server-generated'\r\n      using errcode = '22023';\r\n  end if;\r\n  return new;\r\nend;\r\n$function$\n"
  },
  {
    "name": "is_list_owner",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.is_list_owner(p_list uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\n  select exists (\r\n    select 1 from public.shopping_lists l\r\n    where l.id = p_list and l.owner_id = (select auth.uid()) and l.deleted_at is null\r\n  );\r\n$function$\n"
  },
  {
    "name": "list_pending_invitation_links",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.list_pending_invitation_links(p_list uuid)\n RETURNS TABLE(invitation_id uuid, expires_at timestamp with time zone)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n if auth.uid() is null then raise exception 'Permission denied'; end if;\n perform 1 from public.shopping_lists where id=p_list and owner_id=auth.uid() and deleted_at is null for update;\n if not found then raise exception 'Permission denied'; end if;\n return query select i.id,i.expires_at from public.list_invitation_links i\n where i.list_id=p_list and i.accepted_at is null and i.revoked_at is null\n and i.expires_at > clock_timestamp() order by i.created_at;\nend;\n$function$\n"
  },
  {
    "name": "list_siri_shortcuts",
    "args": "p_list uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.list_siri_shortcuts(p_list uuid)\n RETURNS TABLE(credential_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone)\n LANGUAGE sql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n select c.id,c.created_at,c.expires_at,c.revoked_at\n from public.siri_shortcut_credentials c\n join public.shopping_lists l on l.id=c.list_id\n where l.id=p_list and l.owner_id=auth.uid() and l.deleted_at is null\n   and c.owner_id=auth.uid()\n order by c.created_at desc\n$function$\n"
  },
  {
    "name": "prepare_account_deletion",
    "args": "p_user uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user uuid)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\nbegin\r\n  raise exception 'Account deletion is temporarily unavailable'\r\n    using errcode = '0A000';\r\nend;\r\n$function$\n"
  },
  {
    "name": "pull_item_changes",
    "args": "p_list uuid, p_after_revision bigint, p_page_size integer",
    "definition": "CREATE OR REPLACE FUNCTION public.pull_item_changes(p_list uuid, p_after_revision bigint DEFAULT 0, p_page_size integer DEFAULT 100)\n RETURNS TABLE(revision bigint, kind text, snapshot jsonb)\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\nbegin\r\n if current_setting('transaction_isolation') <> 'read committed' then\r\n  raise exception 'Pull requires READ COMMITTED isolation'\r\n    using errcode = '0A000';\r\n end if;\r\n if auth.uid() is null or p_list is null then\r\n  raise exception 'Authentication and list required';\r\n end if;\r\n if p_after_revision is null or p_after_revision < 0\r\n or p_page_size is null or p_page_size < 1 or p_page_size > 500 then\r\n  raise exception 'Invalid cursor or page size';\r\n end if;\r\n\r\n -- This row lock conflicts with FOR UPDATE used by member removal and\r\n -- item mutation. It is held until the surrounding transaction completes.\r\n perform 1 from public.shopping_lists l\r\n  where l.id = p_list and l.deleted_at is null for share;\r\n if not found or not public.can_access_list(p_list) then\r\n  raise exception 'List unavailable';\r\n end if;\r\n\r\n return query\r\n  select c.revision,c.kind,c.snapshot\r\n  from public.list_changes c\r\n  where c.list_id = p_list and c.revision > p_after_revision\r\n  order by c.revision\r\n  limit p_page_size;\r\nend;\r\n$function$\n"
  },
  {
    "name": "reject_item_list_change",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.reject_item_list_change()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$\r\nbegin\r\n  if new.list_id is distinct from old.list_id then\r\n    raise exception 'Moving items between lists is not supported';\r\n  end if;\r\n  return new;\r\nend;\r\n$function$\n"
  },
  {
    "name": "remove_list_member",
    "args": "p_list uuid, p_member uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.remove_list_member(p_list uuid, p_member uuid)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\r\ndeclare v_actor uuid := auth.uid();\r\nbegin\r\n if current_setting('transaction_isolation') <> 'read committed' then\r\n  raise exception 'Operation requires READ COMMITTED isolation'\r\n    using errcode = '0A000';\r\n end if;\r\n if v_actor is null or p_list is null or p_member is null then\r\n  raise exception 'Missing authenticated actor or identifiers';\r\n end if;\r\n perform 1 from public.shopping_lists\r\n  where id = p_list and deleted_at is null for update;\r\n if not found then raise exception 'List unavailable'; end if;\r\n if not (public.is_list_owner(p_list) or v_actor = p_member) then\r\n  raise exception 'Permission denied';\r\n end if;\r\n delete from public.list_members\r\n  where list_id = p_list and user_id = p_member;\r\nend;\r\n$function$\n"
  },
  {
    "name": "revoke_all_siri_shortcuts",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.revoke_all_siri_shortcuts()\n RETURNS integer\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_count integer;\nbegin\n if v_actor is null then raise exception 'Unauthorized'; end if;\n update public.siri_shortcut_credentials\n set revoked_at=now()\n where owner_id=v_actor and revoked_at is null;\n get diagnostics v_count = row_count;\n return v_count;\nend $function$\n"
  },
  {
    "name": "revoke_list_invitation_link",
    "args": "p_invitation uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.revoke_list_invitation_link(p_invitation uuid)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_list uuid;\nbegin\n if current_setting('transaction_isolation') <> 'read committed' then\n  raise exception 'READ COMMITTED required' using errcode='0A000';\n end if;\n if v_actor is null or p_invitation is null then raise exception 'Permission denied'; end if;\n select list_id into v_list from public.list_invitation_links where id=p_invitation;\n if v_list is null then raise exception 'Permission denied'; end if;\n perform 1 from public.shopping_lists where id=v_list and owner_id=v_actor\n  and deleted_at is null for update;\n if not found then raise exception 'Permission denied'; end if;\n update public.list_invitation_links set revoked_at=clock_timestamp()\n  where id=p_invitation and list_id=v_list and accepted_at is null and revoked_at is null;\nend;\n$function$\n"
  },
  {
    "name": "revoke_siri_shortcut",
    "args": "p_credential uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.revoke_siri_shortcut(p_credential uuid)\n RETURNS boolean\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\nbegin\n if auth.uid() is null then raise exception 'Unauthorized'; end if;\n update public.siri_shortcut_credentials\n set revoked_at = now()\n where id = p_credential and owner_id = auth.uid() and revoked_at is null;\n return found;\nend;\n$function$\n"
  },
  {
    "name": "rls_auto_enable",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.rls_auto_enable()\n RETURNS event_trigger\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'pg_catalog'\nAS $function$\nDECLARE\n  cmd record;\n  tbl name;\nBEGIN\n  FOR cmd IN\n    SELECT *\n    FROM pg_event_trigger_ddl_commands()\n    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')\n      AND object_type IN ('table','partitioned table')\n  LOOP\n     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN\n      BEGIN\n        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;\n        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);\n        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;\n      EXCEPTION\n        WHEN OTHERS THEN\n          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;\n      END;\n     ELSE\n        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;\n     END IF;\n  END LOOP;\nEND;\n$function$\n"
  },
  {
    "name": "set_updated_at",
    "args": "",
    "definition": "CREATE OR REPLACE FUNCTION public.set_updated_at()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\nAS $function$ begin new.updated_at = now(); return new; end; $function$\n"
  },
  {
    "name": "siri_add_item",
    "args": "p_token text, p_operation uuid, p_list uuid, p_name text",
    "definition": "CREATE OR REPLACE FUNCTION public.siri_add_item(p_token text, p_operation uuid, p_list uuid, p_name text)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare\n v_credential public.siri_shortcut_credentials%rowtype;\n v_previous public.item_operations%rowtype;\n v_item public.shopping_items%rowtype;\n v_revision bigint; v_hash text; v_result jsonb;\nbegin\n if p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$'\n or p_operation is null or p_list is null or p_name is null\n or length(trim(p_name)) not between 1 and 120 or p_name ~ '[[:cntrl:]]'\n then raise exception 'Invalid request'; end if;\n select * into v_credential from public.siri_shortcut_credentials\n where token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')) for update;\n if not found or v_credential.revoked_at is not null\n or (v_credential.expires_at is not null and v_credential.expires_at <= now())\n or v_credential.list_id <> p_list then raise exception 'Unauthorized'; end if;\n perform 1 from public.shopping_lists\n where id=p_list and owner_id=v_credential.owner_id and deleted_at is null for update;\n if not found then raise exception 'List unavailable'; end if;\n v_hash:=md5(jsonb_build_array(p_list,'add',p_operation,trim(p_name),false,null)::text);\n select * into v_previous from public.item_operations\n where actor_id=v_credential.owner_id and operation_id=p_operation;\n if found then\n  if v_previous.payload_hash <> v_hash then raise exception 'Operation mismatch'; end if;\n  return jsonb_build_object('operation_id',p_operation);\n end if;\n if (select count(*) from public.siri_shortcut_operations\n where credential_id=v_credential.id and created_at > now()-interval '1 hour') >= 60\n then raise exception 'Rate limit exceeded'; end if;\n insert into public.shopping_items(id,list_id,name,purchased)\n values(p_operation,p_list,trim(p_name),false) returning * into v_item;\n update public.shopping_lists set revision=revision+1 where id=p_list returning revision into v_revision;\n insert into public.list_changes(list_id,revision,item_id,kind,snapshot)\n values(p_list,v_revision,p_operation,'add',\n jsonb_build_object('id',v_item.id,'name',v_item.name,'purchased',false,'version',v_item.version,'deleted',false));\n v_result:=jsonb_build_object('operation_id',p_operation,'list_revision',v_revision,'item_version',v_item.version);\n insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)\n values(v_credential.owner_id,p_operation,p_list,v_hash,v_result);\n insert into public.siri_shortcut_operations(credential_id,operation_id)\n values(v_credential.id,p_operation);\n return jsonb_build_object('operation_id',p_operation);\nend $function$\n"
  },
  {
    "name": "transfer_list_ownership",
    "args": "p_list uuid, p_new_owner uuid",
    "definition": "CREATE OR REPLACE FUNCTION public.transfer_list_ownership(p_list uuid, p_new_owner uuid)\n RETURNS void\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\nAS $function$\ndeclare v_actor uuid := auth.uid(); v_old_owner uuid;\nbegin\n if current_setting('transaction_isolation') <> 'read committed' then\n  raise exception 'READ COMMITTED required' using errcode='0A000';\n end if;\n if v_actor is null or p_list is null or p_new_owner is null then\n  raise exception 'Missing actor or identifiers';\n end if;\n select owner_id into v_old_owner from public.shopping_lists\n  where id=p_list and deleted_at is null for update;\n if not found or v_old_owner <> v_actor then raise exception 'Only current owner can transfer'; end if;\n if p_new_owner=v_old_owner or not exists (\n  select 1 from public.list_members where list_id=p_list and user_id=p_new_owner\n ) then raise exception 'New owner must be a current member'; end if;\n update public.list_invitation_links set revoked_at=clock_timestamp()\n  where list_id=p_list and accepted_at is null and revoked_at is null;\n delete from public.list_members where list_id=p_list and user_id=p_new_owner;\n update public.shopping_lists set owner_id=p_new_owner where id=p_list;\n insert into public.list_members(list_id,user_id) values(p_list,v_old_owner);\n insert into public.ownership_events(list_id,old_owner,new_owner,reason)\n  values(p_list,v_old_owner,p_new_owner,'voluntary');\n insert into public.user_notifications(recipient_id,list_id,event_type,payload)\n  values(p_new_owner,p_list,'ownership_received',\n   jsonb_build_object('list_id',p_list,'previous_owner',v_old_owner));\nend;\n$function$\n"
  }
]
```

## policies

```json
[
  {
    "schemaname": "public",
    "tablename": "list_members",
    "policyname": "members_read",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "can_access_list(list_id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "shopping_items",
    "policyname": "items_delete",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "DELETE",
    "qual": "can_access_list(list_id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "shopping_items",
    "policyname": "items_insert",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "(can_access_list(list_id) AND (deleted_at IS NULL))"
  },
  {
    "schemaname": "public",
    "tablename": "shopping_items",
    "policyname": "items_read",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "can_access_list(list_id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "shopping_items",
    "policyname": "items_update",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "UPDATE",
    "qual": "(can_access_list(list_id) AND (deleted_at IS NULL))",
    "with_check": "(can_access_list(list_id) AND (deleted_at IS NULL))"
  },
  {
    "schemaname": "public",
    "tablename": "shopping_lists",
    "policyname": "lists_delete",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "DELETE",
    "qual": "is_list_owner(id)",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "shopping_lists",
    "policyname": "lists_insert",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "INSERT",
    "qual": null,
    "with_check": "((owner_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL))"
  },
  {
    "schemaname": "public",
    "tablename": "shopping_lists",
    "policyname": "lists_read",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "((deleted_at IS NULL) AND ((owner_id = ( SELECT auth.uid() AS uid)) OR can_access_list(id)))",
    "with_check": null
  },
  {
    "schemaname": "public",
    "tablename": "shopping_lists",
    "policyname": "lists_update",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "UPDATE",
    "qual": "is_list_owner(id)",
    "with_check": "is_list_owner(id)"
  },
  {
    "schemaname": "public",
    "tablename": "user_notifications",
    "policyname": "notifications_read",
    "permissive": "PERMISSIVE",
    "roles": "{authenticated}",
    "cmd": "SELECT",
    "qual": "(recipient_id = ( SELECT auth.uid() AS uid))",
    "with_check": null
  }
]
```

## triggers

```json
[
  {
    "table_name": "shopping_items",
    "trigger_name": "guard_item_identity_before_update",
    "action_timing": "BEFORE",
    "event_manipulation": "UPDATE",
    "action_statement": "EXECUTE FUNCTION guard_item_identity()"
  },
  {
    "table_name": "shopping_items",
    "trigger_name": "items_updated",
    "action_timing": "BEFORE",
    "event_manipulation": "UPDATE",
    "action_statement": "EXECUTE FUNCTION set_updated_at()"
  },
  {
    "table_name": "shopping_items",
    "trigger_name": "protect_item_list",
    "action_timing": "BEFORE",
    "event_manipulation": "UPDATE",
    "action_statement": "EXECUTE FUNCTION reject_item_list_change()"
  },
  {
    "table_name": "shopping_lists",
    "trigger_name": "guard_new_list_metadata_before_insert",
    "action_timing": "BEFORE",
    "event_manipulation": "INSERT",
    "action_statement": "EXECUTE FUNCTION guard_new_list_metadata()"
  },
  {
    "table_name": "shopping_lists",
    "trigger_name": "lists_updated",
    "action_timing": "BEFORE",
    "event_manipulation": "UPDATE",
    "action_statement": "EXECUTE FUNCTION set_updated_at()"
  }
]
```

## grants

```json
[
  {
    "table_name": "item_operations",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "item_operations",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "item_operations",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "list_changes",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "list_changes",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "list_changes",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "list_invitation_links",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "list_invitation_links",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "list_invitation_links",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "list_members",
    "grantee": "authenticated",
    "privilege_type": "SELECT"
  },
  {
    "table_name": "list_members",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "list_members",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "list_members",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "ownership_events",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "ownership_events",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "ownership_events",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "shopping_items",
    "grantee": "authenticated",
    "privilege_type": "SELECT"
  },
  {
    "table_name": "shopping_items",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "shopping_items",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "shopping_items",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "shopping_lists",
    "grantee": "authenticated",
    "privilege_type": "INSERT"
  },
  {
    "table_name": "shopping_lists",
    "grantee": "authenticated",
    "privilege_type": "SELECT"
  },
  {
    "table_name": "shopping_lists",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "shopping_lists",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "shopping_lists",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "siri_pairing_requests",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "siri_pairing_requests",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "siri_pairing_requests",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "siri_shortcut_credentials",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "siri_shortcut_operations",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "siri_shortcut_operations",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "siri_shortcut_operations",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  },
  {
    "table_name": "user_notifications",
    "grantee": "authenticated",
    "privilege_type": "SELECT"
  },
  {
    "table_name": "user_notifications",
    "grantee": "service_role",
    "privilege_type": "REFERENCES"
  },
  {
    "table_name": "user_notifications",
    "grantee": "service_role",
    "privilege_type": "TRIGGER"
  },
  {
    "table_name": "user_notifications",
    "grantee": "service_role",
    "privilege_type": "TRUNCATE"
  }
]
```

## edge_siri-add

```json
{
  "version": 2,
  "verify_jwt": false,
  "files": [
    {
      "name": "index.ts",
      "content": "// E3 lab deployment: active in disposable project only; not production.\\n// Requires reviewed 020_siri_add_REVIEW_ONLY.sql.\n// Deploy with JWT verification disabled ONLY for this endpoint; it authenticates\n// a separately scoped Shortcut token, never a Supabase user session.\nimport { createClient } from 'npm:@supabase/supabase-js@2.119.0'\n\nconst json = (body: unknown, status: number) => new Response(JSON.stringify(body), {\n  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },\n})\nconst uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i\n\nDeno.serve(async request => {\n  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)\n  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {\n    return json({ error: 'Expected JSON' }, 415)\n  }\n  const length = Number(request.headers.get('content-length') || 0)\n  if (length > 4096) return json({ error: 'Request too large' }, 413)\n  const auth = request.headers.get('authorization') || ''\n  const match = /^Bearer ([0-9a-f]{64})$/.exec(auth)\n  if (!match) return json({ error: 'Unauthorized' }, 401)\n  let input: unknown\n  try {\n    const raw = await request.text()\n    if (new TextEncoder().encode(raw).length > 4096) return json({ error: 'Request too large' }, 413)\n    input = JSON.parse(raw)\n  } catch { return json({ error: 'Invalid JSON' }, 400) }\n  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid request' }, 400)\n  const data = input as Record<string, unknown>\n  if (Object.keys(data).some(key => !['operationId', 'listId', 'name'].includes(key)) ||\n      (data.operationId !== undefined && (typeof data.operationId !== 'string' || !uuid.test(data.operationId))) ||\n      typeof data.listId !== 'string' || !uuid.test(data.listId) ||\n      typeof data.name !== 'string' || !data.name.trim() ||\n      data.name.trim().length > 120 || /[\\u0000-\\u001f\\u007f]/.test(data.name)) {\n    return json({ error: 'Invalid request' }, 400)\n  }\n  const url = Deno.env.get('SUPABASE_URL')\n  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')\n  if (!url || !serviceKey) return json({ error: 'Unavailable' }, 503)\n  try {\n    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })\n    const { data: receipt, error } = await client.rpc('siri_add_item', {\n      p_token: match[1], p_operation: data.operationId ?? crypto.randomUUID(),\n      p_list: data.listId, p_name: data.name.trim(),\n    })\n    if (error) {\n      // Avoid leaking credential, SQL errors, or whether a list exists.\n      return json({ error: 'Not authorized or unable to add item' }, 403)\n    }\n    return json({ ok: true, receipt }, 200)\n  } catch {\n    return json({ error: 'Service temporarily unavailable' }, 503)\n  }\n})\n"
    }
  ]
}
```

## edge_siri-pair

```json
{
  "version": 1,
  "verify_jwt": false,
  "files": [
    {
      "name": "index.ts",
      "content": "// Lab-only Siri pairing exchange. Does not implement one-button onboarding by itself.\n// The 64-hex one-use code is exchanged by a neutral Shortcut, never displayed in UI.\nimport { createClient } from 'npm:@supabase/supabase-js@2.119.0'\n\nconst json = (body: unknown, status: number) => new Response(JSON.stringify(body), {\n  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },\n})\nconst codePattern = /^[0-9a-f]{64}$/\n\nDeno.serve(async request => {\n  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)\n  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json')\n    return json({ error: 'Expected JSON' }, 415)\n  if (Number(request.headers.get('content-length') || 0) > 1024)\n    return json({ error: 'Request too large' }, 413)\n  let data: unknown\n  try {\n    const raw = await request.text()\n    if (new TextEncoder().encode(raw).length > 1024) return json({ error: 'Request too large' }, 413)\n    data = JSON.parse(raw)\n  } catch { return json({ error: 'Invalid JSON' }, 400) }\n  if (!data || typeof data !== 'object' || Array.isArray(data) ||\n      Object.keys(data).length !== 1 ||\n      typeof (data as Record<string, unknown>).pairingCode !== 'string' ||\n      !codePattern.test((data as Record<string, string>).pairingCode))\n    return json({ error: 'Invalid request' }, 400)\n\n  const url = Deno.env.get('SUPABASE_URL')\n  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')\n  if (!url || !serviceKey) return json({ error: 'Unavailable' }, 503)\n  try {\n    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })\n    const { data: credential, error } = await client.rpc('exchange_siri_pairing', {\n      p_code: (data as Record<string, string>).pairingCode,\n    })\n    if (error || !credential) return json({ error: 'Pairing unavailable' }, 403)\n    return json({ token: credential.token, listId: credential.list_id }, 200)\n  } catch {\n    return json({ error: 'Service temporarily unavailable' }, 503)\n  }\n})\n"
    }
  ]
}
```
