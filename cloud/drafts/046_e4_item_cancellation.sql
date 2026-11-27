-- SYNC-UI item cancellation. Additive, review and test before applying to lab.
-- Reuse the existing item receipt ledger and list lock, including the legacy
-- and ordered-add entry points. No new public tables or direct write grants.
begin;
create function public.cancel_e4_item_edit(p_cancel uuid, p_original jsonb, p_before jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  original_id uuid := (p_original->>'operation_id')::uuid;
  list_id uuid := (p_original->>'list_id')::uuid;
  item_id uuid := (p_original->>'item_id')::uuid;
  kind text := p_original->>'kind';
  original_name text := p_original->>'name';
  original_purchased boolean := (p_original->>'purchased')::boolean;
  expected bigint := (p_original->>'expected_version')::bigint;
  qty numeric := (p_original->>'quantity')::numeric;
  unit_text text := btrim(p_original->>'unit');
  created timestamptz := (p_original->>'created_at')::timestamptz;
  attributes boolean := p_original ? 'quantity' or p_original ? 'unit' or created is not null;
  fingerprint text;
  ordered_hash text;
  cancel_hash text;
  original public.item_operations%rowtype;
  ordered public.e4_list_operations%rowtype;
  prior public.e4_list_operations%rowtype;
  current_item public.shopping_items%rowtype;
  applied_version bigint;
  status text;
  result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if actor is null or p_cancel is null or original_id is null or p_cancel=original_id
     or list_id is null or item_id is null or kind is null or kind not in ('add','update')
     or original_name is null or length(btrim(original_name)) not between 1 and 120
     or original_purchased is null or jsonb_typeof(p_original) is distinct from 'object'
     or (kind='add' and (expected is not null or p_before is not null))
     or (kind='update' and (expected is null or expected<1 or created is not null
          or jsonb_typeof(p_before) is distinct from 'object'
          or p_before->>'name' is null or length(btrim(p_before->>'name')) not between 1 and 120
          or jsonb_typeof(p_before->'purchased') is distinct from 'boolean'))
     or (created is not null and not isfinite(created)) then
    raise exception 'Invalid item cancellation' using errcode='22023';
  end if;
  -- Same account deletion gate and lock order as the Data API. Also check
  -- directly for a removed account, not only in the PostgREST pre-request hook.
  perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(actor));
  if not shoppingapp_deletion.account_is_active() or not exists(select 1 from auth.users u where u.id=actor) then
    raise exception 'Account access revoked' using errcode='42501';
  end if;
  -- All three original write RPCs take this exact lock before checking receipts.
  -- Owner-only matches the current personal-list account batch contract.
  perform 1 from public.shopping_lists l where l.id=list_id and l.owner_id=actor and l.deleted_at is null for update;
  if not found then raise exception 'List unavailable' using errcode='42501'; end if;

  fingerprint := case when attributes then md5(jsonb_build_array('e4-attributes',list_id,kind,item_id,
    original_name,original_purchased,expected,qty,unit_text)::text)
    else md5(jsonb_build_array(list_id,kind,item_id,original_name,original_purchased,expected)::text) end;
  if created is not null then
    ordered_hash := md5(jsonb_build_array('ordered-add',list_id,item_id,original_name,original_purchased,
      qty,unit_text,extract(epoch from created))::text);
  end if;
  cancel_hash := md5(jsonb_build_array('cancel-e4-item-v1',p_original,p_before)::text);
  select * into prior from public.e4_list_operations o where o.actor_id=actor and o.operation_id=p_cancel;
  if found then
    if prior.list_id<>list_id or prior.payload_hash<>cancel_hash then
      raise exception 'Cancellation ID payload mismatch';
    end if;
    return prior.result;
  end if;
  if exists(select 1 from public.item_operations o where o.actor_id=actor and o.operation_id=p_cancel) then
    raise exception 'Cancellation ID already used';
  end if;
  select * into ordered from public.e4_list_operations o where o.actor_id=actor and o.operation_id=original_id;
  if found and (ordered_hash is null or ordered.payload_hash<>ordered_hash or ordered.list_id<>list_id) then
    raise exception 'Operation ID payload mismatch';
  end if;
  select * into original from public.item_operations o where o.actor_id=actor and o.operation_id=original_id;
  if found then
    if original.list_id<>list_id or original.payload_hash not in (fingerprint,'cancelled:'||fingerprint) then
      raise exception 'Operation ID payload mismatch';
    end if;
    if original.payload_hash=fingerprint then
      applied_version := (original.result->>'item_version')::bigint;
      if applied_version is null or applied_version<1
        or original.result->>'operation_id' is distinct from original_id::text then
        raise exception 'Invalid original receipt';
      end if;
    elsif ordered.operation_id is not null then
      raise exception 'Inconsistent ordered receipt';
    end if;
  else
    if ordered.operation_id is not null then raise exception 'Missing original receipt'; end if;
    -- The deliberately non-matching fingerprint fences all legacy/attribute/
    -- ordered add entry points. Ordered add sees this row and invokes the
    -- existing attribute RPC, which rejects the mismatched fingerprint.
    insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
      values(actor,original_id,list_id,'cancelled:'||fingerprint,
        jsonb_build_object('operation_id',original_id,'cancelled',true));
  end if;

  select * into current_item from public.shopping_items i where i.id=item_id and i.list_id=list_id for update;
  if applied_version is null then
    status := 'cancelled';
  elsif current_item.id is null or current_item.deleted_at is not null or current_item.version<>applied_version then
    -- Do not overwrite or resurrect a newer change from another installation.
    status := 'superseded';
  else
    if kind='add' then
      perform public.apply_item_change(p_cancel,list_id,'delete',item_id,null,null,applied_version);
    elsif attributes then
      perform public.apply_e4_item_change(p_cancel,list_id,'update',item_id,p_before->>'name',
        (p_before->>'purchased')::boolean,applied_version,(p_before->>'quantity')::numeric,p_before->>'unit');
    else
      perform public.apply_item_change(p_cancel,list_id,'update',item_id,p_before->>'name',
        (p_before->>'purchased')::boolean,applied_version);
    end if;
    status := 'cancelled';
    select * into current_item from public.shopping_items i where i.id=item_id and i.list_id=list_id;
  end if;

  result := jsonb_build_object('operation_id',original_id,'cancellation_id',p_cancel,'list_id',list_id,'item_id',item_id,
    'status',status,'item_version',current_item.version,
    'item',case when current_item.id is null or current_item.deleted_at is not null then null
      else jsonb_build_object('id',current_item.id,'name',current_item.name,'purchased',current_item.purchased,
        'quantity',current_item.quantity,'unit',current_item.unit,'created_at',current_item.created_at) end);
  insert into public.e4_list_operations(actor_id,operation_id,list_id,payload_hash,result)
    values(actor,p_cancel,list_id,cancel_hash,result);
  return result;
end;
$$;
revoke all on function public.cancel_e4_item_edit(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.cancel_e4_item_edit(uuid,jsonb,jsonb) to authenticated;
commit;
