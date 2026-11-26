do $$
declare old_account constant uuid := '62000000-0000-4000-8000-000000000001';
begin
  if exists (select 1 from auth.users where id=old_account)
    or exists (select 1 from auth.sessions where user_id=old_account)
    or exists (select 1 from auth.refresh_tokens where session_id='62000000-0000-4000-8000-000000000011')
    or exists (select 1 from public.shopping_lists where owner_id=old_account)
    or not exists (select 1 from shoppingapp_deletion.tombstones
      where account_id=old_account and completed_at < now()-interval '98 days')
  then raise exception 'Restored deleted account or credentials survived'; end if;
  if (select count(*) from auth.users where id in ('62000000-0000-4000-8000-000000000002',
    '62000000-0000-4000-8000-000000000003')) <> 2
    or not exists (select 1 from public.shopping_lists where id='62000000-0000-4000-8000-000000000022')
  then raise exception 'Independent account, list or UUID changed'; end if;
  perform set_config('request.jwt.claim.sub',old_account::text,true);
  perform set_config('request.path','/rpc/push_e4_account_changes',true);
  begin
    perform shoppingapp_deletion.api_guard();
    raise exception 'Revoked account could resume its old queue';
  exception when insufficient_privilege then null; end;
end $$;

set role anon;
do $$ begin
  if public.account_deletion_installation_status('62000000-0000-4000-8000-000000000001',
    '62000000-0000-4000-8000-000000000031','62000000-0000-4000-8000-000000000041') <> 'deleted'
  then raise exception 'Late installation proof missing'; end if;
end $$;
reset role;

set role service_role;
do $$ begin
  perform public.process_account_deletions();
  if public.claim_account_deletion_mail(gen_random_uuid()) <> '[]'::jsonb
    or public.claim_private_registration_mail() is not null
    or public.consume_private_registration_code('registered-recovery@example.test', '123456')
  then raise exception 'Restored mail or code became usable'; end if;
  perform public.enqueue_private_registration('limited-recovery@example.test','192.0.2.1');
  if public.claim_private_registration_mail() is not null
  then raise exception 'Restoring a snapshot reset the rate limit'; end if;
  perform public.enqueue_private_registration('fresh-recovery@example.test','192.0.2.1');
  if public.claim_private_registration_mail()->>'kind' is distinct from 'code'
  then raise exception 'Fresh enrollment after recovery failed'; end if;
end $$;
reset role;
