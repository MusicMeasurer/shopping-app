-- Disposable lab only. Run after two auth.users and a shopping_lists fixture exist.
-- A non-owner authenticated user must not be able to write to another user's list.
-- All writes are rolled back; no account identifiers or secrets are emitted.
begin;
do $test$
declare
  owner_uuid uuid;
  other_uuid uuid;
  target_list uuid;
  denied boolean := false;
begin
  select owner_id, id into owner_uuid, target_list
    from public.shopping_lists where deleted_at is null limit 1;
  select id into other_uuid from auth.users where id <> owner_uuid limit 1;
  if owner_uuid is null or other_uuid is null then
    raise exception 'Required disposable lab users/lists absent';
  end if;
  perform set_config('request.jwt.claim.sub', other_uuid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    insert into public.shopping_items
      (id, list_id, name, purchased, created_at, updated_at, version)
    values
      (gen_random_uuid(), target_list, 'Unauthorized cross-account fixture',
       false, now(), now(), 1);
  exception
    when insufficient_privilege or check_violation then denied := true;
  end;
  if not denied then
    raise exception 'RLS FAILURE: non-owner inserted into another account list';
  end if;
  execute 'reset role';
end $test$;
rollback;
