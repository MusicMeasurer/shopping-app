\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('aaaa0000-0000-4000-8000-000000000001'), ('aaaa0000-0000-4000-8000-000000000002');
insert into public.shopping_lists(id,owner_id,name,kind) values
 ('bbbb0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000001','With archive','permanent'),
 ('bbbb0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000001','Empty','oneoff');
insert into public.shopping_items(id,list_id,name,purchased) values
 ('cccc0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000001','Marked',true),
 ('cccc0000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-000000000001','Unmarked',false);
insert into public.e4_archive_completions(id,owner_id,source_list_id,source_list_name,operation_id) values
 ('dddd0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000001','bbbb0000-0000-4000-8000-000000000001','With archive','eeee0000-0000-4000-8000-000000000001');
insert into public.e4_archive_items(completion_id,ordinal,name) values
 ('dddd0000-0000-4000-8000-000000000001',0,'Earlier purchase');
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaa0000-0000-4000-8000-000000000002',true);
do $$
begin
  perform public.complete_e4_list('eeee0000-0000-4000-8000-000000000002','bbbb0000-0000-4000-8000-000000000001',0,'delete_list');
  raise exception 'Foreign deletion succeeded';
exception when raise_exception then
  if sqlerrm <> 'List unavailable' then raise; end if;
end $$;
select set_config('request.jwt.claim.sub','aaaa0000-0000-4000-8000-000000000001',true);
do $$
declare
  list_id constant uuid := 'bbbb0000-0000-4000-8000-000000000001';
  op constant uuid := 'eeee0000-0000-4000-8000-000000000002';
  result jsonb;
begin
  begin
    perform public.complete_e4_list(op,list_id,1,'delete_list');
    raise exception 'Stale revision accepted';
  exception when raise_exception then
    if sqlerrm <> 'List revision conflict' then raise; end if;
  end;
  result := public.complete_e4_list(op,list_id,0,'delete_list');
  if result is distinct from public.complete_e4_list(op,list_id,0,'delete_list')
      or result->>'archive_id' is not null or (result->>'item_count')::int <> 2
      or (result->>'revision')::int <> 2 then
    raise exception 'Unexpected deletion receipt: %', result;
  end if;
  if (select count(*) from public.e4_archive_completions) <> 1
      or (select array_agg(name) from public.e4_archive_items) is distinct from array['Earlier purchase'] then
    raise exception 'Existing archive changed';
  end if;
  result := public.complete_e4_list('eeee0000-0000-4000-8000-000000000003','bbbb0000-0000-4000-8000-000000000002',0,'delete_list');
  if (result->>'item_count')::int <> 0 or (result->>'revision')::int <> 1 or result->>'archive_id' is not null then
    raise exception 'Unexpected empty-list deletion receipt: %', result;
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.shopping_lists where deleted_at is not null) <> 2
      or (select count(*) from public.shopping_items where deleted_at is not null) <> 2
      or (select count(*) from public.list_changes where kind='delete') <> 2
      or has_function_privilege('anon','public.complete_e4_list(uuid,uuid,bigint,text)','EXECUTE') then
    raise exception 'Incorrect deletion state, tombstones or privileges';
  end if;
end $$;
rollback;
