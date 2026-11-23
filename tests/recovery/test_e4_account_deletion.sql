begin;

insert into auth.users(id,email,email_confirmed_at) values
  ('60000000-0000-4000-8000-000000000001','a-deletion@example.test',now()),
  ('60000000-0000-4000-8000-000000000002','b-deletion@example.test',now());
insert into auth.sessions values
  ('60000000-0000-4000-8000-000000000011','60000000-0000-4000-8000-000000000001'),
  ('60000000-0000-4000-8000-000000000012','60000000-0000-4000-8000-000000000001');
insert into auth.refresh_tokens values
  ('60000000-0000-4000-8000-000000000013','60000000-0000-4000-8000-000000000012');
insert into public.shopping_lists(id,owner_id,name) values
  ('60000000-0000-4000-8000-000000000021','60000000-0000-4000-8000-000000000001','Personal deletion test'),
  ('60000000-0000-4000-8000-000000000022','60000000-0000-4000-8000-000000000002','Unaffected deletion test');
insert into public.e4_archive_completions(owner_id,source_list_id,source_list_name,operation_id)
  values('60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000021','Archive deletion test',gen_random_uuid());

do $$
declare
  a uuid := '60000000-0000-4000-8000-000000000001';
  b uuid := '60000000-0000-4000-8000-000000000002';
  first_session uuid := '60000000-0000-4000-8000-000000000011';
  second_session uuid := '60000000-0000-4000-8000-000000000012';
  device_a uuid := gen_random_uuid();
  device_b uuid := gen_random_uuid();
  proof_a uuid := gen_random_uuid();
  proof_b uuid := gen_random_uuid();
  challenge uuid;
  correct_code text;
  wrong_code text;
  lease uuid := gen_random_uuid();
  mail_id uuid;
begin
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',first_session)::text,true);
  if not public.register_account_deletion_device(device_a,proof_a) or not public.register_account_deletion_device(device_b,proof_b)
    or public.register_account_deletion_device(device_b,proof_a) then raise exception 'Installation proof failed'; end if;
  if has_function_privilege('anon','public.confirm_account_deletion(uuid,text)','EXECUTE')
    or has_function_privilege('authenticated','public.process_account_deletions()','EXECUTE')
    or has_function_privilege('authenticated','public.claim_account_deletion_mail(uuid)','EXECUTE')
    or has_function_privilege('authenticated','shoppingapp_deletion.digest(text)','EXECUTE')
    or has_table_privilege('service_role','shoppingapp_deletion.mail','SELECT') then raise exception 'Private deletion data or worker exposed'; end if;

  challenge := (public.request_account_deletion(true)->>'id')::uuid;
  select code into correct_code from shoppingapp_deletion.mail where id=challenge;
  if public.request_account_deletion(false)->>'status'<>'wait' then raise exception 'Challenge rate limit failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',second_session)::text,true);
  if public.confirm_account_deletion(challenge,correct_code)<>'expired' then raise exception 'Challenge crossed sessions'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'session_id',first_session)::text,true);
  perform public.cancel_account_deletion(challenge);
  if public.confirm_account_deletion(challenge,correct_code)<>'expired' or public.account_deletion_status(a) then
    raise exception 'Cancelled challenge remained usable'; end if;
  update shoppingapp_deletion.challenges set requested_at=now()-interval '1 minute' where account_id=a;
  challenge := (public.request_account_deletion(true)->>'id')::uuid;
  select code into correct_code from shoppingapp_deletion.mail where id=challenge;
  wrong_code := case when correct_code='000000' then '000001' else '000000' end;
  for i in 1..4 loop
    if public.confirm_account_deletion(challenge,wrong_code)<>'invalid' then raise exception 'Wrong code not rejected'; end if;
  end loop;
  if public.confirm_account_deletion(challenge,wrong_code)<>'expired' or
    public.confirm_account_deletion(challenge,correct_code)<>'expired' or public.account_deletion_status(a) then
    raise exception 'Attempt limit failed'; end if;

  update shoppingapp_deletion.challenges set requested_at=now()-interval '1 minute' where account_id=a;
  challenge := (public.request_account_deletion(true)->>'id')::uuid;
  select code into correct_code from shoppingapp_deletion.mail where id=challenge;
  if public.confirm_account_deletion(challenge,correct_code)<>'deleted' then raise exception 'Confirmation failed'; end if;
  if public.confirm_account_deletion(challenge,correct_code)<>'deleted' then raise exception 'Confirmation replay failed'; end if;
  if not public.account_deletion_status(a) or public.account_deletion_status(b) then raise exception 'Deletion status failed'; end if;
  if exists (select from auth.sessions where user_id=a) or exists (select from auth.refresh_tokens where session_id=second_session)
    then raise exception 'Sessions and refresh tokens survived the block'; end if;
  perform set_config('request.path','/rpc/pull_account_feed',true);
  begin
    perform shoppingapp_deletion.api_guard();
    raise exception 'Old JWT still accesses the API';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.path','/rpc/account_deletion_status',true);
  perform shoppingapp_deletion.api_guard();

  -- An injected storage failure must leave the account blocked for the next worker.
  create function pg_temp.stop_deletion() returns trigger language plpgsql as $stop$
  begin
    if old.id='60000000-0000-4000-8000-000000000021' then raise exception 'Injected failure'; end if;
    return old;
  end;
  $stop$;
  create trigger stop_deletion before delete on public.shopping_lists
    for each row execute function pg_temp.stop_deletion();
  perform public.process_account_deletions();
  if (select completed_at from shoppingapp_deletion.tombstones where account_id=a) is not null then
    raise exception 'Partial failure acknowledged as complete'; end if;
  drop trigger stop_deletion on public.shopping_lists;
  update shoppingapp_deletion.tombstones set retry_at=now(),review_at=now()+interval '1 month'-interval '1 minute' where account_id=a;
  perform public.acknowledge_account_deletion(a,device_a,proof_a);
  perform public.acknowledge_account_deletion(a,device_b,proof_a);
  perform public.process_account_deletions();
  if exists (select from auth.users where id=a) or not exists(select from auth.users where id=b)
    or exists (select from public.shopping_lists where owner_id=a)
    or not exists(select from public.shopping_lists where owner_id=b)
    or exists (select from public.e4_archive_completions where owner_id=a) then raise exception 'Cloud cleanup or isolation failed'; end if;
  if not public.account_deletion_status(a) then raise exception 'Deletion marker lost'; end if;
  mail_id := (public.claim_account_deletion_mail(lease)->0->>'id')::uuid;
  if mail_id is null or public.claim_account_deletion_mail(gen_random_uuid())<>'[]'::jsonb then raise exception 'Reminder lease failed'; end if;
  if not public.reserve_account_deletion_reminder(mail_id,lease) then raise exception 'Reminder reservation failed'; end if;
  update shoppingapp_deletion.mail set available_at=now() where id=mail_id;
  if public.claim_account_deletion_mail(gen_random_uuid())<>'[]'::jsonb then
    raise exception 'Ambiguous SMTP delivery was automatically retried'; end if;
  perform public.retry_rejected_account_deletion_reminder(mail_id,lease);
  update shoppingapp_deletion.mail set available_at=now() where id=mail_id;
  if (public.claim_account_deletion_mail(lease)->0->>'id')::uuid is distinct from mail_id then
    raise exception 'Definite SMTP rejection could not be retried'; end if;
  if not public.reserve_account_deletion_reminder(mail_id,lease) then raise exception 'Retried reminder reservation failed'; end if;
  perform public.complete_account_deletion_mail(mail_id,lease);
  perform public.process_account_deletions();
  if exists(select from shoppingapp_deletion.reminders where account_id=a)
    or public.claim_account_deletion_mail(lease)<>'[]'::jsonb then raise exception 'Reminder repeated or address retained'; end if;
  perform public.acknowledge_account_deletion(a,device_b,proof_b);

  begin
    insert into auth.users(id,email) values (gen_random_uuid(),'A-DELETION@example.test');
    raise exception 'Cooldown bypassed';
  exception when check_violation then null;
  end;
  update shoppingapp_deletion.tombstones set completed_at=now()-interval '24 hours' where account_id=a;
  insert into auth.users(id,email) values (gen_random_uuid(),'a-deletion@example.test');
  perform public.process_account_deletions();
  -- Simulate Auth and session rows restored from a backup predating deletion.
  insert into auth.users(id,email) values (a,'restored-old-email@example.test');
  insert into auth.sessions(id,user_id) values(first_session,a);
  perform shoppingapp_deletion.rearm_restored_accounts();
  if exists (select from auth.sessions where user_id=a) then raise exception 'Restored session was not revoked'; end if;
  perform public.process_account_deletions();
  if exists (select from auth.users where id=a) then raise exception 'Restored old account survived'; end if;
  perform public.process_account_deletions();
  if not public.account_deletion_status(a) or
    (select email_key from shoppingapp_deletion.tombstones where account_id=a) is not null then
    raise exception 'Late status or email minimization failed'; end if;
end;
$$;

rollback;
