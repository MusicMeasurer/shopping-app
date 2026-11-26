-- A1: PostgreSQL infinity cannot be scanned into Go time.Time by managed Auth.
-- A finite 876000-hour ban mirrors the documented long-duration Auth ban.
-- Tombstones, session revocation and cleanup (including restore) remain mandatory.
begin;
create or replace function shoppingapp_deletion.revoke_account(actor uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update auth.users
    set banned_until=case
      when banned_until is null or not isfinite(banned_until)
        then now()+interval '876000 hours'
      else greatest(banned_until,now()+interval '876000 hours')
    end
    where id=actor;
  delete from auth.sessions where user_id=actor;
  delete from public.siri_shortcut_credentials where owner_id=actor;
  delete from public.siri_pairing_requests where owner_id=actor;
end;
$$;

-- Repair only a previously deleted account that still has an Auth row.
-- No unrelated administrator ban is changed.
update auth.users u
  set banned_until=now()+interval '876000 hours'
  where u.banned_until='infinity'::timestamptz
    and exists (select 1 from shoppingapp_deletion.tombstones t where t.account_id=u.id);
commit;
