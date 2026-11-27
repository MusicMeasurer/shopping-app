-- Review-only additive draft. Preserve applied 046 and the existing delete RPC.
-- A cancellation can fence an unapplied delete; it must not resurrect a committed tombstone.
begin;
create function public.cancel_e4_item_delete(p_cancel uuid,p_original jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  original_id uuid := (p_original->>'operation_id')::uuid;
  target_list uuid := (p_original->>'list_id')::uuid;
  target_item uuid := (p_original->>'item_id')::uuid;
  expected bigint := (p_original->>'expected_version')::bigint;
  fingerprint text;
  cancel_hash text;
  original public.item_operations%rowtype;
  prior public.e4_list_operations%rowtype;
  current_item public.shopping_items%rowtype;
  applied boolean := false;
  status text;
  result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
  end if;
  if actor is null or p_cancel is null or original_id is null or p_cancel=original_id
     or target_list is null or target_item is null or expected is null or expected<1
     or jsonb_typeof(p_original) is distinct from 'object'
     or p_original->>'kind' is distinct from 'delete'
     or p_original - array['operation_id','list_id','item_id','expected_version','kind'] <> '{}'::jsonb then
    raise exception 'Invalid delete cancellation' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(actor));
  if not shoppingapp_deletion.account_is_active() or not exists(select 1 from auth.users u where u.id=actor) then
    raise exception 'Account access revoked' using errcode='42501';
  end if;
  -- Same owner/list lock as the account batch and original mutation RPC.
  perform 1 from public.shopping_lists l where l.id=target_list and l.owner_id=actor and l.deleted_at is null for update;
  if not found then raise exception 'List unavailable' using errcode='42501'; end if;
  fingerprint := md5(jsonb_build_array(target_list,'delete'::text,target_item,null::text,null::boolean,expected)::text);
  cancel_hash := md5(jsonb_build_array('cancel-e4-delete-v1',p_original)::text);
  select * into prior from public.e4_list_operations o where o.actor_id=actor and o.operation_id=p_cancel;
  if found then
    if prior.list_id<>target_list or prior.payload_hash<>cancel_hash then
      raise exception 'Cancellation ID payload mismatch';
    end if;
    return prior.result;
  end if;
  if exists(select 1 from public.item_operations o where o.actor_id=actor and o.operation_id=p_cancel)
     or exists(select 1 from public.e4_list_operations o where o.actor_id=actor and o.operation_id=original_id) then
    raise exception 'Operation ID already used';
  end if;
  select * into original from public.item_operations o where o.actor_id=actor and o.operation_id=original_id;
  if found then
    if original.list_id<>target_list or original.payload_hash not in (fingerprint,'cancelled:'||fingerprint) then
      raise exception 'Operation ID payload mismatch';
    end if;
    applied := original.payload_hash=fingerprint;
    if applied and (original.result->>'operation_id' is distinct from original_id::text
      or (original.result->>'item_version')::bigint is distinct from expected+1) then
      raise exception 'Invalid original receipt';
    end if;
  else
    -- A late original request with this operation ID fails the existing
    -- canonical payload check; the marker and cancellation receipt commit together.
    insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
      values(actor,original_id,target_list,'cancelled:'||fingerprint,
        jsonb_build_object('operation_id',original_id,'cancelled',true));
  end if;
  select * into current_item from public.shopping_items i where i.id=target_item and i.list_id=target_list for update;
  status := case when applied or current_item.id is null or current_item.deleted_at is not null then 'superseded' else 'cancelled' end;
  result := jsonb_build_object('operation_id',original_id,'cancellation_id',p_cancel,'list_id',target_list,'item_id',target_item,
    'status',status,'item_version',current_item.version,
    'item',case when current_item.id is null or current_item.deleted_at is not null then null
      else jsonb_build_object('id',current_item.id,'name',current_item.name,'purchased',current_item.purchased,
        'quantity',current_item.quantity,'unit',current_item.unit,'created_at',current_item.created_at) end);
  insert into public.e4_list_operations(actor_id,operation_id,list_id,payload_hash,result)
    values(actor,p_cancel,target_list,cancel_hash,result);
  return result;
end;
$$;
revoke all on function public.cancel_e4_item_delete(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cancel_e4_item_delete(uuid,jsonb) to authenticated;
commit;
