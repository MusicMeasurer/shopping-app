-- E4 completion transaction. CI candidate; do not deploy before hosted A/B and client integration.
create table public.e4_completion_receipts (
 owner_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 list_id uuid not null,
 payload_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(owner_id,operation_id)
);
alter table public.e4_completion_receipts enable row level security;
revoke all on public.e4_completion_receipts from public,anon,authenticated;

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
begin
 if v_actor is null or p_operation is null or p_list is null or p_expected_revision is null
    or p_expected_revision < 0 or p_mode not in ('marked_only','all_purchased','none_purchased')
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
   where list_id=p_list and deleted_at is null;
 if v_count = 0 then raise exception 'Cannot complete an empty list'; end if;
 -- E4 metadata 022 must be installed before this RPC.
 v_kind := v_list.kind;
 if p_mode <> 'none_purchased' then
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
 -- Preserve sync continuity: one tombstone per active item and a monotonic revision.
 v_rev := v_list.revision;
 for v_item in
   select id,name,version from public.shopping_items
   where list_id=p_list and deleted_at is null order by created_at,id for update
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
 update public.shopping_lists
   set revision=v_rev,
       deleted_at=case when v_kind='oneoff' then now() else deleted_at end
   where id=p_list;
 v_result := pg_catalog.jsonb_build_object(
   'operation_id',p_operation,'list_id',p_list,'archive_id',v_archive,
   'mode',p_mode,'revision',v_rev,'item_count',v_count,'kind',v_kind);
 insert into public.e4_completion_receipts(owner_id,operation_id,list_id,payload_hash,result)
 values(v_actor,p_operation,p_list,v_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.complete_e4_list(uuid,uuid,bigint,text) from public,anon;
grant execute on function public.complete_e4_list(uuid,uuid,bigint,text) to authenticated;
