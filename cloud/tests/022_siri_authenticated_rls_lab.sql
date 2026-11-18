-- Run against the disposable E3 lab only, after the HTTP 200 Siri fixture.
-- Exercises RLS under the authenticated database role for two distinct auth.users.
-- No token, password or user identifier is returned.
do $test$
declare
  owner_uuid uuid;
  other_uuid uuid;
  target_list uuid;
  fixture_uuid uuid;
  visible_count integer;
begin
  select l.owner_id, l.id into owner_uuid, target_list
    from public.shopping_lists l where l.deleted_at is null limit 1;
  select u.id into other_uuid from auth.users u where u.id <> owner_uuid limit 1;
  select i.id into fixture_uuid from public.shopping_items i
    where i.list_id = target_list and i.name = 'E3 HTTP verified fixture'
      and i.deleted_at is null limit 1;
  if owner_uuid is null or other_uuid is null or fixture_uuid is null then
    raise exception 'Required disposable lab fixtures absent';
  end if;

  perform set_config('request.jwt.claim.sub', owner_uuid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into visible_count from public.shopping_items
    where id = fixture_uuid and list_id = target_list and deleted_at is null;
  if visible_count <> 1 then
    raise exception 'Owner cannot read Siri-created item';
  end if;

  perform set_config('request.jwt.claim.sub', other_uuid::text, true);
  select count(*) into visible_count from public.shopping_items
    where id = fixture_uuid and list_id = target_list and deleted_at is null;
  if visible_count <> 0 then
    raise exception 'Other account can read Siri-created item';
  end if;
  select count(*) into visible_count from public.shopping_lists
    where id = target_list;
  if visible_count <> 0 then
    raise exception 'Other account can read owner list';
  end if;
  execute 'reset role';
end $test$;
