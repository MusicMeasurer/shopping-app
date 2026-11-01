-- REVIEW ONLY: NOT APPROVED FOR DEPLOYMENT. Apply after 001-016 in disposable DB.
-- Single-use, first authenticated explicit claimant. No recipient binding.
create table public.list_invitation_links (
 id uuid primary key default gen_random_uuid(),
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 token_hash text not null unique,
 -- Invitation records are ephemeral; remove them if the issuer deletes their account.
 created_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 accepted_at timestamptz,
 -- Delete accepted invitation history if the accepting account is deleted.
 accepted_by uuid references auth.users(id) on delete cascade,
 revoked_at timestamptz,
 check (expires_at > created_at),
 check ((accepted_at is null) = (accepted_by is null))
);
create index list_invitation_links_list_idx on public.list_invitation_links(list_id);
alter table public.list_invitation_links enable row level security;
revoke all on public.list_invitation_links from public, anon, authenticated;
-- This draft requires pgcrypto gen_random_bytes/digest to be available in extensions.
create or replace function public.create_list_invitation_link(p_list uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_token text;
        v_now timestamptz;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'READ COMMITTED required' using errcode='0A000';
 end if;
 if v_actor is null or p_list is null then raise exception 'Permission denied'; end if;
 perform 1 from public.shopping_lists
  where id=p_list and owner_id=v_actor and deleted_at is null for update;
 if not found then raise exception 'Permission denied'; end if;
 -- The list row lock serializes concurrent issuers for this list.
 v_now := clock_timestamp();
 if (select count(*) from public.list_invitation_links
     where list_id=p_list and accepted_at is null and revoked_at is null
       and expires_at > v_now) >= 10 then
  raise exception 'Too many pending invitations';
 end if;
 v_token := encode(extensions.gen_random_bytes(32),'hex');
 insert into public.list_invitation_links(list_id,token_hash,created_by,created_at,expires_at)
 values(p_list,encode(extensions.digest(v_token,'sha256'),'hex'),v_actor,v_now,v_now+interval '24 hours');
 return v_token;
end;
$$;
create or replace function public.accept_list_invitation_link(p_token text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_hash text; v_list uuid; v_inv public.list_invitation_links%rowtype; v_owner uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'READ COMMITTED required' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null or length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
  raise exception 'Invalid invitation';
 end if;
 v_hash := encode(extensions.digest(p_token,'sha256'),'hex');
 -- First read is untrusted; lock the list before locking the invitation to
 -- serialize with transfer/revocation and avoid inverted lock order.
 select list_id into v_list from public.list_invitation_links where token_hash=v_hash;
 if v_list is null then raise exception 'Invalid invitation'; end if;
 select owner_id into v_owner from public.shopping_lists
  where id=v_list and deleted_at is null for update;
 if not found then raise exception 'Invalid invitation'; end if;
 select * into v_inv from public.list_invitation_links
  where token_hash=v_hash and list_id=v_list for update;
 if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null
  or v_inv.expires_at <= clock_timestamp() or v_inv.created_by <> v_owner or v_actor=v_owner then
  raise exception 'Invalid invitation';
 end if;
 if exists (select 1 from public.list_members where list_id=v_list and user_id=v_actor) then
  raise exception 'Invalid invitation';
 end if;
 insert into public.list_members(list_id,user_id) values(v_list,v_actor);
 update public.list_invitation_links
  set accepted_at=clock_timestamp(),accepted_by=v_actor where id=v_inv.id;
 return v_list;
end;
$$;
create or replace function public.revoke_list_invitation_link(p_invitation uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'READ COMMITTED required' using errcode='0A000';
 end if;
 if v_actor is null or p_invitation is null then raise exception 'Permission denied'; end if;
 select list_id into v_list from public.list_invitation_links where id=p_invitation;
 if v_list is null then raise exception 'Permission denied'; end if;
 perform 1 from public.shopping_lists where id=v_list and owner_id=v_actor
  and deleted_at is null for update;
 if not found then raise exception 'Permission denied'; end if;
 update public.list_invitation_links set revoked_at=clock_timestamp()
  where id=p_invitation and list_id=v_list and accepted_at is null and revoked_at is null;
end;
$$;
-- Preserve 016 transfer contract; revoke pending links in same transaction.
create or replace function public.transfer_list_ownership(p_list uuid,p_new_owner uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_old_owner uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'READ COMMITTED required' using errcode='0A000';
 end if;
 if v_actor is null or p_list is null or p_new_owner is null then
  raise exception 'Missing actor or identifiers';
 end if;
 select owner_id into v_old_owner from public.shopping_lists
  where id=p_list and deleted_at is null for update;
 if not found or v_old_owner <> v_actor then raise exception 'Only current owner can transfer'; end if;
 if p_new_owner=v_old_owner or not exists (
  select 1 from public.list_members where list_id=p_list and user_id=p_new_owner
 ) then raise exception 'New owner must be a current member'; end if;
 update public.list_invitation_links set revoked_at=clock_timestamp()
  where list_id=p_list and accepted_at is null and revoked_at is null;
 delete from public.list_members where list_id=p_list and user_id=p_new_owner;
 update public.shopping_lists set owner_id=p_new_owner where id=p_list;
 insert into public.list_members(list_id,user_id) values(p_list,v_old_owner);
 insert into public.ownership_events(list_id,old_owner,new_owner,reason)
  values(p_list,v_old_owner,p_new_owner,'voluntary');
 insert into public.user_notifications(recipient_id,list_id,event_type,payload)
  values(p_new_owner,p_list,'ownership_received',
   jsonb_build_object('list_id',p_list,'previous_owner',v_old_owner));
end;
$$;
revoke all on function public.create_list_invitation_link(uuid) from public,anon;
revoke all on function public.accept_list_invitation_link(text) from public,anon;
revoke all on function public.revoke_list_invitation_link(uuid) from public,anon;
grant execute on function public.create_list_invitation_link(uuid) to authenticated;
grant execute on function public.accept_list_invitation_link(text) to authenticated;
grant execute on function public.revoke_list_invitation_link(uuid) to authenticated;
-- SECURITY REVIEW REQUIRED: token return exposure, extension schema,
-- role grants, information leakage, account deletion and concurrent operations.

-- Audit follow-up: owner-only invitation inventory, no tokens or hashes exposed.
create or replace function public.list_pending_invitation_links(p_list uuid)
returns table(invitation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
 if auth.uid() is null then raise exception 'Permission denied'; end if;
 perform 1 from public.shopping_lists where id=p_list and owner_id=auth.uid() and deleted_at is null for update;
 if not found then raise exception 'Permission denied'; end if;
 return query select i.id,i.expires_at from public.list_invitation_links i
 where i.list_id=p_list and i.accepted_at is null and i.revoked_at is null
 and i.expires_at > clock_timestamp() order by i.created_at;
end;
$$;
revoke all on function public.list_pending_invitation_links(uuid) from public,anon;
grant execute on function public.list_pending_invitation_links(uuid) to authenticated;
