-- Store the actual entry order of new batches without changing legacy RPC payloads.
create function public.add_e4_ordered_item(
  p_operation uuid, p_list uuid, p_item uuid, p_name text, p_purchased boolean,
  p_quantity numeric, p_unit text, p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  fingerprint text;
  prior public.e4_list_operations%rowtype;
  receipt jsonb;
  inserted public.shopping_items%rowtype;
  new_revision bigint;
  legacy_hash text;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if actor is null or p_operation is null or p_list is null or p_item is null
      or p_created_at is null or not isfinite(p_created_at) then
    raise exception 'Invalid ordered item payload';
  end if;

  perform 1 from public.shopping_lists where id = p_list and deleted_at is null for update;
  if not found or not public.can_access_list(p_list) then raise exception 'List unavailable'; end if;

  fingerprint := md5(jsonb_build_array('ordered-add', p_list, p_item, p_name, p_purchased,
    p_quantity, btrim(p_unit), extract(epoch from p_created_at))::text);
  select * into prior from public.e4_list_operations where actor_id = actor and operation_id = p_operation;
  if found then
    if prior.payload_hash <> fingerprint then raise exception 'Operation ID payload mismatch'; end if;
    return prior.result;
  end if;

  -- Keep the original receipt format so an older deployed backend and an
  -- upgraded backend can acknowledge the same queued request.
  if exists(select 1 from public.item_operations where actor_id = actor and operation_id = p_operation) then
    receipt := public.apply_e4_item_change(p_operation, p_list, 'add', p_item, p_name, p_purchased,
      null, p_quantity, p_unit);
  else
    if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Invalid name'; end if;
    if p_quantity is not null and (not (p_quantity > 0 and p_quantity < 1000000000)
      or p_quantity <> round(p_quantity, 3)) then raise exception 'Invalid item quantity'; end if;
    if p_unit is not null and length(btrim(p_unit)) not between 1 and 30 then raise exception 'Invalid item unit'; end if;

    insert into public.shopping_items(id, list_id, name, purchased, quantity, unit, created_at)
      values(p_item, p_list, trim(p_name), coalesce(p_purchased, false), p_quantity, btrim(p_unit), p_created_at)
      returning * into inserted;
    update public.shopping_lists set revision = shopping_lists.revision + 1
      where id = p_list returning shopping_lists.revision into new_revision;
    insert into public.list_changes(list_id, revision, item_id, kind, snapshot)
      values(p_list, new_revision, p_item, 'add', jsonb_build_object('id', inserted.id, 'name', inserted.name,
        'purchased', inserted.purchased, 'version', inserted.version, 'quantity', inserted.quantity,
        'unit', inserted.unit, 'deleted', false));
    receipt := jsonb_build_object('operation_id', p_operation, 'list_revision', new_revision, 'item_version', inserted.version);
    legacy_hash := md5(jsonb_build_array('e4-attributes', p_list, 'add', p_item, p_name, p_purchased,
      null::bigint, p_quantity, btrim(p_unit))::text);
    insert into public.item_operations(actor_id, operation_id, list_id, payload_hash, result)
      values(actor, p_operation, p_list, legacy_hash, receipt);
  end if;
  insert into public.e4_list_operations(actor_id, operation_id, list_id, payload_hash, result)
    values(actor, p_operation, p_list, fingerprint, receipt);
  return receipt;
end;
$$;

create function public.e4_item_name_key(p_name text) returns text
language sql immutable strict set search_path = ''
return lower(btrim(regexp_replace(p_name,
  U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')));

-- Concurrent creations can coexist until reviewed. Resolving a pair checks both
-- versions under the list lock so opposite decisions cannot delete both items.
create function public.resolve_e4_item_name_conflict(
  p_operation uuid, p_list uuid, p_keep uuid, p_keep_version bigint,
  p_change uuid, p_change_version bigint, p_name text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  keep_item public.shopping_items%rowtype;
  change_item public.shopping_items%rowtype;
  prior public.e4_list_operations%rowtype;
  fingerprint text;
  receipt jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if actor is null or p_operation is null or p_list is null or p_keep is null or p_change is null
      or p_keep = p_change or p_keep_version is null or p_change_version is null then
    raise exception 'Invalid name conflict resolution';
  end if;

  perform 1 from public.shopping_lists where id = p_list and deleted_at is null for update;
  if not found or not public.can_access_list(p_list) then raise exception 'List unavailable'; end if;

  fingerprint := md5(jsonb_build_array('name-resolution', p_list, p_keep, p_keep_version,
    p_change, p_change_version, p_name)::text);
  select * into prior from public.e4_list_operations where actor_id = actor and operation_id = p_operation;
  if found then
    if prior.payload_hash <> fingerprint then raise exception 'Operation ID payload mismatch'; end if;
    return prior.result;
  end if;

  select * into keep_item from public.shopping_items where list_id = p_list and id = p_keep and deleted_at is null;
  select * into change_item from public.shopping_items where list_id = p_list and id = p_change and deleted_at is null;
  if keep_item.version is distinct from p_keep_version or change_item.version is distinct from p_change_version
      or public.e4_item_name_key(keep_item.name) <> public.e4_item_name_key(change_item.name) then
    raise exception 'Name conflict changed';
  end if;

  if p_name is null then
    receipt := public.apply_item_change(p_operation, p_list, 'delete', p_change, null, null, p_change_version);
  else
    if public.e4_item_name_key(p_name) = '' or exists (
      select 1 from public.shopping_items where list_id = p_list and id <> p_change and deleted_at is null
        and public.e4_item_name_key(name) = public.e4_item_name_key(p_name)
    ) then raise exception 'Item name already exists'; end if;
    receipt := public.apply_item_change(p_operation, p_list, 'update', p_change, p_name, null, p_change_version);
  end if;
  insert into public.e4_list_operations(actor_id, operation_id, list_id, payload_hash, result)
    values(actor, p_operation, p_list, fingerprint, receipt);
  return receipt;
end;
$$;

revoke all on function public.e4_item_name_key(text) from public, anon, authenticated;
revoke all on function public.add_e4_ordered_item(uuid,uuid,uuid,text,boolean,numeric,text,timestamptz) from public, anon;
revoke all on function public.resolve_e4_item_name_conflict(uuid,uuid,uuid,bigint,uuid,bigint,text) from public, anon;
grant execute on function public.add_e4_ordered_item(uuid,uuid,uuid,text,boolean,numeric,text,timestamptz) to authenticated;
grant execute on function public.resolve_e4_item_name_conflict(uuid,uuid,uuid,bigint,uuid,bigint,text) to authenticated;
