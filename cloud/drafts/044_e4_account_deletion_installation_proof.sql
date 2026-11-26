-- Coordinate with the client rollout. Previously expired installation
-- registrations cannot be recovered from the tombstone alone.
begin;

create function public.register_account_deletion_installation(p_account uuid, p_device uuid, p_proof uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_account is null or p_device is null or p_proof is null
     or auth.uid() is distinct from p_account then return false; end if;
  perform pg_advisory_xact_lock_shared(shoppingapp_deletion.lock_key(p_account));
  perform shoppingapp_deletion.session_id(p_account);
  insert into shoppingapp_deletion.devices as device (account_id, device_id, proof_hash)
    values (p_account, p_device, shoppingapp_deletion.digest('device:' || p_proof::text))
    on conflict (account_id, device_id) do update set proof_hash=excluded.proof_hash
    where device.proof_hash is distinct from excluded.proof_hash;
  return true;
end;
$$;

create function public.account_deletion_installation_status(p_account uuid, p_device uuid, p_proof uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when t.account_id is null then 'active' else 'deleted' end
    from shoppingapp_deletion.devices d
    left join shoppingapp_deletion.tombstones t on t.account_id=d.account_id
    where d.account_id=p_account and d.device_id=p_device
      and d.proof_hash=shoppingapp_deletion.digest('device:' || p_proof::text)
  ), 'unconfirmed')
$$;

create function public.acknowledge_account_deletion_installation(p_account uuid, p_device uuid, p_proof uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare cutoff timestamptz;
begin
  -- Verify the installation before acquiring the reminder lifecycle lock.
  if public.account_deletion_installation_status(p_account, p_device, p_proof) <> 'deleted'
    then return false; end if;
  select review_at into cutoff from shoppingapp_deletion.tombstones
    where account_id=p_account for update;
  if not found then return false; end if;
  if cutoff > now() then
    perform public.acknowledge_account_deletion(p_account, p_device, p_proof);
  end if;
  return true;
end;
$$;

create or replace function public.process_account_deletions() returns void
language plpgsql security definer set search_path = '' as $$
begin
  for i in 1..10 loop
    exit when not shoppingapp_deletion.finish_one();
  end loop;
  delete from shoppingapp_deletion.challenges where expires_at<=now() and requested_at<=now()-interval '1 minute';
  delete from shoppingapp_deletion.mail where expires_at<=now();
  update shoppingapp_deletion.tombstones set email_key=null
    where email_key is not null and completed_at + interval '24 hours' <= now();
  update shoppingapp_deletion.devices d set acknowledged_at=null
    from shoppingapp_deletion.tombstones t
    where d.account_id=t.account_id and t.review_at<=now() and d.acknowledged_at is not null;
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

revoke execute on function public.account_deletion_status(uuid),
  public.acknowledge_account_deletion(uuid,uuid,uuid),
  public.register_account_deletion_installation(uuid,uuid,uuid),
  public.account_deletion_installation_status(uuid,uuid,uuid),
  public.acknowledge_account_deletion_installation(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.register_account_deletion_installation(uuid,uuid,uuid) to authenticated;
grant execute on function public.account_deletion_installation_status(uuid,uuid,uuid),
  public.acknowledge_account_deletion_installation(uuid,uuid,uuid) to anon;

notify pgrst, 'reload schema';
commit;
