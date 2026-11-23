-- Review and test in the integration lab before enabling the client.
begin;

create schema shoppingapp_deletion;
revoke all on schema shoppingapp_deletion from public, anon, authenticated;
grant usage on schema shoppingapp_deletion to authenticated;
alter default privileges in schema shoppingapp_deletion revoke execute on functions from public;

create table shoppingapp_deletion.keyring (
  singleton boolean primary key default true check (singleton),
  secret bytea not null
);
insert into shoppingapp_deletion.keyring (secret) values (extensions.gen_random_bytes(32));

create table shoppingapp_deletion.tombstones (
  account_id uuid primary key,
  blocked_at timestamptz not null default now(),
  completed_at timestamptz,
  retry_at timestamptz not null default now(),
  review_at timestamptz not null default (now() + interval '90 days'),
  email_key bytea
);
create index account_deletion_email on shoppingapp_deletion.tombstones(email_key) where email_key is not null;

create table shoppingapp_deletion.devices (
  account_id uuid not null,
  device_id uuid not null,
  proof_hash bytea not null,
  acknowledged_at timestamptz,
  primary key (account_id, device_id)
);

create table shoppingapp_deletion.challenges (
  account_id uuid primary key,
  id uuid not null unique,
  session_id uuid not null,
  code_key bytea not null,
  email_key bytea not null,
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  remind boolean not null
);

create table shoppingapp_deletion.reminders (
  account_id uuid primary key references shoppingapp_deletion.tombstones(account_id) on delete cascade,
  email text not null,
  mail_id uuid not null default gen_random_uuid()
);

create table shoppingapp_deletion.mail (
  id uuid primary key,
  account_id uuid not null,
  kind text not null check (kind in ('code', 'reminder')),
  email text not null,
  code text,
  available_at timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_id uuid,
  sending_started_at timestamptz,
  check ((kind = 'code') = (code is not null)),
  unique (account_id, kind)
);

revoke all on all tables in schema shoppingapp_deletion from public, anon, authenticated, service_role;

create function shoppingapp_deletion.digest(value text) returns bytea
language sql stable set search_path = '' as $$
  select extensions.hmac(convert_to(value, 'UTF8'), secret, 'sha256')
  from shoppingapp_deletion.keyring
$$;

create function shoppingapp_deletion.lock_key(account uuid) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('shopping-account-deletion:' || account::text, 0)
$$;

-- Used by both direct API requests and RLS (including Realtime row reads).
create function shoppingapp_deletion.account_is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
    select from shoppingapp_deletion.tombstones where account_id = auth.uid()
  )
$$;
create function shoppingapp_deletion.api_guard() returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  path text := current_setting('request.path', true);
begin
  if actor is null or path in ('/rpc/account_deletion_status', '/rpc/acknowledge_account_deletion',
    '/rpc/confirm_account_deletion', '/rpc/request_account_deletion', '/rpc/cancel_account_deletion',
    '/rpc/register_account_deletion_device') then return; end if;
  perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(actor));
  if not shoppingapp_deletion.account_is_active() then
    raise exception 'Account access revoked' using errcode = '42501';
  end if;
end;
$$;

-- PostgREST invokes the gate under the request role even for definer RPCs.
grant usage on schema shoppingapp_deletion to anon, service_role;
do $$
begin
  if exists (select from pg_db_role_setting s join pg_roles r on r.oid=s.setrole
    cross join lateral unnest(s.setconfig) setting
    where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%') then
    raise exception 'Review the existing PostgREST request gate before applying account deletion';
  end if;
end;
$$;
alter role authenticator set pgrst.db_pre_request = 'shoppingapp_deletion.api_guard';

do $$
declare table_name text;
begin
  for table_name in select c.relname from pg_class c where c.relnamespace='public'::regnamespace
      and c.relkind='r' and c.relrowsecurity and has_table_privilege('authenticated', c.oid, 'SELECT')
  loop
    execute format('create policy active_account_for_deletion on public.%I as restrictive for all to authenticated
      using ((select shoppingapp_deletion.account_is_active())) with check ((select shoppingapp_deletion.account_is_active()))', table_name);
  end loop;
  if to_regclass('realtime.messages') is not null then
    execute 'create policy active_account_for_deletion on realtime.messages as restrictive for select to authenticated
      using ((select shoppingapp_deletion.account_is_active()) or realtime.topic() = ''account-deletion:'' || (select auth.uid())::text)';
    execute 'create policy own_account_deletion_event on realtime.messages for select to authenticated
      using (extension = ''broadcast'' and realtime.topic() = ''account-deletion:'' || (select auth.uid())::text)';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'create policy active_account_for_deletion on storage.objects as restrictive for all to authenticated
      using ((select shoppingapp_deletion.account_is_active())) with check ((select shoppingapp_deletion.account_is_active()))';
  end if;
end;
$$;

create function shoppingapp_deletion.registration_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare email_digest bytea;
begin
  if new.email is null or (tg_op = 'UPDATE' and lower(btrim(new.email)) is not distinct from lower(btrim(old.email))) then
    return new;
  end if;
  email_digest := shoppingapp_deletion.digest('email:' || lower(btrim(new.email)));
  perform pg_advisory_xact_lock(hashtextextended(encode(email_digest, 'hex'), 0));
  if exists (select from shoppingapp_deletion.tombstones
    where email_key=email_digest and (completed_at is null or completed_at + interval '24 hours' > now())) then
    raise exception 'Account registration temporarily unavailable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger shoppingapp_registration_after_deletion
before insert or update of email on auth.users
for each row execute function shoppingapp_deletion.registration_guard();

create function shoppingapp_deletion.session_id(actor uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare identifier uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid;
begin
  if actor is null or identifier is null or not exists (
    select from auth.sessions where id=identifier and user_id=actor
  ) or not shoppingapp_deletion.account_is_active() then
    raise exception 'Active account session required' using errcode='42501';
  end if;
  return identifier;
end;
$$;

create function public.register_account_deletion_device(p_device uuid, p_proof uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if p_device is null or p_proof is null then raise exception 'Invalid installation'; end if;
  perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(actor));
  perform shoppingapp_deletion.session_id(actor);
  insert into shoppingapp_deletion.devices(account_id, device_id, proof_hash)
    values(actor, p_device, shoppingapp_deletion.digest('device:' || p_proof::text)) on conflict do nothing;
  return exists (select from shoppingapp_deletion.devices where account_id=actor and device_id=p_device
    and proof_hash=shoppingapp_deletion.digest('device:' || p_proof::text));
end;
$$;

create function public.account_deletion_status(p_account uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select from shoppingapp_deletion.tombstones where account_id=p_account)
$$;

create function public.acknowledge_account_deletion(p_account uuid, p_device uuid, p_proof uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize the final acknowledgment with a worker claiming its reminder.
  perform 1 from shoppingapp_deletion.tombstones where account_id=p_account for update;
  if not found then return; end if;
  update shoppingapp_deletion.devices set acknowledged_at=now()
    where account_id=p_account and device_id=p_device and acknowledged_at is null
      and proof_hash=shoppingapp_deletion.digest('device:' || p_proof::text);
  if not exists (select from shoppingapp_deletion.devices where account_id=p_account and acknowledged_at is null) then
    delete from shoppingapp_deletion.reminders where account_id=p_account;
    delete from shoppingapp_deletion.mail where account_id=p_account and kind='reminder';
  end if;
end;
$$;

create function public.request_account_deletion(p_remind boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  sid uuid;
  account_email text;
  challenge_id uuid := gen_random_uuid();
  random_bytes bytea := extensions.gen_random_bytes(3);
  code text := lpad(((get_byte(random_bytes,0) * 65536 + get_byte(random_bytes,1) * 256 + get_byte(random_bytes,2)) % 1000000)::text, 6, '0');
  expiry timestamptz := now() + interval '10 minutes';
  previous shoppingapp_deletion.challenges;
begin
  perform pg_advisory_xact_lock(shoppingapp_deletion.lock_key(actor));
  sid := shoppingapp_deletion.session_id(actor);
  select * into previous from shoppingapp_deletion.challenges where account_id=actor;
  if previous.requested_at > now() - interval '1 minute' then
    return jsonb_build_object('status','wait');
  end if;
  select email into account_email from auth.users where id=actor and email_confirmed_at is not null;
  if account_email is null then raise exception 'Confirmed email required' using errcode='42501'; end if;
  delete from shoppingapp_deletion.mail where account_id=actor and kind='code';
  delete from shoppingapp_deletion.challenges where account_id=actor;
  insert into shoppingapp_deletion.challenges(account_id,id,session_id,code_key,email_key,expires_at,remind)
    values(actor,challenge_id,sid,shoppingapp_deletion.digest(challenge_id::text || ':' || code),
      shoppingapp_deletion.digest('email:' || lower(btrim(account_email))),expiry,coalesce(p_remind,false));
  insert into shoppingapp_deletion.mail(id,account_id,kind,email,code,expires_at)
    values(challenge_id,actor,'code',account_email,code,expiry);
  return jsonb_build_object('status','requested','id',challenge_id,'expiresAt',expiry);
end;
$$;

create function public.cancel_account_deletion(p_challenge uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  perform pg_advisory_xact_lock(shoppingapp_deletion.lock_key(actor));
  update shoppingapp_deletion.challenges set expires_at=least(expires_at,now())
    where account_id=actor and id=p_challenge and session_id=shoppingapp_deletion.session_id(actor);
  if found then delete from shoppingapp_deletion.mail where id=p_challenge and kind='code'; end if;
end;
$$;

create function shoppingapp_deletion.revoke_account(actor uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update auth.users set banned_until='infinity'::timestamptz where id=actor;
  delete from auth.sessions where user_id=actor;
  delete from public.siri_shortcut_credentials where owner_id=actor;
  delete from public.siri_pairing_requests where owner_id=actor;
end;
$$;

create function public.confirm_account_deletion(p_challenge uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  sid uuid;
  challenge shoppingapp_deletion.challenges;
  account_email text;
  email_digest bytea;
begin
  if actor is null then raise exception 'Active account session required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(shoppingapp_deletion.lock_key(actor));
  if not shoppingapp_deletion.account_is_active() then return 'deleted'; end if;
  sid := shoppingapp_deletion.session_id(actor);
  select * into challenge from shoppingapp_deletion.challenges where account_id=actor;
  if challenge.id is distinct from p_challenge or challenge.session_id is distinct from sid then return 'expired'; end if;
  if challenge.expires_at <= now() or challenge.attempts >= 5 then return 'expired'; end if;
  if p_code is null or p_code !~ '^[0-9]{6}$'
    or challenge.code_key <> shoppingapp_deletion.digest(challenge.id::text || ':' || p_code) then
    update shoppingapp_deletion.challenges set attempts=attempts+1 where account_id=actor;
    return case when challenge.attempts=4 then 'expired' else 'invalid' end;
  end if;

  select email into account_email from auth.users where id=actor for update;
  email_digest := shoppingapp_deletion.digest('email:' || lower(btrim(account_email)));
  if email_digest is distinct from challenge.email_key then return 'expired'; end if;
  perform pg_advisory_xact_lock(hashtextextended(encode(email_digest, 'hex'), 0));
  insert into shoppingapp_deletion.tombstones(account_id,email_key) values(actor,email_digest);
  if challenge.remind and exists (select from shoppingapp_deletion.devices where account_id=actor) then
    insert into shoppingapp_deletion.reminders(account_id,email) values(actor,account_email);
  end if;
  delete from shoppingapp_deletion.challenges where account_id=actor;
  delete from shoppingapp_deletion.mail where account_id=actor and kind='code';
  perform shoppingapp_deletion.revoke_account(actor);
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    perform realtime.send('{}'::jsonb, 'account_deleted', 'account-deletion:' || actor::text, true);
  end if;
  return 'deleted';
end;
$$;

-- One durable operation per account. A failed cleanup rolls back its data changes
-- while keeping the separately committed access block and scheduling a retry.
create function shoppingapp_deletion.finish_one() returns boolean
language plpgsql set search_path = '' as $$
declare
  actor uuid;
  recipient uuid;
  row record;
begin
  select account_id into actor from shoppingapp_deletion.tombstones
    where completed_at is null and retry_at <= now() order by retry_at,account_id limit 1 for update skip locked;
  if actor is null then return false; end if;
  begin
    if to_regclass('storage.objects') is not null then
      if exists (select from storage.objects where owner_id=actor::text) then
        raise exception 'Account owns Storage objects outside the shopping data contract';
      end if;
    end if;
    for row in select l.id,l.owner_id from public.shopping_lists l where l.owner_id=actor or exists (
      select from public.list_members m where m.list_id=l.id and m.user_id=actor
    ) order by l.id for update loop
      if row.owner_id=actor then
        select m.user_id into recipient from public.list_members m
          where m.list_id=row.id and m.user_id<>actor
            and not exists (select from shoppingapp_deletion.tombstones t where t.account_id=m.user_id)
          order by m.joined_at,m.user_id limit 1;
        if recipient is null then
          delete from public.shopping_lists where id=row.id;
        else
          delete from public.list_members where list_id=row.id and user_id=recipient;
          update public.shopping_lists set owner_id=recipient where id=row.id;
          delete from public.list_invitation_links where list_id=row.id and accepted_at is null and revoked_at is null;
          insert into public.ownership_events(list_id,old_owner,new_owner,reason)
            values(row.id,actor,recipient,'account_deletion');
          insert into public.user_notifications(recipient_id,list_id,event_type,payload)
            values(recipient,row.id,'ownership_received',jsonb_build_object('list_id',row.id,'reason','account_deletion'));
        end if;
      end if;
      delete from public.list_members where list_id=row.id and user_id=actor;
    end loop;
    delete from auth.users where id=actor;
    update shoppingapp_deletion.tombstones set completed_at=clock_timestamp() where account_id=actor;
  exception when others then
    update shoppingapp_deletion.tombstones set retry_at=now() + interval '1 minute' where account_id=actor;
    raise log 'ShoppingApp account cleanup will retry (SQLSTATE %)', sqlstate;
  end;
  return true;
end;
$$;

-- Restore while the stack is closed to clients. Merge the independent
-- deletion ledger before rearming accounts resurrected by a backup.
create function shoppingapp_deletion.rearm_restored_accounts() returns void
language plpgsql set search_path = '' as $$
declare actor uuid;
begin
  for actor in select t.account_id from shoppingapp_deletion.tombstones t
    join auth.users u on u.id=t.account_id order by t.account_id
  loop
    perform pg_advisory_xact_lock(shoppingapp_deletion.lock_key(actor));
    perform shoppingapp_deletion.revoke_account(actor);
    update shoppingapp_deletion.tombstones set completed_at=null,retry_at=now() where account_id=actor;
  end loop;
end;
$$;

create function public.process_account_deletions() returns void
language plpgsql security definer set search_path = '' as $$
begin
  for i in 1..10 loop
    exit when not shoppingapp_deletion.finish_one();
  end loop;
  delete from shoppingapp_deletion.challenges where expires_at<=now() and requested_at<=now()-interval '1 minute';
  delete from shoppingapp_deletion.mail where expires_at<=now();
  update shoppingapp_deletion.tombstones set email_key=null
    where email_key is not null and completed_at + interval '24 hours' <= now();
  delete from shoppingapp_deletion.devices d using shoppingapp_deletion.tombstones t
    where d.account_id=t.account_id and t.review_at<=now();
  delete from shoppingapp_deletion.reminders r using shoppingapp_deletion.tombstones t
    where r.account_id=t.account_id and t.review_at - interval '1 month' + interval '23 hours' <= now();
  insert into shoppingapp_deletion.mail(id,account_id,kind,email,expires_at)
    select r.mail_id,r.account_id,'reminder',r.email,t.review_at - interval '1 month' + interval '23 hours'
    from shoppingapp_deletion.reminders r join shoppingapp_deletion.tombstones t using(account_id)
    where t.completed_at is not null and t.review_at - interval '1 month' <= now()
      and exists (select from shoppingapp_deletion.devices d where d.account_id=r.account_id and d.acknowledged_at is null)
    on conflict (account_id,kind) do nothing;
end;
$$;

create function public.claim_account_deletion_mail(p_lease uuid) returns jsonb
language sql security definer set search_path = '' as $$
  with due as (
    select id from shoppingapp_deletion.mail where p_lease is not null and available_at<=now() and expires_at>now() and sending_started_at is null
      order by available_at,id limit 20 for update skip locked
  ), leased as (
    update shoppingapp_deletion.mail m set available_at=now() + interval '1 minute',lease_id=p_lease
      from due where m.id=due.id returning m.id,m.kind,m.email,m.code
  )
  select coalesce(jsonb_agg(to_jsonb(leased)), '[]'::jsonb) from leased
$$;

-- SMTP cannot deduplicate a delivery if its final response is lost.
-- Reserve reminders before sending. Only an explicit non-delivery permits retry.
create function public.reserve_account_deletion_reminder(p_job uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update shoppingapp_deletion.mail set sending_started_at=now()
    where id=p_job and lease_id=p_lease and kind='reminder' and expires_at>now() and sending_started_at is null;
  return found;
end;
$$;

create function public.retry_rejected_account_deletion_reminder(p_job uuid,p_lease uuid) returns void
language sql security definer set search_path = '' as $$
  update shoppingapp_deletion.mail set sending_started_at=null,available_at=now()+interval '1 minute'
    where id=p_job and lease_id=p_lease and kind='reminder'
$$;

create function public.complete_account_deletion_mail(p_job uuid,p_lease uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare job shoppingapp_deletion.mail;
begin
  delete from shoppingapp_deletion.mail where id=p_job and lease_id=p_lease returning * into job;
  if job.kind='reminder' then delete from shoppingapp_deletion.reminders where account_id=job.account_id; end if;
end;
$$;

revoke execute on all functions in schema shoppingapp_deletion from public,anon,authenticated,service_role;
grant execute on function shoppingapp_deletion.api_guard() to anon,authenticated,service_role;
grant execute on function shoppingapp_deletion.account_is_active() to authenticated;
revoke execute on function public.register_account_deletion_device(uuid,uuid), public.account_deletion_status(uuid),
  public.acknowledge_account_deletion(uuid,uuid,uuid),public.request_account_deletion(boolean),
  public.cancel_account_deletion(uuid), public.confirm_account_deletion(uuid,text), public.process_account_deletions(),
  public.claim_account_deletion_mail(uuid), public.reserve_account_deletion_reminder(uuid,uuid),
  public.retry_rejected_account_deletion_reminder(uuid,uuid), public.complete_account_deletion_mail(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.register_account_deletion_device(uuid,uuid),public.request_account_deletion(boolean),
  public.cancel_account_deletion(uuid),public.confirm_account_deletion(uuid,text) to authenticated;
grant execute on function public.account_deletion_status(uuid),public.acknowledge_account_deletion(uuid,uuid,uuid)
  to anon,authenticated;
grant execute on function public.process_account_deletions(),public.claim_account_deletion_mail(uuid),
  public.complete_account_deletion_mail(uuid,uuid) to service_role;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
commit;
