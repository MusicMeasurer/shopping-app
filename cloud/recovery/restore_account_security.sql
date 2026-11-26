-- Run with psql -X -q -v ON_ERROR_STOP=1 -v required_through=... -f this-file.
-- Feed the authenticated, decrypted export to stdin. Keep APIs and workers stopped.
begin;

create temp table security_export (payload jsonb not null) on commit drop;
\copy security_export from pstdin with (format csv)

create temp table recovery_cutoff (required_through timestamptz not null) on commit drop;
insert into recovery_cutoff values (:'required_through');

do $$
declare bundle jsonb;
declare captured timestamptz;
begin
  select payload into strict bundle from security_export;
  captured := (bundle->>'captured_at')::timestamptz;
  if bundle->>'version' is distinct from '1'
    or captured is null or captured > now()
    or captured < (select required_through from recovery_cutoff)
    or coalesce(bundle->>'keyring', '') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(bundle->'tombstones') is distinct from 'array'
    or jsonb_typeof(bundle->'devices') is distinct from 'array'
    or jsonb_typeof(bundle->'rate_windows') is distinct from 'array'
  then raise exception 'Invalid or stale account recovery checkpoint'; end if;
end;
$$;

create temp table recovered_tombstones (like shoppingapp_deletion.tombstones including all) on commit drop;
insert into recovered_tombstones
  select t.* from security_export,
    jsonb_populate_recordset(null::shoppingapp_deletion.tombstones, payload->'tombstones') t;

create temp table recovered_devices (
  account_id uuid not null, device_id uuid not null, proof_hash bytea not null,
  primary key (account_id, device_id)
) on commit drop;
insert into recovered_devices
  select d.account_id, d.device_id, d.proof_hash from security_export,
    jsonb_populate_recordset(null::shoppingapp_deletion.devices, payload->'devices') d;

do $$
begin
  if exists (
    select 1 from shoppingapp_deletion.tombstones t
    left join recovered_tombstones r using (account_id)
    where r.account_id is null or r.blocked_at <> t.blocked_at
  ) or exists (
    select 1 from recovered_devices d
    left join recovered_tombstones t using (account_id)
    where t.account_id is null or octet_length(d.proof_hash) <> 32
  ) then raise exception 'Inconsistent account recovery checkpoint'; end if;
  if (select count(*) from shoppingapp_deletion.keyring) <> 1
    or (select secret from shoppingapp_deletion.keyring) <>
      (select decode(payload->>'keyring', 'hex') from security_export)
  then raise exception 'Recovery keyring does not match the installed lineage'; end if;
end;
$$;

-- Cancel transient requests, including queued or leased mail. Require a fresh
-- request after recovery. Delivered/undelivered reminder state is ambiguous
-- across snapshots, so none of the restored reminders are reactivated.
truncate shoppingapp_deletion.challenges, shoppingapp_deletion.mail,
  shoppingapp_deletion.reminders, shoppingapp_registration.requests,
  shoppingapp_registration.rate_windows;

insert into shoppingapp_registration.rate_windows
  select w.* from security_export,
    jsonb_populate_recordset(null::shoppingapp_registration.rate_windows, payload->'rate_windows') w
  where w.starts_at > now() - interval '1 hour';

insert into shoppingapp_deletion.tombstones (account_id, blocked_at, completed_at, retry_at, review_at, email_key)
  select account_id, blocked_at, completed_at, now(), review_at,
    case when completed_at is null or completed_at + interval '24 hours' > now() then email_key end
  from recovered_tombstones
on conflict (account_id) do update
  set completed_at=excluded.completed_at, retry_at=excluded.retry_at,
      review_at=excluded.review_at, email_key=excluded.email_key;

-- The later checkpoint is authoritative for deleted accounts. Old proofs may
-- have been rotated before deletion. Keep registrations for unrelated accounts.
delete from shoppingapp_deletion.devices d using recovered_tombstones t where d.account_id=t.account_id;
insert into shoppingapp_deletion.devices (account_id, device_id, proof_hash)
  select account_id, device_id, proof_hash from recovered_devices;

select shoppingapp_deletion.rearm_restored_accounts();

do $$
begin
  -- Each known deletion needs at most one successful cleanup. An operation
  -- deferred for retry fails the cutover rather than hiding unfinished work.
  for attempt in 1..(select count(*) from recovered_tombstones) loop
    exit when not shoppingapp_deletion.finish_one();
  end loop;
  if exists (select 1 from shoppingapp_deletion.tombstones where completed_at is null)
    or exists (select 1 from auth.users u join recovered_tombstones t on t.account_id=u.id)
  then raise exception 'Account recovery cleanup incomplete'; end if;
end;
$$;

-- Repairing an old copy of an already completed deletion does not restart its
-- cooldown or change the original completion time from the authoritative copy.
update shoppingapp_deletion.tombstones t set completed_at=r.completed_at
  from recovered_tombstones r where t.account_id=r.account_id and r.completed_at is not null;

commit;
