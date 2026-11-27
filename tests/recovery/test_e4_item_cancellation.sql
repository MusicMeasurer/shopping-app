-- 046, disposable PostgreSQL only. Every fixture is rolled back.
begin;
insert into auth.users(id) values ('46000000-0000-4000-8000-000000000001'),('46000000-0000-4000-8000-000000000002');
insert into public.shopping_lists(id,owner_id,name) values
 ('46000000-0000-4000-8000-000000000101','46000000-0000-4000-8000-000000000001','Cancel A'),
 ('46000000-0000-4000-8000-000000000102','46000000-0000-4000-8000-000000000002','Cancel B');
set local role authenticated;
select set_config('request.jwt.claim.sub','46000000-0000-4000-8000-000000000001',true);
do $$
declare
  a uuid := '46000000-0000-4000-8000-000000000001';
  l uuid := '46000000-0000-4000-8000-000000000101';
  other uuid := '46000000-0000-4000-8000-000000000102';
  i uuid := gen_random_uuid();
  op uuid := gen_random_uuid();
  cancel uuid := gen_random_uuid();
  input jsonb;
  res jsonb;
  before_item jsonb := '{"name":"Milk","purchased":false,"quantity":1,"unit":"l"}';
  added uuid := gen_random_uuid();
  ordered_time timestamptz := '2026-11-27T03:00:00Z';
  v bigint;
begin
  if has_function_privilege('anon','public.cancel_e4_item_edit(uuid,jsonb,jsonb)','execute')
    or has_function_privilege('service_role','public.cancel_e4_item_edit(uuid,jsonb,jsonb)','execute')
    or not has_function_privilege('authenticated','public.cancel_e4_item_edit(uuid,jsonb,jsonb)','execute') then
    raise exception 'Incorrect cancellation ACL';
  end if;
  input := jsonb_build_object('operation_id',op,'list_id',l,'item_id',i,'kind','add','name','Late',
    'purchased',false,'created_at',ordered_time);
  res := public.cancel_e4_item_edit(cancel,input,null);
  if res->>'status' is distinct from 'cancelled' or res->'item' is distinct from 'null'::jsonb
    or public.cancel_e4_item_edit(cancel,input,null) is distinct from res then
    raise exception 'Unapplied ordered add not cancelled idempotently';
  end if;
  begin
    perform public.add_e4_ordered_item(op,l,i,'Late',false,null,null,ordered_time);
    raise exception 'Late ordered add unexpectedly accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.apply_e4_item_change(op,l,'add',i,'Late',false,null,null,null);
    raise exception 'Late attribute add unexpectedly accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.apply_item_change(op,l,'add',i,'Late',false,null);
    raise exception 'Late legacy add unexpectedly accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  if public.push_e4_account_changes(a,jsonb_build_array(input))->0->'receipt' is not null then
    raise exception 'Late batch add unexpectedly accepted';
  end if;
  if exists(select from public.shopping_items where id=i) then raise exception 'Late write created item'; end if;
  begin
    perform public.cancel_e4_item_edit(cancel,input||jsonb_build_object('name','different'),null);
    raise exception 'Cancellation replay payload mismatch accepted' using errcode='XX000';
  exception when raise_exception then null; end;
  begin
    perform public.cancel_e4_item_edit(gen_random_uuid(),input||jsonb_build_object('list_id',other),null);
    raise exception 'Foreign list cancellation accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;

  -- Original update won the race. Its exact receipt permits a reverse update.
  perform public.apply_e4_item_change(gen_random_uuid(),l,'add',i,'Milk',false,null,1,'l');
  op := gen_random_uuid(); cancel := gen_random_uuid();
  input := jsonb_build_object('operation_id',op,'list_id',l,'item_id',i,'kind','update','name','Milk',
    'purchased',true,'expected_version',1,'quantity',3,'unit','l');
  perform public.push_e4_account_changes(a,jsonb_build_array(input));
  res := public.cancel_e4_item_edit(cancel,input,before_item);
  if res->>'status' is distinct from 'cancelled' or res->>'item_version' is distinct from '3'
    or (res->'item'->>'quantity')::numeric is distinct from 1::numeric or res->'item'->>'purchased' is distinct from 'false'
    or public.cancel_e4_item_edit(cancel,input,before_item) is distinct from res then
    raise exception 'Confirmed update not reversed exactly once: %',res;
  end if;
  if (select version from public.shopping_items where id=i)<>3 then raise exception 'Duplicate compensation'; end if;

  -- A newer version must not be overwritten by cancellation.
  op := gen_random_uuid(); cancel := gen_random_uuid();
  input := jsonb_build_object('operation_id',op,'list_id',l,'item_id',i,'kind','update','name','Milk',
    'purchased',true,'expected_version',3,'quantity',5,'unit','l');
  perform public.push_e4_account_changes(a,jsonb_build_array(input));
  perform public.apply_e4_item_change(gen_random_uuid(),l,'update',i,'Newer',false,4,7,'l');
  res := public.cancel_e4_item_edit(cancel,input,before_item);
  if res->>'status' is distinct from 'superseded' or res->>'item_version' is distinct from '5'
    or res->'item'->>'name' is distinct from 'Newer' or (res->'item'->>'quantity')::numeric is distinct from 7::numeric then
    raise exception 'Newer update overwritten: %',res;
  end if;

  -- Ordered add applied, then cancellation deletes only that exact version.
  op := gen_random_uuid(); cancel := gen_random_uuid();
  input := jsonb_build_object('operation_id',op,'list_id',l,'item_id',added,'kind','add','name','Bread',
    'purchased',false,'created_at',ordered_time);
  perform public.add_e4_ordered_item(op,l,added,'Bread',false,null,null,ordered_time);
  res := public.cancel_e4_item_edit(cancel,input,null);
  if res->>'status' is distinct from 'cancelled' or res->'item' is distinct from 'null'::jsonb
    or res->>'item_version' is distinct from '2'
    or public.cancel_e4_item_edit(cancel,input,null) is distinct from res then
    raise exception 'Confirmed add compensation failed';
  end if;
  -- Original RPC replay is still idempotent: no resurrection.
  perform public.add_e4_ordered_item(op,l,added,'Bread',false,null,null,ordered_time);
  if exists(select from public.shopping_items where id=added and deleted_at is null) then
    raise exception 'Replay resurrected cancelled item';
  end if;

  -- Unapplied update: fence and return latest confirmed state, not the stale base.
  op := gen_random_uuid(); cancel := gen_random_uuid();
  input := jsonb_build_object('operation_id',op,'list_id',l,'item_id',i,'kind','update','name','Wrong',
    'purchased',true,'expected_version',5,'quantity',99,'unit','l');
  res := public.cancel_e4_item_edit(cancel,input,before_item);
  if res->>'status' is distinct from 'cancelled' or res->'item'->>'name' is distinct from 'Newer' then
    raise exception 'Unapplied update did not return confirmed state';
  end if;
  if public.push_e4_account_changes(a,jsonb_build_array(input))->0->'receipt' is not null then
    raise exception 'Late update accepted';
  end if;
end $$;
reset role;
-- Tombstoned account cannot invoke the new privileged RPC even directly in SQL.
insert into shoppingapp_deletion.tombstones(account_id,completed_at) values
 ('46000000-0000-4000-8000-000000000001',now());
set local role authenticated;
do $$
begin
  begin
    perform public.cancel_e4_item_edit(gen_random_uuid(),jsonb_build_object('operation_id',gen_random_uuid(),
      'list_id','46000000-0000-4000-8000-000000000101','item_id',gen_random_uuid(),
      'kind','add','name','Denied','purchased',false),null);
    raise exception 'Deleted account accepted' using errcode='XX000';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
