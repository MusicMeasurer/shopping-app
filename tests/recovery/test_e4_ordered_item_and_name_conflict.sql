\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('aaaaaaaa-1111-4111-8111-111111111111'), ('bbbbbbbb-2222-4222-8222-222222222222');
insert into public.shopping_lists(id,owner_id,name,kind,position)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','aaaaaaaa-1111-4111-8111-111111111111','Shopping','permanent',0);
set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
do $$
declare
  list constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  first constant uuid := gen_random_uuid();
  second constant uuid := gen_random_uuid();
  later constant uuid := gen_random_uuid();
  legacy constant uuid := gen_random_uuid();
  added constant uuid := gen_random_uuid();
  resolved constant uuid := gen_random_uuid();
  first_time constant timestamptz := '2026-11-18 08:00:00.002+00';
  second_time constant timestamptz := '2026-11-18 08:00:00.001+00';
  r jsonb;
  v_first bigint;
  v_second bigint;
  v_later bigint;
begin
  r := public.add_e4_ordered_item(added,list,first,'Красная фасоль',false,2,'кг',first_time);
  v_first := (r->>'item_version')::bigint;
  v_second := (public.add_e4_ordered_item(gen_random_uuid(),list,second,
    U&'КРАСНАЯ\00A0\2009ФАСОЛЬ',true,2,'уп.',second_time)->>'item_version')::bigint;
  if r is distinct from public.add_e4_ordered_item(added,list,first,'Красная фасоль',false,2,'кг',first_time)
      or (select array_agg(id order by created_at desc) from public.shopping_items where list_id = list)
        is distinct from array[first,second] then
    raise exception 'Entry order or exact replay failed';
  end if;
  begin
    perform public.add_e4_ordered_item(added,list,first,'Красная фасоль',false,2,'кг',second_time);
    raise exception 'Changed timestamp accepted on replay';
  exception when raise_exception then
    if sqlerrm <> 'Operation ID payload mismatch' then raise; end if;
  end;

  r := public.resolve_e4_item_name_conflict(resolved,list,first,v_first,second,v_second,null);
  if r is distinct from public.resolve_e4_item_name_conflict(resolved,list,first,v_first,second,v_second,null) then
    raise exception 'Name resolution replay returned another receipt';
  end if;
  begin
    perform public.resolve_e4_item_name_conflict(gen_random_uuid(),list,second,v_second,first,v_first,null);
    raise exception 'Opposite decision was accepted after the first one';
  exception when raise_exception then
    if sqlerrm <> 'Name conflict changed' then raise; end if;
  end;
  v_later := (public.apply_e4_item_change(gen_random_uuid(),list,'add',later,' красная  фасоль ',true,null,5,'уп.')->>'item_version')::bigint;
  begin
    perform public.resolve_e4_item_name_conflict(gen_random_uuid(),list,first,v_first,later,v_later,' КРАСНАЯ ФАСОЛЬ ');
    raise exception 'Rename to the same normalized name was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Item name already exists' then raise; end if;
  end;
  perform public.resolve_e4_item_name_conflict(gen_random_uuid(),list,first,v_first,later,v_later,'Белая фасоль');
  if not exists (select 1 from public.shopping_items where id = later and name = 'Белая фасоль'
      and quantity = 5 and unit = 'уп.' and purchased) then raise exception 'Rename lost item fields'; end if;

  r := public.apply_e4_item_change(legacy,list,'add',legacy,'Груши',false,null,null,null);
  if r is distinct from public.add_e4_ordered_item(legacy,list,legacy,'Груши',false,null,null,first_time)
      or exists(select 1 from public.shopping_items where id = legacy and created_at = first_time) then
    raise exception 'Upgraded server did not preserve old acknowledgements';
  end if;
end $$;
select set_config('request.jwt.claim.sub','bbbbbbbb-2222-4222-8222-222222222222',true);
do $$
begin
  perform public.resolve_e4_item_name_conflict(gen_random_uuid(),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    gen_random_uuid(),0,gen_random_uuid(),0,null);
  raise exception 'Cross-account name resolution accepted';
exception when raise_exception then
  if sqlerrm <> 'List unavailable' then raise; end if;
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon','public.resolve_e4_item_name_conflict(uuid,uuid,uuid,bigint,uuid,bigint,text)','EXECUTE')
     or has_function_privilege('anon','public.add_e4_ordered_item(uuid,uuid,uuid,text,boolean,numeric,text,timestamptz)','EXECUTE') then
    raise exception 'Anonymous execution granted';
  end if;
end $$;
rollback;
