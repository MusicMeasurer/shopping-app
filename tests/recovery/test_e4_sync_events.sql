\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('41000000-0000-4000-8000-000000000001','sync-events-a@example.test',now()),
 ('41000000-0000-4000-8000-000000000002','sync-events-b@example.test',now());
insert into public.shopping_lists(id,owner_id,name,kind) values
 ('41000000-0000-4000-8000-000000000101','41000000-0000-4000-8000-000000000001','Source','oneoff'),
 ('41000000-0000-4000-8000-000000000102','41000000-0000-4000-8000-000000000001','Target','permanent'),
 ('41000000-0000-4000-8000-000000000103','41000000-0000-4000-8000-000000000001','Archive','permanent'),
 ('41000000-0000-4000-8000-000000000104','41000000-0000-4000-8000-000000000001','Completed','oneoff'),
 ('41000000-0000-4000-8000-000000000105','41000000-0000-4000-8000-000000000002','Foreign','permanent');
insert into public.shopping_items(id,list_id,name,purchased) values
 ('41000000-0000-4000-8000-000000000201','41000000-0000-4000-8000-000000000101','Milk',false),
 ('41000000-0000-4000-8000-000000000202','41000000-0000-4000-8000-000000000103','Bread',true),
 ('41000000-0000-4000-8000-000000000203','41000000-0000-4000-8000-000000000103','Eggs',false),
 ('41000000-0000-4000-8000-000000000204','41000000-0000-4000-8000-000000000104','Tea',false);
set local role authenticated;
select set_config('request.jwt.claim.sub','41000000-0000-4000-8000-000000000001',true);
do $$
declare
 a uuid:='41000000-0000-4000-8000-000000000001';
 b uuid:='41000000-0000-4000-8000-000000000002';
 s uuid:='41000000-0000-4000-8000-000000000101';
 t uuid:='41000000-0000-4000-8000-000000000102';
 l uuid:='41000000-0000-4000-8000-000000000103';
 c uuid:='41000000-0000-4000-8000-000000000104';
 op uuid:='41000000-0000-4000-8000-000000000301';
 payload jsonb:='[{"id":"41000000-0000-4000-8000-000000000201","name":"Milk","purchased":false}]';
 first_page jsonb; response jsonb; result jsonb; replay jsonb; lim bigint; pos bigint;
begin
 first_page:=public.pull_e4_account_changes_v2(a,0,2);
 lim:=(first_page->>'through')::bigint;
 pos:=(first_page->'events'->1->>'event_position')::bigint;
 if jsonb_array_length(first_page->'events')<>2 then raise exception 'First page size'; end if;
 result:=public.merge_e4_personal_lists(op,s,t,0,0,payload);
 replay:=public.merge_e4_personal_lists(op,s,t,0,0,payload);
 if result is distinct from replay then raise exception 'Replay differs'; end if;
 response:=public.pull_e4_account_changes_v2(a,pos,500,lim);
 if (response->>'through')::bigint<>lim or (response->>'head')::bigint<=lim or
   exists(select 1 from jsonb_array_elements(response->'events') e where (e->>'event_position')::bigint>lim)
 then raise exception 'Fixed upper boundary failed'; end if;
 response:=public.pull_e4_account_changes_v2(a,lim,500);
 if (select count(*) from jsonb_array_elements(response->'events') e where e->>'entity'='list'
   and e->>'entity_id'=s::text and e->'semantics'->>'event_reason'='merged'
   and e->'semantics'->>'target_list_id'=t::text and e->'semantics'->>'target_list_name'='Target'
   and e->'semantics'->>'operation_id'=op::text)<>1 then raise exception 'Merge semantics/replay'; end if;
 perform public.complete_e4_list(gen_random_uuid(),l,0,'archive_purchased');
 perform public.apply_item_change(gen_random_uuid(),l,'delete','41000000-0000-4000-8000-000000000203',null,null,1);
 perform public.complete_e4_list(gen_random_uuid(),c,0,'none_purchased');
 perform public.complete_e4_list(gen_random_uuid(),t,(select revision from public.shopping_lists where id=t),'delete_list');
 response:=public.pull_e4_account_changes_v2(a,0,500);
 if not exists(select 1 from jsonb_array_elements(response->'events') e where e->>'entity_id'='41000000-0000-4000-8000-000000000202' and e->'semantics'->>'event_reason'='archived')
 or not exists(select 1 from jsonb_array_elements(response->'events') e where e->>'entity_id'='41000000-0000-4000-8000-000000000203' and e->'semantics'->>'event_reason'='deleted')
 or not exists(select 1 from jsonb_array_elements(response->'events') e where e->>'entity_id'='41000000-0000-4000-8000-000000000204' and e->'semantics'->>'event_reason'='completed')
 or not exists(select 1 from jsonb_array_elements(response->'events') e where e->>'entity_id'=t::text and e->'semantics'->>'event_reason'='deleted')
 or exists(select 1 from jsonb_array_elements(response->'events') e where e->>'list_id' in (s::text,t::text) and e->'snapshot'<>'null'::jsonb)
 then raise exception 'Removal reason or masking incorrect'; end if;
 if jsonb_array_length(response->'events')<>(select count(*) from public.pull_e4_account_changes(a,0,500)) then raise exception 'Legacy page count changed'; end if;
 if has_function_privilege('anon','public.pull_e4_account_changes_v2(uuid,bigint,integer,bigint)','EXECUTE')
 or has_function_privilege('authenticated','shoppingapp_internal.expire_e4_feed_semantics()','EXECUTE') then raise exception 'Unexpected grant'; end if;
 begin
  perform public.pull_e4_account_changes_v2(b,0,500); raise exception 'Cross-account pull accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
update shoppingapp_internal.account_feed_events set recorded_at=now()-interval '7 days'
 where account_id='41000000-0000-4000-8000-000000000001' and semantics is not null;
set local role authenticated;
do $$ begin
 if exists(select 1 from jsonb_array_elements(public.pull_e4_account_changes_v2('41000000-0000-4000-8000-000000000001',0,500)->'events') e where e ? 'semantics') then raise exception 'Expired semantics returned'; end if;
end $$;
reset role;
do $$ declare before_count bigint; cleared bigint; begin
 select count(*) into before_count from shoppingapp_internal.account_feed_events;
 cleared:=shoppingapp_internal.expire_e4_feed_semantics();
 if cleared=0 or (select count(*) from shoppingapp_internal.account_feed_events)<>before_count or exists(select 1 from shoppingapp_internal.account_feed_events where semantics is not null) then raise exception 'Expiry removed feed or failed'; end if;
end $$;
insert into shoppingapp_deletion.tombstones(account_id) values ('41000000-0000-4000-8000-000000000001');
set local role authenticated;
do $$ begin
 begin
  perform public.pull_e4_account_changes_v2('41000000-0000-4000-8000-000000000001',0,500);
  raise exception 'Blocked account read accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
