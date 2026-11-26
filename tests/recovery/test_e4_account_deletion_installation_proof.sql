begin;

insert into auth.users (id, email) values
  ('62000000-0000-4000-8000-000000000001', 'device-proof@example.test'),
  ('62000000-0000-4000-8000-000000000002', 'independent@example.test');
insert into auth.sessions values
  ('62000000-0000-4000-8000-000000000011', '62000000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '62000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"62000000-0000-4000-8000-000000000001","session_id":"62000000-0000-4000-8000-000000000011"}', true);
do $$
declare
  a constant uuid := '62000000-0000-4000-8000-000000000001';
  b constant uuid := '62000000-0000-4000-8000-000000000002';
  device constant uuid := '62000000-0000-4000-8000-000000000021';
  proof constant uuid := '62000000-0000-4000-8000-000000000031';
begin
  if not public.register_account_deletion_installation(a, device, proof) then
    raise exception 'Own registration rejected';
  end if;
  if public.register_account_deletion_installation(b, device, proof) then
    raise exception 'Registration accepted for another account';
  end if;
  if not public.register_account_deletion_installation(a, device, gen_random_uuid()) then
    raise exception 'A verified session could not restore an installation';
  end if;
  if not public.register_account_deletion_installation(a, device, proof) then
    raise exception 'Restoring the expected test proof failed';
  end if;
  if has_function_privilege(current_user, 'public.account_deletion_status(uuid)', 'EXECUTE')
    or has_function_privilege(current_user, 'public.account_deletion_installation_status(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Authenticated session unexpectedly authorizes status queries';
  end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{}', true);
insert into shoppingapp_deletion.tombstones (account_id, completed_at, review_at)
  values ('62000000-0000-4000-8000-000000000001', now() - interval '1 day', now() + interval '89 days');
delete from auth.sessions where user_id='62000000-0000-4000-8000-000000000001';
insert into shoppingapp_deletion.reminders (account_id, email)
  values ('62000000-0000-4000-8000-000000000001', 'device-proof@example.test');
set local role anon;
do $$ begin
  if not public.acknowledge_account_deletion_installation('62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000021', '62000000-0000-4000-8000-000000000031')
  then raise exception 'Anonymous installation could not acknowledge cleanup'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from shoppingapp_deletion.reminders)
    or not exists (select 1 from shoppingapp_deletion.devices where acknowledged_at is not null)
  then raise exception 'Proof-based acknowledgment did not cancel reminder'; end if;
end $$;
update shoppingapp_deletion.tombstones set review_at=now()-interval '10 days'
  where account_id='62000000-0000-4000-8000-000000000001';

set local role service_role;
select public.process_account_deletions();
reset role;
do $$
begin
  if exists (select 1 from shoppingapp_deletion.devices where acknowledged_at is not null)
    or (select count(*) from shoppingapp_deletion.devices
      where account_id='62000000-0000-4000-8000-000000000001') <> 1
  then raise exception 'Expired tracking was not reduced to minimal proof'; end if;
end $$;

set local role anon;
do $$
declare
  a constant uuid := '62000000-0000-4000-8000-000000000001';
  b constant uuid := '62000000-0000-4000-8000-000000000002';
  device constant uuid := '62000000-0000-4000-8000-000000000021';
  proof constant uuid := '62000000-0000-4000-8000-000000000031';
begin
  if has_function_privilege(current_user, 'public.account_deletion_status(uuid)', 'EXECUTE')
    or has_function_privilege(current_user, 'public.acknowledge_account_deletion(uuid,uuid,uuid)', 'EXECUTE')
    or has_function_privilege(current_user, 'public.register_account_deletion_installation(uuid,uuid,uuid)', 'EXECUTE')
  then raise exception 'Unexpected anonymous installation privileges'; end if;
  if public.account_deletion_installation_status(a, device, null) <> 'unconfirmed'
    or public.account_deletion_installation_status(a, device, gen_random_uuid()) <> 'unconfirmed'
    or public.account_deletion_installation_status(b, device, proof) <> 'unconfirmed'
    or public.account_deletion_installation_status(gen_random_uuid(), device, proof) <> 'unconfirmed'
    or public.account_deletion_installation_status(a, gen_random_uuid(), proof) <> 'unconfirmed'
    or public.acknowledge_account_deletion_installation(a, device, gen_random_uuid())
  then raise exception 'Unconfirmed caller received a distinguished result'; end if;
  if public.account_deletion_installation_status(a, device, proof) <> 'deleted'
    or not public.acknowledge_account_deletion_installation(a, device, proof)
    or not public.acknowledge_account_deletion_installation(a, device, proof)
  then raise exception 'Late authorized cleanup failed without a session'; end if;
end $$;

reset role;
do $$ begin
  if exists (select 1 from shoppingapp_deletion.devices where acknowledged_at is not null)
    or exists (select 1 from shoppingapp_deletion.reminders
      where account_id='62000000-0000-4000-8000-000000000001')
  then raise exception 'Late acknowledgment revived reminder tracking'; end if;
end $$;
rollback;
