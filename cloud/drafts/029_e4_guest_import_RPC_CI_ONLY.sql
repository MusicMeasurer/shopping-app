-- Atomic first import of a device profile. All cloud IDs are server-generated.
create table public.e4_guest_imports (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  fingerprint text not null,
  result jsonb not null,
  primary key(owner_id, operation_id)
);
alter table public.e4_guest_imports enable row level security;
revoke all on public.e4_guest_imports from public, anon, authenticated;

create function public.import_e4_guest_profile(p_operation uuid, p_account uuid, p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  fingerprint text := md5(p_snapshot::text);
  prior public.e4_guest_imports%rowtype;
  entry jsonb;
  item jsonb;
  ids jsonb := '{}'::jsonb;
  list_key text;
  remote_id uuid;
  archive_id uuid;
  position_offset bigint;
  ordinal bigint;
  result jsonb;
begin
  if actor is null or actor is distinct from p_account or p_operation is null or
     jsonb_typeof(p_snapshot->'lists') is distinct from 'array' or
     jsonb_typeof(p_snapshot->'items') is distinct from 'array' or
     jsonb_typeof(p_snapshot->'archives') is distinct from 'array' then
    raise exception 'Invalid guest import';
  end if;
  perform 1 from auth.users where id=actor for update;
  if not found then raise exception 'Account unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended('e4-list-order:' || actor::text,0));
  select * into prior from public.e4_guest_imports where owner_id=actor and operation_id=p_operation;
  if found then
    if prior.fingerprint <> fingerprint then raise exception 'Guest import payload changed'; end if;
    return prior.result;
  end if;
  select coalesce(max(position),-1)+1 into position_offset
    from public.shopping_lists where owner_id=actor and deleted_at is null;
  for entry in select value from jsonb_array_elements(p_snapshot->'lists') order by coalesce((value->>'position')::bigint,0), value->>'id'
  loop
    list_key := entry->>'id';
    if coalesce(list_key,'') = '' or ids ? list_key then raise exception 'Invalid source list'; end if;
    insert into public.shopping_lists(owner_id,name,kind,position)
      values(actor,entry->>'name',entry->>'kind',position_offset) returning id into remote_id;
    ids := ids || jsonb_build_object(list_key,remote_id);
    position_offset := position_offset + 1;
  end loop;
  for item in select value from jsonb_array_elements(p_snapshot->'items')
  loop
    remote_id := (ids->>(item->>'listId'))::uuid;
    if remote_id is null then raise exception 'Guest item has no list'; end if;
    insert into public.shopping_items(list_id,name,purchased,quantity,unit,created_at)
      values(remote_id,item->>'name',(item->>'purchased')::boolean,(item->>'quantity')::numeric,
        item->>'unit',to_timestamp((item->>'createdAt')::double precision / 1000));
  end loop;
  for entry in select value from jsonb_array_elements(p_snapshot->'archives')
  loop
    list_key := entry->>'sourceListId';
    remote_id := (ids->>list_key)::uuid;
    if remote_id is null then
      remote_id := gen_random_uuid();
      ids := ids || jsonb_build_object(list_key,remote_id);
    end if;
    insert into public.e4_archive_completions(owner_id,source_list_id,source_list_name,operation_id,completed_at)
      values(actor,remote_id,entry->>'name',gen_random_uuid(),
        to_timestamp((entry->>'completedAt')::double precision / 1000)) returning id into archive_id;
    ordinal := 0;
    for item in select value from jsonb_array_elements(entry->'items')
    loop
      insert into public.e4_archive_items(completion_id,ordinal,name,quantity,unit)
        values(archive_id,ordinal,item->>'name',(item->>'quantity')::numeric,item->>'unit');
      ordinal := ordinal + 1;
    end loop;
  end loop;
  result := jsonb_build_object('lists',ids);
  insert into public.e4_guest_imports values(actor,p_operation,fingerprint,result);
  return result;
end;
$$;
revoke all on function public.import_e4_guest_profile(uuid,uuid,jsonb) from public,anon;
grant execute on function public.import_e4_guest_profile(uuid,uuid,jsonb) to authenticated;
