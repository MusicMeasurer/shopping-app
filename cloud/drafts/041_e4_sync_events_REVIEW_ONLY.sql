-- SYNC-EVENTS-1: additive metadata on the existing feed; legacy RPC unchanged.
-- Apply after 039/040. Hosted cron scheduling is separate.
begin;
alter table shoppingapp_internal.account_feed_events add column semantics jsonb;
create index account_feed_semantics_expiry on shoppingapp_internal.account_feed_events(recorded_at) where semantics is not null;

-- Caller holds affected list lock. Restrict to new, actual tombstones of this
-- owner/list. Merge replaces its nested completion/item-delete reasons.
create function shoppingapp_internal.annotate_e4_removals(
 p_actor uuid,p_after bigint,p_list uuid,p_operation uuid,p_reason text,
 p_archive uuid,p_target uuid,p_target_name text,p_item uuid
) returns void language sql set search_path = '' as $$
 update shoppingapp_internal.account_feed_events e
 set semantics = jsonb_strip_nulls(jsonb_build_object(
   'operation_id',p_operation,
   'event_reason',case when e.entity='item' and p_archive is not null and exists(
     select 1 from public.e4_archive_items a where a.completion_id=p_archive and a.source_item_id=e.entity_id
   ) then 'archived' else p_reason end,
   'source_name',case when e.entity='list' then l.name else
     (select i.name from public.shopping_items i where i.id=e.entity_id and i.list_id=p_list) end,
   'target_list_id',p_target,'target_list_name',p_target_name))
 from public.shopping_lists l
 where l.id=p_list and l.owner_id=p_actor and e.account_id=p_actor
   and e.list_id=p_list and e.event_position>p_after and e.deleted
   and (p_item is null or (e.entity='item' and e.entity_id=p_item))
   and (case when e.entity='list' then l.deleted_at is not null else exists(
     select 1 from public.shopping_items i where i.id=e.entity_id and i.list_id=p_list and i.deleted_at is not null) end);
$$;
revoke all on function shoppingapp_internal.annotate_e4_removals(uuid,bigint,uuid,uuid,text,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;

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
 v_feed_after bigint;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
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
 if p_action = 'delete' then
  select coalesce((select event_position from shoppingapp_internal.account_feed_positions where account_id=v_actor),0) into v_feed_after;
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
 if p_action = 'delete' then
  perform shoppingapp_internal.annotate_e4_removals(v_actor,v_feed_after,p_list,p_operation,'deleted',null,null,null,p_item);
 end if;
 return v_result;
end;
$$;

create or replace function public.complete_e4_list(
 p_operation uuid, p_list uuid, p_expected_revision bigint, p_mode text
) returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := auth.uid();
 v_list public.shopping_lists%rowtype;
 v_receipt public.e4_completion_receipts%rowtype;
 v_hash text;
 v_result jsonb;
 v_archive uuid;
 v_count integer;
 v_item record;
 v_rev bigint;
 v_kind text;
 v_feed_after bigint;
begin
 if v_actor is null or p_operation is null or p_list is null or p_expected_revision is null
    or p_expected_revision < 0 or p_mode not in ('marked_only','all_purchased','none_purchased','archive_purchased','delete_list')
    or p_mode is null then
   raise exception 'Invalid completion arguments';
 end if;
 v_hash := md5(pg_catalog.jsonb_build_array(p_list,p_expected_revision,p_mode)::text);
 -- Serialized by actor+operation: replay remains safe even after a oneoff list disappears.
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text || ':' || p_operation::text,0));
 select * into v_receipt from public.e4_completion_receipts
   where owner_id=v_actor and operation_id=p_operation;
 if found then
   if v_receipt.payload_hash <> v_hash or v_receipt.list_id <> p_list then
     raise exception 'Operation ID payload mismatch';
   end if;
   return v_receipt.result;
 end if;
 select * into v_list from public.shopping_lists
   where id=p_list and owner_id=v_actor and deleted_at is null for update;
 if not found then raise exception 'List unavailable'; end if;
 if v_list.revision <> p_expected_revision then
   raise exception 'List revision conflict';
 end if;
 select count(*) into v_count from public.shopping_items
   where list_id=p_list and deleted_at is null and (p_mode <> 'archive_purchased' or purchased);
 if p_mode = 'archive_purchased' and v_count = 0 then raise exception 'No marked purchases'; end if;
 if v_count = 0 and p_mode <> 'delete_list' then raise exception 'Cannot complete an empty list'; end if;
 -- E4 metadata 022 must be installed before this RPC.
 v_kind := v_list.kind;
 if p_mode in ('marked_only','all_purchased','archive_purchased') then
   v_archive := gen_random_uuid();
   insert into public.e4_archive_completions
     (id,owner_id,source_list_id,source_list_name,operation_id)
     values(v_archive,v_actor,p_list,v_list.name,p_operation);
   insert into public.e4_archive_items
     (completion_id,ordinal,source_item_id,name,quantity,unit)
   select v_archive,row_number() over(order by i.created_at,i.id)-1,
          i.id,i.name,i.quantity,i.unit
   from public.shopping_items i
   where i.list_id=p_list and i.deleted_at is null
     and (p_mode='all_purchased' or i.purchased);
   -- 'marked_only' with zero marks creates no archive.
   if not exists (select 1 from public.e4_archive_items where completion_id=v_archive) then
     delete from public.e4_archive_completions where id=v_archive;
     v_archive := null;
   end if;
 end if;
 select coalesce((select event_position from shoppingapp_internal.account_feed_positions where account_id=v_actor),0) into v_feed_after;
 -- Preserve sync continuity: one tombstone per active item and a monotonic revision.
 v_rev := v_list.revision;
 for v_item in
   select id,name,version from public.shopping_items
   where list_id=p_list and deleted_at is null and (p_mode <> 'archive_purchased' or purchased)
   order by created_at,id for update
 loop
   update public.shopping_items
      set deleted_at=now(),version=version+1
      where id=v_item.id;
   v_rev := v_rev+1;
   insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
     values(p_list,v_rev,v_item.id,'delete',
            pg_catalog.jsonb_build_object('id',v_item.id,'name',v_item.name,
              'deleted_at',now(),'version',v_item.version+1));
 end loop;
 if p_mode = 'delete_list' and v_count = 0 then
   v_rev := v_rev + 1;
 end if;
 update public.shopping_lists
   set revision=v_rev,
       deleted_at=case when (v_kind='oneoff' and p_mode <> 'archive_purchased') or p_mode='delete_list' then now() else deleted_at end
   where id=p_list;
 v_result := pg_catalog.jsonb_build_object(
   'operation_id',p_operation,'list_id',p_list,'archive_id',v_archive,
   'mode',p_mode,'revision',v_rev,'item_count',v_count,'kind',v_kind);
 insert into public.e4_completion_receipts(owner_id,operation_id,list_id,payload_hash,result)
 values(v_actor,p_operation,p_list,v_hash,v_result);
 perform shoppingapp_internal.annotate_e4_removals(v_actor,v_feed_after,p_list,p_operation,
   case when p_mode='delete_list' then 'deleted' else 'completed' end,v_archive,null,null,null);
 return v_result;
end;
$$;

create or replace function public.merge_e4_personal_lists(
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
  feed_after bigint;
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

  select coalesce((select event_position from shoppingapp_internal.account_feed_positions where account_id=actor),0) into feed_after;
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
  perform shoppingapp_internal.annotate_e4_removals(actor,feed_after,p_source,p_operation,'merged',null,p_target,target_list.name,null);
  perform shoppingapp_internal.annotate_e4_removals(actor,feed_after,p_target,p_operation,'merged',null,p_target,target_list.name,null);
  return receipt;
end;
$$;

-- Stable upper bound for multi-page pulls; legacy RPC unchanged.
-- head and page share one statement snapshot. Current ownership controls
-- snapshots and semantic names, including after a transfer.
-- Earlier snapshots may be masked by a later removal: only explicit
-- semantics are evidence of the cause; head indicates newer events.
create function public.pull_e4_account_changes_v2(
 p_account uuid,p_after bigint,p_limit integer default 200,p_through bigint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 actor uuid := auth.uid();
 result jsonb;
 head_position bigint;
 first_position bigint;
 bound bigint;
begin
 if actor is null or p_account is distinct from actor then
  raise exception 'Account session mismatch' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(actor));
 if not shoppingapp_deletion.account_is_active() or not exists(select 1 from auth.users where id=actor) then
  raise exception 'Account access revoked' using errcode='42501';
 end if;
 if p_after is null or p_after<0 or p_limit is null or p_limit not between 1 and 500
   or (p_through is not null and p_through<p_after) then
  raise exception 'Invalid cursor or page size' using errcode='22023';
 end if;
 with bounds as materialized (
   select coalesce((select event_position from shoppingapp_internal.account_feed_positions where account_id=actor),0) as head,
          (select min(event_position) from shoppingapp_internal.account_feed_events where account_id=actor) as first_pos
 ), page as (
   select e.event_position,
     jsonb_strip_nulls(jsonb_build_object(
       'event_position',e.event_position::text,'entity',e.entity,'list_id',e.list_id,'entity_id',e.entity_id,
       'deleted',e.deleted or l.id is null or l.deleted_at is not null or l.owner_id<>actor,
       'semantics',case when e.deleted and e.recorded_at>statement_timestamp()-interval '7 days'
          and l.owner_id=actor and (e.semantics->>'target_list_id' is null or t.owner_id=actor)
          then case when t.id is not null then e.semantics || jsonb_build_object('target_list_name',t.name) else e.semantics end end
     )) || jsonb_build_object('snapshot',case when l.owner_id=actor and l.deleted_at is null then e.snapshot end) as entry
   from shoppingapp_internal.account_feed_events e cross join bounds b
   left join public.shopping_lists l on l.id=e.list_id
   left join public.shopping_lists t on t.id=(e.semantics->>'target_list_id')::uuid
   where e.account_id=actor and e.event_position>p_after and e.event_position<=coalesce(p_through,b.head)
   order by e.event_position limit p_limit
 )
 select b.head,b.first_pos,coalesce(p_through,b.head),
   jsonb_build_object('head',b.head::text,'through',coalesce(p_through,b.head)::text,
     'events',coalesce((select jsonb_agg(entry order by event_position) from page),'[]'::jsonb))
 into head_position,first_position,bound,result from bounds b;
 if p_after>head_position or p_after<coalesce(first_position,head_position+1)-1 or bound>head_position then
  raise exception 'Account feed cursor expired' using errcode='P0002';
 end if;
 return result;
end;
$$;
revoke all on function public.pull_e4_account_changes_v2(uuid,bigint,integer,bigint) from public,anon,authenticated,service_role;
grant execute on function public.pull_e4_account_changes_v2(uuid,bigint,integer,bigint) to authenticated;

create function shoppingapp_internal.expire_e4_feed_semantics() returns bigint
language plpgsql set search_path = '' as $$
declare n bigint;
begin
 update shoppingapp_internal.account_feed_events set semantics=null
 where semantics is not null and recorded_at<=statement_timestamp()-interval '7 days';
 get diagnostics n=row_count;
 return n;
end;
$$;
revoke all on function shoppingapp_internal.expire_e4_feed_semantics() from public,anon,authenticated,service_role;
commit;
