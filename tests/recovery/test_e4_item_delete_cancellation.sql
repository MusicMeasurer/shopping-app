-- 047: disposable PostgreSQL only. Roll back every fixture.
begin;
insert into auth.users(id) values ('47000000-0000-4000-8000-000000000001'),('47000000-0000-4000-8000-000000000002');
insert into public.shopping_lists(id,owner_id,name) values
 ('47000000-0000-4000-8000-000000000101','47000000-0000-4000-8000-000000000001','Delete cancellation A'),
 ('47000000-0000-4000-8000-000000000102','47000000-0000-4000-8000-000000000002','Delete cancellation B');
set local role authenticated;
select set_config('request.jwt.claim.sub','47000000-0000-4000-8000-000000000001',true);
do $$
declare
  a uuid := '47000000-0000-4000-8000-000000000001';
  l uuid := '47000000-0000-4000-8000-000000000101';
  other uuid := '47000000-0000-4000-8000-000000000102';
  i uuid := gen_random_uuid();
  op uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  payload jsonb;
  res jsonb;
begin
  if has_function_privilege('anon','public.cancel_e4_item_delete(uuid,jsonb)','execute')
     or has_function_privilege('service_role','public.cancel_e4_item_delete(uuid,jsonb)','execute')
     or not has_function_privilege('authenticated','public.cancel_e4_item_delete(uuid,jsonb)','execute') then
    raise exception 'Incorrect delete cancellation ACL';
  end if;
  perform public.apply_e4_item_change(gen_random_uuid(),l,'add',i,'Milk',true,null,2,'l');
  payload := jsonb_build_object('operation_id',op,'list_id',l,'item_id',i,'kind','delete','expected_version',1);
  res := public.cancel_e4_item_delete(c,payload);
  if res->>'status' is distinct from 'cancelled' or res->>'item_version' is distinct from '1'
     or res->'item'->>'name' is distinct from 'Milk' or res->'item'->>'purchased' is distinct from 'true'
     or (res->'item'->>'quantity')::numeric is distinct from 2::numeric
     or public.cancel_e4_item_delete(c,payload) is distinct from res then
    raise exception 'Cancellation did not retain the confirmed snapshot: %',res;
  end if;
  begin
    perform public.apply_item_change(op,l,'delete',i,null,null,1);
    raise exception 'Late delete accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  if public.push_e4_account_changes(a,jsonb_build_array(payload))->0->'receipt' is not null then
    raise exception 'Late batch delete accepted';
  end if;
  if not exists(select from public.shopping_items where id=i and deleted_at is null and version=1) then
    raise exception 'Late delete removed item';
  end if;
  begin
    perform public.cancel_e4_item_delete(c,payload||jsonb_build_object('expected_version',2));
    raise exception 'Changed replay accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.cancel_e4_item_delete(gen_random_uuid(),payload||jsonb_build_object('list_id',other));
    raise exception 'Foreign list accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
  -- A separate device edited the item while this delete was in flight.
  op := gen_random_uuid(); c := gen_random_uuid();
  payload := payload||jsonb_build_object('operation_id',op);
  perform public.apply_e4_item_change(gen_random_uuid(),l,'update',i,'Newer',false,1,7,'l');
  res := public.cancel_e4_item_delete(c,payload);
  if res->>'status' is distinct from 'cancelled' or res->>'item_version' is distinct from '2'
     or res->'item'->>'name' is distinct from 'Newer' or (res->'item'->>'quantity')::numeric is distinct from 7::numeric then
    raise exception 'Newer data overwritten: %',res;
  end if;
  -- Original delete reached the server first: report the authoritative tombstone.
  op := gen_random_uuid(); c := gen_random_uuid();
  payload := payload||jsonb_build_object('operation_id',op,'expected_version',2);
  perform public.apply_item_change(op,l,'delete',i,null,null,2);
  res := public.cancel_e4_item_delete(c,payload);
  if res->>'status' is distinct from 'superseded' or res->>'item_version' is distinct from '3'
     or res->'item' is distinct from 'null'::jsonb
     or public.cancel_e4_item_delete(c,payload) is distinct from res then
    raise exception 'Committed deletion not reported accurately: %',res;
  end if;
  if not exists(select from public.shopping_items where id=i and deleted_at is not null and version=3) then
    raise exception 'Confirmed deletion resurrected';
  end if;
end $$;
reset role;
insert into shoppingapp_deletion.tombstones(account_id,completed_at) values
 ('47000000-0000-4000-8000-000000000001',now());
set local role authenticated;
do $$
begin
  begin
    perform public.cancel_e4_item_delete(gen_random_uuid(),jsonb_build_object('operation_id',gen_random_uuid(),
      'list_id','47000000-0000-4000-8000-000000000101','item_id',gen_random_uuid(),'kind','delete','expected_version',1));
    raise exception 'Deleted account accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
