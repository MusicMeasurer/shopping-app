-- Role-realistic regression. All fixtures are synthetic and rolled back.
-- Never run the mail worker or send SMTP from this test.
begin;

do $$
declare r text; f text;
begin
  foreach f in array array[
    'public.process_account_deletions()',
    'public.claim_account_deletion_mail(uuid)',
    'public.reserve_account_deletion_reminder(uuid,uuid)',
    'public.retry_rejected_account_deletion_reminder(uuid,uuid)',
    'public.complete_account_deletion_mail(uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'Worker lacks EXECUTE on %', f;
    end if;
    foreach r in array array['anon','authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception 'Worker RPC % exposed to %', f, r;
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role','shoppingapp_deletion.mail','SELECT,INSERT,UPDATE,DELETE')
    then raise exception 'Direct worker mail table access'; end if;
end $$;

-- Simulate two already leased reminder jobs. No global queue claim on a shared lab.
insert into shoppingapp_deletion.tombstones(account_id,completed_at)
values ('61000000-0000-4000-8000-000000000001',now()),
       ('61000000-0000-4000-8000-000000000002',now());
insert into shoppingapp_deletion.reminders(account_id,email,mail_id)
values ('61000000-0000-4000-8000-000000000001','worker-acl-a@example.test','61000000-0000-4000-8000-000000000011'),
       ('61000000-0000-4000-8000-000000000002','worker-acl-b@example.test','61000000-0000-4000-8000-000000000012');
insert into shoppingapp_deletion.mail(id,account_id,kind,email,expires_at,lease_id)
values ('61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000001','reminder','worker-acl-a@example.test',now()+interval '1 hour','61000000-0000-4000-8000-000000000021'),
       ('61000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000002','reminder','worker-acl-b@example.test',now()+interval '1 hour','61000000-0000-4000-8000-000000000021');
insert into shoppingapp_deletion.devices(account_id,device_id,proof_hash)
values ('61000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000031',
 shoppingapp_deletion.digest('device:61000000-0000-4000-8000-000000000041'));

set local role anon;
do $$
begin
  begin
    perform public.reserve_account_deletion_reminder('61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000021');
    raise exception 'anon reserve unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.retry_rejected_account_deletion_reminder('61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000021');
    raise exception 'anon retry unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform public.reserve_account_deletion_reminder('61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000021');
    raise exception 'authenticated reserve unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.retry_rejected_account_deletion_reminder('61000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000021');
    raise exception 'authenticated retry unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$
declare
  job constant uuid := '61000000-0000-4000-8000-000000000011';
  lease constant uuid := '61000000-0000-4000-8000-000000000021';
  wrong_lease constant uuid := '61000000-0000-4000-8000-000000000022';
begin
  if current_user <> 'service_role' then raise exception 'Wrong test role'; end if;
  if public.reserve_account_deletion_reminder(job,wrong_lease) then raise exception 'Wrong lease accepted'; end if;
  if not public.reserve_account_deletion_reminder(job,lease) then raise exception 'Worker reserve denied'; end if;
  if public.reserve_account_deletion_reminder(job,lease) then raise exception 'Double reservation'; end if;
  perform public.retry_rejected_account_deletion_reminder(job,wrong_lease);
  if public.reserve_account_deletion_reminder(job,lease) then raise exception 'Wrong lease reset reservation'; end if;
  -- Explicit SMTP rejection is simulated; unknown delivery is never retried.
  perform public.retry_rejected_account_deletion_reminder(job,lease);
  if not public.reserve_account_deletion_reminder(job,lease) then raise exception 'Worker retry denied'; end if;
  perform public.complete_account_deletion_mail(job,lease);
  if public.reserve_account_deletion_reminder(job,lease) then raise exception 'Completed reminder still reservable'; end if;
end $$;
reset role;

-- Last installation acknowledges before the second reminder can be sent.
set local role anon;
select public.acknowledge_account_deletion('61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000031','61000000-0000-4000-8000-000000000041');
reset role;
set local role service_role;
do $$
begin
  if public.reserve_account_deletion_reminder('61000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000021')
    then raise exception 'Cancelled reminder still reservable'; end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from shoppingapp_deletion.mail where account_id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002'))
     or exists (select 1 from shoppingapp_deletion.reminders where account_id in ('61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002'))
    then raise exception 'Completed/cancelled reminder retained'; end if;
end $$;
rollback;
