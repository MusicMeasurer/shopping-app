-- Disposable lab only. Requires the previously created HTTP Siri fixture.
-- Check non-owner UPDATE and DELETE are denied by privileges or RLS.
-- Transaction rolls back all attempted writes.
begin;
do $test$
declare
  owner_uuid uuid;
  other_uuid uuid;
  target_list uuid;
  fixture_uuid uuid;
  affected integer;
begin
  select owner_id, id into owner_uuid, target_list
    from public.shopping_lists where deleted_at is null limit 1;
  select id into other_uuid from auth.users where id <> owner_uuid limit 1;
  select id into fixture_uuid from public.shopping_items
    where list_id = target_list and name = 'E3 HTTP verified fixture'
      and deleted_at is null limit 1;
  if owner_uuid is null or other_uuid is null or fixture_uuid is null then
    raise exception 'Required disposable lab fixtures absent';
  end if;
  perform set_config('request.jwt.claim.sub', other_uuid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    update public.shopping_items
      set name = 'Unauthorized update fixture' where id = fixture_uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Cross-account update allowed'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.shopping_items where id = fixture_uuid;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Cross-account delete allowed'; end if;
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
end $test$;
rollback;
