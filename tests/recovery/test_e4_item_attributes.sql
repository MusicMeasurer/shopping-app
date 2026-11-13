\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('aaaaaaaa-1111-4111-8111-111111111111'), ('bbbbbbbb-2222-4222-8222-222222222222');
insert into public.shopping_lists(id,owner_id,name,kind,position) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-111111111111','First','permanent',0),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-1111-4111-8111-111111111111','Second','permanent',3);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
do $$
declare
  l constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  i constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  a constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  r jsonb;
begin
  r := public.apply_e4_item_change(a,l,'add',i,'Rice',false,null,2.5,'kg');
  if r is distinct from public.apply_e4_item_change(a,l,'add',i,'Rice',false,null,2.5,'kg') then
    raise exception 'Attribute replay mismatch';
  end if;
  begin
    perform public.apply_e4_item_change(a,l,'add',i,'Rice',false,null,3,'kg');
    raise exception 'Operation changed attributes on replay';
  exception when raise_exception then
    if sqlerrm <> 'Operation ID payload mismatch' then raise; end if;
  end;
  r := public.apply_e4_item_change(gen_random_uuid(),l,'update',i,'Edited',null,(r->>'item_version')::bigint,null,null);
  if not exists(select 1 from public.shopping_items where id=i and name='Edited' and quantity is null and unit is null) then
    raise exception 'Attributes not cleared';
  end if;
  r := public.apply_e4_item_change(gen_random_uuid(),l,'update',i,null,null,(r->>'item_version')::bigint,3,'l');
  r := public.apply_e4_list_metadata(gen_random_uuid(),l,(r->>'list_revision')::bigint,'Renamed','oneoff',3);
  if not exists(select 1 from public.shopping_lists where id=l and position=3 and name='Renamed' and kind='oneoff') or
     not exists(select 1 from public.shopping_lists where name='Second' and position=2 and revision=1) then
    raise exception 'List ordering did not move the adjacent list';
  end if;
  r := public.complete_e4_list(gen_random_uuid(),l,(r->>'revision')::bigint,'all_purchased');
  if not exists(select 1 from public.e4_archive_items where completion_id=(r->>'archive_id')::uuid
      and name='Edited' and quantity=3 and unit='l') then
    raise exception 'Archive attributes missing';
  end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-2222-4222-8222-222222222222',true);
do $$
begin
  perform public.apply_e4_item_change(gen_random_uuid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','add',
    gen_random_uuid(),'Foreign',false,null,1,'kg');
  raise exception 'Foreign write accepted';
exception when raise_exception then
  if sqlerrm <> 'List unavailable' then raise; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.apply_e4_item_change(uuid,uuid,text,uuid,text,boolean,bigint,numeric,text)','EXECUTE') then
    raise exception 'Anonymous execution granted';
  end if;
end $$;
rollback;
