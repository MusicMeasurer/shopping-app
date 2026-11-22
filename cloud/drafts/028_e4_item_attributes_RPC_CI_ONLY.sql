-- Versioned item attributes. The existing RPC remains available for older clients and receipts.
create function public.apply_e4_item_change(
 p_operation uuid, p_list uuid, p_action text, p_item uuid,
 p_name text, p_purchased boolean, p_expected_version bigint,
 p_quantity numeric, p_unit text
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
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
 if v_actor is null or p_operation is null or p_list is null or p_item is null then
  raise exception 'Invalid actor or identifiers';
 end if;
 if p_action is null or p_action not in ('add','update') then
  raise exception 'Unsupported action';
 end if;
 if p_quantity is not null and (not (p_quantity > 0 and p_quantity < 1000000000)
    or p_quantity <> round(p_quantity,3)) then
  raise exception 'Invalid item quantity';
 end if;
 if p_unit is not null and length(btrim(p_unit)) not between 1 and 30 then
  raise exception 'Invalid item unit';
 end if;
 -- Lock the list before reading membership or mutating its items.
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;
 -- A canonical text payload avoids relying on client-provided hashes.
 v_hash := md5(jsonb_build_array('e4-attributes',p_list,p_action,p_item,p_name,p_purchased,p_expected_version,p_quantity,btrim(p_unit))::text);
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
  insert into public.shopping_items(id,list_id,name,purchased,quantity,unit)
   values(p_item,p_list,trim(p_name),coalesce(p_purchased,false),p_quantity,btrim(p_unit))
   returning * into v_item;
 else
  select * into v_item from public.shopping_items
   where id = p_item and list_id = p_list and deleted_at is null for update;
  if not found then raise exception 'Item unavailable'; end if;
  if p_expected_version is null or p_expected_version <> v_item.version then
   raise exception 'Version conflict';
  end if;
  if p_name is not null and length(trim(p_name)) not between 1 and 120 then
   raise exception 'Invalid name';
  end if;
  update public.shopping_items
   set name = coalesce(trim(p_name),name),
       purchased = coalesce(p_purchased,purchased),
       quantity = p_quantity,
       unit = btrim(p_unit),
       version = version + 1
   where id = p_item returning * into v_item;
 end if;
 update public.shopping_lists set revision = revision + 1
  where id = p_list returning revision into v_revision;
 insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
  values(p_list,v_revision,p_item,p_action,
   jsonb_build_object('id',v_item.id,'name',v_item.name,
    'purchased',v_item.purchased,'version',v_item.version,
    'quantity',v_item.quantity,'unit',v_item.unit,
    'deleted',v_item.deleted_at is not null));
 v_result := jsonb_build_object('operation_id',p_operation,
  'list_revision',v_revision,'item_version',v_item.version);
 insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
  values(v_actor,p_operation,p_list,v_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.apply_e4_item_change(uuid,uuid,text,uuid,text,boolean,bigint,numeric,text) from public, anon;
grant execute on function public.apply_e4_item_change(uuid,uuid,text,uuid,text,boolean,bigint,numeric,text) to authenticated;

create table if not exists public.e4_list_operations (
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id, operation_id)
);
alter table public.e4_list_operations enable row level security;
revoke all on public.e4_list_operations from public, anon, authenticated;
revoke update on public.shopping_lists from anon, authenticated;

create or replace function public.apply_e4_list_metadata(
  p_operation uuid,
  p_list uuid,
  p_expected_revision bigint,
  p_name text default null,
  p_kind text default null,
  p_position bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text;
  v_prior public.e4_list_operations%rowtype;
  v_list public.shopping_lists%rowtype;
  v_result jsonb;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if v_actor is null or p_operation is null or p_list is null or
     p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid actor, operation, list or revision';
  end if;
  if p_name is null and p_kind is null and p_position is null then
    raise exception 'Empty metadata mutation';
  end if;
  if p_name is not null and length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid list name';
  end if;
  if p_kind is not null and p_kind not in ('permanent', 'oneoff') then
    raise exception 'Invalid list kind';
  end if;
  if p_position is not null and p_position < 0 then
    raise exception 'Invalid list position';
  end if;

  -- Serialize metadata edits that can move more than one list for this owner.
  perform pg_advisory_xact_lock(hashtextextended('e4-list-order:' || v_actor::text,0));

  -- Lock before checking owner, idempotency, or revision. Do not expose
  -- whether a foreign list exists via different error paths.
  select * into v_list from public.shopping_lists
    where id = p_list and owner_id = v_actor and deleted_at is null
    for update;
  if not found then raise exception 'List unavailable'; end if;

  v_hash := md5(pg_catalog.jsonb_build_array(
    p_list, p_expected_revision, p_name, p_kind, p_position)::text);
  select * into v_prior from public.e4_list_operations
    where actor_id = v_actor and operation_id = p_operation;
  if found then
    if v_prior.payload_hash <> v_hash or v_prior.list_id <> p_list then
      raise exception 'Operation ID payload mismatch';
    end if;
    return v_prior.result;
  end if;
  if v_list.revision <> p_expected_revision then
    raise exception 'List revision conflict';
  end if;

  if p_position < v_list.position then
    update public.shopping_lists set position = position + 1, revision = revision + 1
      where owner_id = v_actor and deleted_at is null and id <> p_list
        and position >= p_position and position < v_list.position;
  elsif p_position > v_list.position then
    update public.shopping_lists set position = position - 1, revision = revision + 1
      where owner_id = v_actor and deleted_at is null and id <> p_list
        and position > v_list.position and position <= p_position;
  end if;

  update public.shopping_lists
    set name = coalesce(trim(p_name), name),
        kind = coalesce(p_kind, kind),
        position = coalesce(p_position, position),
        revision = revision + 1
    where id = p_list and owner_id = v_actor and deleted_at is null
    returning * into v_list;
  if not found then raise exception 'List unavailable'; end if;

  v_result := pg_catalog.jsonb_build_object(
    'operation_id', p_operation, 'list_id', p_list,
    'revision', v_list.revision, 'name', v_list.name,
    'kind', v_list.kind, 'position', v_list.position);
  insert into public.e4_list_operations(actor_id,operation_id,list_id,payload_hash,result)
    values(v_actor,p_operation,p_list,v_hash,v_result);
  return v_result;
end;
$$;

revoke all on function public.apply_e4_list_metadata(uuid,uuid,bigint,text,text,bigint)
  from public, anon;
grant execute on function public.apply_e4_list_metadata(uuid,uuid,bigint,text,text,bigint)
  to authenticated;
