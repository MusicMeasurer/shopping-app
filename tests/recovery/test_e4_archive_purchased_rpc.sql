\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('aaaa0000-0000-4000-8000-000000000001'), ('aaaa0000-0000-4000-8000-000000000002');
insert into public.shopping_lists(id,owner_id,name,kind) values
 ('bbbb0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000001','Partial permanent','permanent'),
 ('bbbb0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000001','Partial oneoff','oneoff');
insert into public.shopping_items(list_id,name,purchased) values
 ('bbbb0000-0000-4000-8000-000000000001','Marked',true),
 ('bbbb0000-0000-4000-8000-000000000001','Unmarked',false),
 ('bbbb0000-0000-4000-8000-000000000002','Only marked',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaa0000-0000-4000-8000-000000000002',true);
do $$
begin
  perform public.complete_e4_list(gen_random_uuid(),'bbbb0000-0000-4000-8000-000000000001',0,'archive_purchased');
  raise exception 'Foreign purchase archive succeeded';
exception when raise_exception then
  if sqlerrm <> 'List unavailable' then raise; end if;
end $$;
select set_config('request.jwt.claim.sub','aaaa0000-0000-4000-8000-000000000001',true);
do $$
declare
  list_id constant uuid := 'bbbb0000-0000-4000-8000-000000000001';
  oneoff_id constant uuid := 'bbbb0000-0000-4000-8000-000000000002';
  op constant uuid := 'eeee0000-0000-4000-8000-000000000001';
  result jsonb;
begin
  result := public.complete_e4_list(op,list_id,0,'archive_purchased');
  if (result->>'item_count')::int <> 1 or (result->>'revision')::int <> 1 or result->>'archive_id' is null
     or result is distinct from public.complete_e4_list(op,list_id,0,'archive_purchased') then
    raise exception 'Unexpected partial archive receipt: %', result;
  end if;
  perform public.complete_e4_list(gen_random_uuid(),oneoff_id,0,'archive_purchased');
  begin
    perform public.complete_e4_list(gen_random_uuid(),list_id,0,'archive_purchased');
    raise exception 'Stale revision accepted';
  exception when raise_exception then
    if sqlerrm <> 'List revision conflict' then raise; end if;
  end;
  begin
    perform public.complete_e4_list(gen_random_uuid(),list_id,1,'archive_purchased');
    raise exception 'Unmarked item accepted';
  exception when raise_exception then
    if sqlerrm <> 'No marked purchases' then raise; end if;
  end;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.shopping_lists where deleted_at is null) <> 2
      or (select array_agg(name) from public.shopping_items where deleted_at is null) is distinct from array['Unmarked']
      or (select array_agg(name order by name) from public.e4_archive_items) is distinct from array['Marked','Only marked']
      or (select count(*) from public.e4_archive_completions) <> 2
      or (select count(*) from public.list_changes where kind='delete') <> 2 then
    raise exception 'Incorrect active lists, partial archive or tombstones';
  end if;
end $$;
rollback;
