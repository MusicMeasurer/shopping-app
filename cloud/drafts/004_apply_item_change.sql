-- ShoppingApp draft 004: transactional item mutations.
-- Apply after 001, 002, 003 in a disposable test database.
-- SECURITY REVIEW REQUIRED before execution outside a test database.
create or replace function public.apply_item_change(
 p_operation uuid, p_list uuid, p_action text, p_item uuid,
 p_name text default null, p_purchased boolean default null,
 p_expected_version bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_previous public.item_operations%rowtype;
 v_item public.shopping_items%rowtype;
 v_revision bigint;
 v_result jsonb;
begin
 if v_actor is null or p_operation is null or p_list is null or p_item is null then
  raise exception 'Invalid actor or identifiers';
 end if;
 if p_action not in ('add','update','delete') then
  raise exception 'Unsupported action';
 end if;
 -- Lock the list before reading membership or mutating its items.
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;
 -- A canonical text payload avoids relying on client-provided hashes.
 v_hash := md5(jsonb_build_array(p_list,p_action,p_item,p_name,p_purchased,p_expected_version)::text);
 select * into v_previous from public.item_operations
  where actor_id = v_actor and operation_id = p_operation;
 if found then
  if v_previous.payload_hash <> v_hash then
   raise exception 'Operation ID payload mismatch';
  end if;
  return v_previous.result;
 end if;
 if p_action = 'add' then
  if p_name is null or length(trim(p_name)) not between 1 and 120 then
   raise exception 'Invalid name';
  end if;
  insert into public.shopping_items(id,list_id,name,purchased)
   values(p_item,p_list,trim(p_name),coalesce(p_purchased,false))
   returning * into v_item;
 else
  select * into v_item from public.shopping_items
   where id = p_item and list_id = p_list and deleted_at is null for update;
  if not found then raise exception 'Item unavailable'; end if;
  if p_expected_version is null or p_expected_version <> v_item.version then
   raise exception 'Version conflict';
  end if;
  if p_action = 'update' then
   if p_name is not null and length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid name';
   end if;
   update public.shopping_items
    set name = coalesce(trim(p_name),name),
        purchased = coalesce(p_purchased,purchased),
        version = version + 1
    where id = p_item returning * into v_item;
  else
   update public.shopping_items
    set deleted_at = now(), version = version + 1
    where id = p_item returning * into v_item;
  end if;
 end if;
 update public.shopping_lists set revision = revision + 1
  where id = p_list returning revision into v_revision;
 insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
  values(p_list,v_revision,p_item,p_action,
   jsonb_build_object('id',v_item.id,'name',v_item.name,
    'purchased',v_item.purchased,'version',v_item.version,
    'deleted',v_item.deleted_at is not null));
 v_result := jsonb_build_object('operation_id',p_operation,
  'list_revision',v_revision,'item_version',v_item.version);
 insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
  values(v_actor,p_operation,p_list,v_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint) from public, anon;
grant execute on function public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint) to authenticated;

-- Known limitations:
-- Existing 002 item UPDATE RLS policy is bypassed only when the SECURITY DEFINER
-- function owner has sufficient privileges. Verify owner and ACL in test DB.
-- 002 list-owner trigger does not block revision-only updates.
-- Concurrent reuse of operation UUID on different lists may raise a uniqueness
-- error rather than returning an idempotent result.
-- No pull API, retention, initial snapshot or structured conflict response yet.
