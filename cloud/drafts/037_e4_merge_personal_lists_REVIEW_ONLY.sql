begin;

-- The preview is one MVCC snapshot. Revisions are rechecked under both list locks.
create function public.preview_e4_list_merge(p_source uuid, p_target uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'source', jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'revision', s.revision),
    'target', jsonb_build_object('id', t.id, 'name', t.name, 'kind', t.kind, 'revision', t.revision),
    'items', coalesce((select jsonb_agg(
      jsonb_build_object('id', i.id, 'list_id', i.list_id, 'name', i.name, 'purchased', i.purchased,
        'quantity', i.quantity, 'unit', i.unit, 'created_at', i.created_at) order by i.created_at, i.id)
      from public.shopping_items i
      where i.list_id in (s.id, t.id) and i.deleted_at is null), '[]'::jsonb))
  from public.shopping_lists s, public.shopping_lists t
  where s.id = p_source and t.id = p_target and s.id <> t.id
    and s.owner_id = auth.uid() and t.owner_id = auth.uid()
    and s.deleted_at is null and t.deleted_at is null
    and not exists (select 1 from public.list_members m where m.list_id in (s.id, t.id) and m.user_id <> auth.uid());
$$;

create function public.merge_e4_personal_lists(
  p_operation uuid, p_source uuid, p_target uuid,
  p_source_revision bigint, p_target_revision bigint, p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  source_list public.shopping_lists%rowtype;
  target_list public.shopping_lists%rowtype;
  prior public.e4_list_operations%rowtype;
  fingerprint text;
  receipt jsonb;
  entry record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Operation requires READ COMMITTED isolation' using errcode = '0A000';
  end if;
  if actor is null or p_operation is null or p_source is null or p_target is null or p_source = p_target
      or p_source_revision is null or p_target_revision is null
      or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Invalid merge arguments' using errcode = '22023';
  end if;
  fingerprint := md5(jsonb_build_array('personal-list-merge', p_source, p_target, p_source_revision, p_target_revision, p_items)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor::text || ':' || p_operation::text, 0));
  select * into prior from public.e4_list_operations where actor_id = actor and operation_id = p_operation;
  if found then
    if prior.payload_hash <> fingerprint then raise exception 'Operation ID payload mismatch'; end if;
    return prior.result;
  end if;

  perform l.id from public.shopping_lists l
    where l.id in (p_source, p_target) and l.owner_id = actor order by l.id for update;
  select * into source_list from public.shopping_lists where id = p_source and owner_id = actor and deleted_at is null;
  select * into target_list from public.shopping_lists where id = p_target and owner_id = actor and deleted_at is null;
  if source_list.id is null or target_list.id is null
      or exists (select 1 from public.list_members where list_id in (p_source, p_target) and user_id <> actor) then
    raise exception 'Personal list unavailable' using errcode = '42501';
  end if;
  if source_list.revision <> p_source_revision or target_list.revision <> p_target_revision then
    raise exception 'List merge revision conflict' using errcode = '40001';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(id uuid, name text, purchased boolean, quantity numeric, unit text)
    left join public.shopping_items i on i.id = x.id and i.list_id in (p_source, p_target) and i.deleted_at is null
    where i.id is null or x.purchased is null or x.name is null or length(btrim(x.name)) not between 1 and 120
      or public.e4_item_name_key(x.name) = ''
      or (i.list_id = p_target and x.name <> i.name)
      or (x.quantity is not null and (not (x.quantity > 0 and x.quantity < 1000000000) or x.quantity <> round(x.quantity, 3)))
      or (x.unit is not null and length(btrim(x.unit)) not between 1 and 30)
  ) or exists (
    select 1 from jsonb_to_recordset(p_items) as x(id uuid, name text)
    group by public.e4_item_name_key(x.name) having count(*) > 1
  ) or exists (
    select 1 from jsonb_to_recordset(p_items) as x(id uuid)
    group by x.id having count(*) > 1
  ) or exists (
    select 1 from public.shopping_items i
    where i.list_id in (p_source, p_target) and i.deleted_at is null
      and not exists (
        select 1 from jsonb_to_recordset(p_items) as x(name text)
        where public.e4_item_name_key(x.name) = public.e4_item_name_key(i.name)
      )
  ) then
    raise exception 'Invalid list merge result' using errcode = '22023';
  end if;

  for entry in
    select i.id, i.version from public.shopping_items i
    where i.list_id = p_target and i.deleted_at is null
      and not exists (select 1 from jsonb_to_recordset(p_items) as x(id uuid) where x.id = i.id)
  loop
    perform public.apply_item_change(gen_random_uuid(), p_target, 'delete', entry.id, null, null, entry.version);
  end loop;
  for entry in
    select i.list_id, i.created_at, i.version, x.* from jsonb_to_recordset(p_items)
      as x(id uuid, name text, purchased boolean, quantity numeric, unit text)
    join public.shopping_items i on i.id = x.id
    where i.list_id = p_source or (i.purchased, i.quantity, i.unit) is distinct from (x.purchased, x.quantity, x.unit)
    order by i.created_at, i.id
  loop
    if entry.list_id = p_source then
      -- A moved item gets a new destination ID. The old ID remains a source tombstone for offline devices.
      perform public.add_e4_ordered_item(gen_random_uuid(), p_target, gen_random_uuid(), entry.name,
        entry.purchased, entry.quantity, entry.unit, entry.created_at);
    else
      perform public.apply_e4_item_change(gen_random_uuid(), p_target, 'update', entry.id, entry.name,
        entry.purchased, entry.version, entry.quantity, entry.unit);
    end if;
  end loop;
  perform public.complete_e4_list(gen_random_uuid(), p_source, p_source_revision, 'delete_list');
  receipt := jsonb_build_object('operation_id', p_operation, 'source_id', p_source, 'target_id', p_target);
  insert into public.e4_list_operations(actor_id, operation_id, list_id, payload_hash, result)
    values(actor, p_operation, p_target, fingerprint, receipt);
  return receipt;
end;
$$;

revoke all on function public.preview_e4_list_merge(uuid,uuid) from public, anon, authenticated;
revoke all on function public.merge_e4_personal_lists(uuid,uuid,uuid,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.preview_e4_list_merge(uuid,uuid) to authenticated;
grant execute on function public.merge_e4_personal_lists(uuid,uuid,uuid,bigint,bigint,jsonb) to authenticated;

commit;
