-- Deploy with the registration Edge Function, updated mail worker and disabled
-- public Auth signup. Keep the existing Auth registration_guard in force.
begin;

create schema shoppingapp_registration;
revoke all on schema shoppingapp_registration from public, anon, authenticated, service_role;

create table shoppingapp_registration.requests (
  email_key bytea primary key,
  email text,
  requested_at timestamptz not null,
  expires_at timestamptz not null,
  code_key bytea,
  attempts integer not null default 0
);

create table shoppingapp_registration.rate_windows (
  bucket bytea primary key,
  starts_at timestamptz not null,
  requests integer not null
);

create function shoppingapp_registration.allow_request(bucket_name text, maximum integer, duration interval)
returns boolean language sql set search_path = '' as $$
  insert into shoppingapp_registration.rate_windows as rate (bucket, starts_at, requests)
    values (shoppingapp_deletion.digest('registration-rate:' || bucket_name), now(), 1)
  on conflict (bucket) do update
    set starts_at = case when rate.starts_at + duration <= now() then now() else rate.starts_at end,
        requests = case when rate.starts_at + duration <= now() then 1 else rate.requests + 1 end
    where rate.starts_at + duration <= now() or rate.requests < maximum
  returning true
$$;

create function public.enqueue_private_registration(p_email text, p_source inet)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(btrim(p_email));
begin
  if address is null or length(address) > 254 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or p_source is null then
    return false;
  end if;
  if not coalesce(shoppingapp_registration.allow_request(
       'source:' || network(set_masklen(p_source, case family(p_source) when 6 then 64 else 32 end))::text,
       8, interval '10 minutes'), false) then
    return true;
  end if;
  if not coalesce(shoppingapp_registration.allow_request('email:' || address, 1, interval '1 minute'), false)
     or not coalesce(shoppingapp_registration.allow_request('hour:' || address, 3, interval '1 hour'), false)
     or not coalesce(shoppingapp_registration.allow_request('global', 20, interval '1 hour'), false) then
    return true;
  end if;
  insert into shoppingapp_registration.requests (email_key, email, requested_at, expires_at)
    values (shoppingapp_deletion.digest('email:' || address), address, now(), now() + interval '10 minutes')
  on conflict (email_key) do update
    set email = excluded.email, requested_at = excluded.requested_at,
        expires_at = excluded.expires_at, code_key = null, attempts = 0;
  return true;
end;
$$;

create function public.claim_private_registration_mail()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job shoppingapp_registration.requests;
  secret_bytes bytea;
  code text;
  kind text;
begin
  delete from shoppingapp_registration.requests where expires_at <= now();
  delete from shoppingapp_registration.rate_windows where starts_at <= now() - interval '1 hour';
  select * into job from shoppingapp_registration.requests
    where email is not null order by requested_at limit 1 for update skip locked;
  if not found then return null; end if;

  if exists (select 1 from shoppingapp_deletion.tombstones
    where email_key = job.email_key and (completed_at is null or completed_at + interval '24 hours' > now())) then
    kind := 'cooldown';
  elsif exists (select 1 from auth.users where lower(btrim(email)) = job.email and deleted_at is null) then
    kind := 'existing';
  else
    kind := 'code';
  end if;
  -- Informational mail gets an unreachable digest so invalid confirmations
  -- take the same database path without issuing a usable code.
  secret_bytes := extensions.gen_random_bytes(3);
  code := lpad(((get_byte(secret_bytes, 0) * 65536 + get_byte(secret_bytes, 1) * 256
    + get_byte(secret_bytes, 2)) % 1000000)::text, 6, '0');
  update shoppingapp_registration.requests set email = null,
    code_key = shoppingapp_deletion.digest((case when kind = 'code' then 'registration-code:' else 'registration-decoy:' end)
      || encode(job.email_key, 'hex') || ':' || code)
    where email_key = job.email_key;
  return jsonb_build_object('email', job.email, 'kind', kind, 'code', case when kind = 'code' then code end);
end;
$$;

create function public.consume_private_registration_code(p_email text, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  address text := lower(btrim(p_email));
  key bytea;
  submitted bytea;
  matched boolean;
begin
  if address is null or length(address) > 254 or p_code is null or p_code !~ '^[0-9]{6}$' then
    return false;
  end if;
  key := shoppingapp_deletion.digest('email:' || address);
  submitted := shoppingapp_deletion.digest('registration-code:' || encode(key, 'hex') || ':' || p_code);
  -- Capture the match before clearing the one-time code in the same update.
  with candidate as materialized (
    select email_key, code_key from shoppingapp_registration.requests
    where email_key = key and expires_at > now() and attempts < 5 and code_key is not null
    for update
  )
  update shoppingapp_registration.requests as request
    set attempts = attempts + 1,
        code_key = case when candidate.code_key = submitted or attempts = 4 then null else request.code_key end
    from candidate where request.email_key = candidate.email_key
    returning candidate.code_key = submitted into matched;
  return coalesce(matched, false);
end;
$$;

revoke execute on function shoppingapp_registration.allow_request(text, integer, interval) from public, anon, authenticated, service_role;
revoke execute on function public.registration_email_status(text) from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_private_registration(text, inet),
  public.claim_private_registration_mail(), public.consume_private_registration_code(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_private_registration(text, inet),
  public.claim_private_registration_mail(), public.consume_private_registration_code(text, text) to service_role;

notify pgrst, 'reload schema';
commit;
