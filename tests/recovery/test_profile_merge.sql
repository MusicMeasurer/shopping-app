begin;
insert into auth.users(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
do $$
declare
 payload jsonb := '{"collisionMode":"separate","lists":[{"id":"local","name":"Food","kind":"permanent"}],"items":[{"listId":"local","name":"Milk","purchased":true,"quantity":2,"unit":"л","createdAt":1700000000000}],"archives":[{"sourceListId":"local","name":"Food","completedAt":1700000000000,"items":[{"name":"Bread","quantity":1,"unit":"шт."}]}]}';
 op uuid := gen_random_uuid();
 receipt jsonb;
 target uuid;
begin
 receipt := public.import_e4_profile_merge(op,auth.uid(),payload);
 target := (receipt->'lists'->>'local')::uuid;
 if receipt is distinct from public.import_e4_profile_merge(op,auth.uid(),payload) then raise exception 'Replay changed receipt'; end if;
 perform public.import_e4_profile_merge(gen_random_uuid(),auth.uid(),payload);
 perform public.import_e4_profile_merge(gen_random_uuid(),auth.uid(),payload);
 if (select count(*) from public.shopping_lists where name in ('Food','Food (2)','Food (3)')) <> 3 then raise exception 'Automatic suffix failed'; end if;
 receipt := public.import_e4_profile_merge(gen_random_uuid(),auth.uid(),payload || '{"collisionMode":"merge"}');
 if (receipt->'lists'->>'local')::uuid <> target or
    (select count(*) from public.shopping_items where list_id=target and name='Milk' and purchased and quantity=2) <> 2 or
    (select revision from public.shopping_lists where id=target) <> 2 or
    (select count(*) from public.pull_item_changes(target,0,100)) <> 2 or
    (select count(*) from public.e4_archive_items where name='Bread') <> 4 then raise exception 'Merge data or change feed mismatch'; end if;
 begin
   perform public.import_e4_profile_merge(op,auth.uid(),payload || '{"collisionMode":"merge"}');
   raise exception 'Changed replay accepted';
 exception when raise_exception then if sqlerrm <> 'Guest import payload changed' then raise; end if; end;
 begin
   perform public.import_e4_profile_merge(gen_random_uuid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',payload);
   raise exception 'Account mismatch accepted';
 exception when raise_exception then if sqlerrm <> 'Invalid guest import' then raise; end if; end;
 if has_function_privilege('anon','public.import_e4_profile_merge(uuid,uuid,jsonb)','execute') then raise exception 'Anonymous access'; end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
do $$ begin
 if exists(select 1 from public.shopping_lists where name='Food') or exists(select 1 from public.e4_archive_items where name='Bread') then raise exception 'Cross-account read'; end if;
end $$;
rollback;
