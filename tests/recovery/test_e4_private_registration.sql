begin;
insert into auth.users (id, email) values (gen_random_uuid(), 'already@example.test');
insert into shoppingapp_deletion.tombstones (account_id, completed_at, email_key)
  values (gen_random_uuid(), now(), shoppingapp_deletion.digest('email:blocked@example.test'));

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(api_role, 'public.registration_email_status(text)', 'execute') then
      raise exception 'Legacy status remains callable';
    end if;
    if api_role <> 'service_role' and (
      has_function_privilege(api_role, 'public.enqueue_private_registration(text,inet)', 'execute')
      or has_function_privilege(api_role, 'public.claim_private_registration_mail()', 'execute')
      or has_function_privilege(api_role, 'public.consume_private_registration_code(text,text)', 'execute')
    ) then raise exception 'Registration worker RPC exposed'; end if;
  end loop;
end $$;

set local role service_role;
do $$
declare
  job jsonb;
  code text;
  kinds jsonb := '{}'::jsonb;
begin
  if not public.enqueue_private_registration(' New@Example.test ', '192.0.2.1')
     or not public.enqueue_private_registration('already@example.test', '192.0.2.1')
     or not public.enqueue_private_registration('blocked@example.test', '192.0.2.1')
     or not public.enqueue_private_registration('new@example.test', '192.0.2.1')
  then raise exception 'Valid requests must share the same accepted response'; end if;
  if public.consume_private_registration_code('blocked@example.test', '123456')
     or public.consume_private_registration_code('new@example.test', '123456')
  then raise exception 'Code accepted before dispatch'; end if;
  for i in 1..3 loop
    job := public.claim_private_registration_mail();
    kinds := kinds || jsonb_build_object(job->>'email', job->>'kind');
    if job->>'kind' = 'code' then code := job->>'code';
    elsif job->>'code' is not null then raise exception 'Informational mail contains a code'; end if;
  end loop;
  if kinds <> '{"new@example.test":"code","already@example.test":"existing","blocked@example.test":"cooldown"}'
     or code is null or public.claim_private_registration_mail() is not null
  then raise exception 'Unexpected mail classification or duplicate dispatch'; end if;
  if public.consume_private_registration_code('already@example.test', code)
     or public.consume_private_registration_code('blocked@example.test', code)
     or not public.consume_private_registration_code(' New@Example.test ', code)
     or public.consume_private_registration_code('new@example.test', code)
  then raise exception 'Code binding or single use failed'; end if;
  perform public.enqueue_private_registration('attempts@example.test', '192.0.2.1');
  code := public.claim_private_registration_mail()->>'code';
  if code is null then raise exception 'Missing attempt limit fixture'; end if;
  for i in 1..5 loop
    if public.consume_private_registration_code('attempts@example.test', case code when '000000' then '000001' else '000000' end)
    then raise exception 'Wrong code accepted'; end if;
  end loop;
  if public.consume_private_registration_code('attempts@example.test', code)
  then raise exception 'Code accepted after attempt limit'; end if;
end $$;

reset role;
do $$
begin
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'blocked@example.test');
    raise exception 'Final Auth cooldown guard was bypassed';
  exception when check_violation then null;
  end;
end $$;
rollback;
