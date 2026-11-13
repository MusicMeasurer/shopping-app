begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare
  op constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  payload constant jsonb := '{"lists":[{"id":"local","name":"Migrated","kind":"permanent","position":0}],"items":[{"id":"item","listId":"local","name":"Rice","purchased":false,"quantity":2.5,"unit":"kg","createdAt":1700000000000}],"archives":[{"sourceListId":"old","name":"Historical","completedAt":1700000000000,"items":[{"name":"Tea","quantity":1,"unit":"box"}]}]}';
  receipt jsonb;
begin
  receipt := public.import_e4_guest_profile(op,payload);
  if receipt is distinct from public.import_e4_guest_profile(op,payload)
     or (select count(*) from public.shopping_lists where name='Migrated') <> 1
     or (select count(*) from public.shopping_items where name='Rice' and quantity=2.5 and unit='kg') <> 1
     or (select count(*) from public.e4_archive_items where name='Tea' and unit='box') <> 1 then
    raise exception 'Guest import mismatch';
  end if;
  begin
    perform public.import_e4_guest_profile(op, payload || '{"items":[]}'::jsonb);
    raise exception 'Changed replay accepted';
  exception when raise_exception then
    if sqlerrm <> 'Guest import payload changed' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$
begin
  if exists(select 1 from public.shopping_lists where name='Migrated')
    or exists(select 1 from public.e4_archive_completions where source_list_name='Historical')
    or has_function_privilege('anon','public.import_e4_guest_profile(uuid,jsonb)','EXECUTE') then
    raise exception 'Guest import isolation failure';
  end if;
end $$;
rollback;
