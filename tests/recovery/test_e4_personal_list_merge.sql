\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values
 ('a0000000-0000-4000-8000-000000000001'), ('a0000000-0000-4000-8000-000000000002');
insert into public.shopping_lists(id,owner_id,name,kind) values
 ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','Week','oneoff'),
 ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','Groceries','permanent'),
 ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000002','Private','permanent');
insert into public.shopping_items(id,list_id,name,purchased,quantity,unit,created_at) values
 ('c0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','Молоко',true,1,'л','2026-11-10T00:00Z'),
 ('c0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','Молоко',false,2,'л','2026-11-10T00:01Z'),
 ('c0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000002','Яйца',false,null,null,'2026-11-10T00:02Z');
insert into public.e4_archive_completions(id,owner_id,source_list_id,source_list_name,operation_id) values
 ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000001','Week','e0000000-0000-4000-8000-000000000001');
insert into public.e4_archive_items(completion_id,ordinal,name) values
 ('d0000000-0000-4000-8000-000000000001',0,'Earlier purchase');
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-4000-8000-000000000001',true);
do $$
declare
 source uuid := 'b0000000-0000-4000-8000-000000000001';
 target uuid := 'b0000000-0000-4000-8000-000000000002';
 foreign_list uuid := 'b0000000-0000-4000-8000-000000000003';
 op uuid := 'e0000000-0000-4000-8000-000000000002';
 preview jsonb := public.preview_e4_list_merge(source,target);
 merged jsonb;
 payload jsonb := '[
   {"id":"c0000000-0000-4000-8000-000000000001","name":"Молоко в дорогу","purchased":true,"quantity":1,"unit":"л"},
   {"id":"c0000000-0000-4000-8000-000000000002","name":"Молоко","purchased":false,"quantity":2,"unit":"л"},
   {"id":"c0000000-0000-4000-8000-000000000003","name":"Яйца","purchased":false}
 ]';
begin
 if jsonb_array_length(preview->'items') is distinct from 3
    or public.preview_e4_list_merge(source,foreign_list) is not null then raise exception 'Wrong preview or ownership'; end if;
 begin
   perform public.merge_e4_personal_lists(op,source,foreign_list,0,0,payload);
   raise exception 'Foreign write was accepted';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.merge_e4_personal_lists(op,source,target,0,1,payload);
   raise exception 'Stale destination revision was accepted';
 exception when serialization_failure then null;
 end;
 begin
   perform public.merge_e4_personal_lists(op,source,target,0,0,jsonb_set(payload,'{0,name}','" Яйца "'));
   raise exception 'Occupied rename was accepted';
 exception when invalid_parameter_value then null;
 end;
 merged := public.merge_e4_personal_lists(op,source,target,0,0,payload);
 if (merged->>'target_id')::uuid is distinct from target or
    merged is distinct from public.merge_e4_personal_lists(op,source,target,0,0,payload) then
   raise exception 'Wrong merge receipt or replay';
 end if;
 begin
   perform public.merge_e4_personal_lists(op,source,target,0,0,'[]');
   raise exception 'Invalid replay succeeded';
 exception when raise_exception then
   if sqlerrm <> 'Operation ID payload mismatch' then raise; end if;
 end;
end $$;
reset role;
do $$
begin
 if (select count(*) from public.shopping_lists where deleted_at is not null) <> 1 or
    (select count(*) from public.shopping_items where deleted_at is null) <> 3 or
    (select count(*) from public.shopping_items where name='Молоко в дорогу' and purchased and quantity=1 and unit='л'
      and created_at='2026-11-10T00:00Z' and list_id='b0000000-0000-4000-8000-000000000002') <> 1 or
    (select count(*) from public.list_changes where kind in ('add','delete')) <> 2 or
    (select array_agg(name) from public.e4_archive_items) is distinct from array['Earlier purchase'] or
    has_function_privilege('anon','public.merge_e4_personal_lists(uuid,uuid,uuid,bigint,bigint,jsonb)','EXECUTE') or
    has_function_privilege('anon','public.preview_e4_list_merge(uuid,uuid)','EXECUTE') then
   raise exception 'Wrong merged state, revisions, archive or privileges';
 end if;
end $$;
rollback;
