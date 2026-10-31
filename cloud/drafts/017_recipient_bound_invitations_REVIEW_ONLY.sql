-- ShoppingApp migration 017 DRAFT: recipient-bound, one-use invitations.
-- Review only. DO NOT execute until independently reviewed and approved.
-- Product decision 2026-10-31: in-app inbox and sent invitations,
-- explicit accept/decline, owner revoke; no push notifications in current scope.
-- Approved 3-second server-side grace window: accept requests do not grant
-- membership; owner may revoke before finalization. Finalization is explicit
-- and retryable. This guarantees revoke priority DURING THE PENDING WINDOW,
-- not for a network-delayed revoke arriving after finalization.
-- REVIEW ONLY: no concurrent tests or live database validation yet.
-- A committed acceptance predating a revoke request is a membership removal,
-- not a retroactive invitation revoke. Recipient discovery UX remains open.
-- Depends on installed 001..016. All invitation mutations take the list lock first.
create table public.list_invitations (
 token uuid primary key default gen_random_uuid(),
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 accepted_at timestamptz,
 revoked_at timestamptz,
 declined_at timestamptz,
 accept_requested_at timestamptz,
 finalize_after timestamptz,
 constraint invitation_expiry check (expires_at > created_at),
 constraint invitation_pending_pair check ((accept_requested_at is null) = (finalize_after is null)),
 constraint invitation_terminal check (
   (case when accepted_at is null then 0 else 1 end) +
   (case when revoked_at is null then 0 else 1 end) +
   (case when declined_at is null then 0 else 1 end) <= 1
 )
);
create index list_invitations_list_idx on public.list_invitations(list_id);
alter table public.list_invitations enable row level security;
revoke all on public.list_invitations from public, anon, authenticated;
-- No client table grants or RLS policies: access exclusively through RPCs.

create or replace function public.create_list_invitation(p_list uuid, p_recipient uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_owner uuid; v_token uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
   raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_list is null or p_recipient is null then
   raise exception 'Missing actor or identifiers';
 end if;
 select owner_id into v_owner from public.shopping_lists
   where id=p_list and deleted_at is null for update;
 if not found or v_owner <> v_actor then raise exception 'List unavailable'; end if;
 if p_recipient=v_actor then raise exception 'Owner cannot invite self'; end if;
 if not exists (select 1 from auth.users where id=p_recipient) then
   raise exception 'Recipient unavailable';
 end if;
 if exists (select 1 from public.list_members where list_id=p_list and user_id=p_recipient) then
   raise exception 'Already a member';
 end if;
 -- Revoke older pending invitations to this same recipient for this list.
 update public.list_invitations set revoked_at=now()
   where list_id=p_list and recipient_id=p_recipient
     and accepted_at is null and revoked_at is null and declined_at is null;
 insert into public.list_invitations(list_id,recipient_id,created_by,expires_at)
 values(p_list,p_recipient,v_actor,now()+interval '24 hours')
 returning token into v_token;
 return v_token;
end;
$$;

-- Phase 1: request acceptance, never grant membership here.
create or replace function public.accept_list_invitation(p_token uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid; v_inv public.list_invitations%rowtype;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null then raise exception 'Invitation unavailable'; end if;
 select list_id into v_list from public.list_invitations
  where token=p_token and recipient_id=v_actor;
 if not found then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.shopping_lists where id=v_list and deleted_at is null for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 select * into v_inv from public.list_invitations where token=p_token for update;
 if not found or v_inv.recipient_id<>v_actor or v_inv.revoked_at is not null
    or v_inv.declined_at is not null or v_inv.accepted_at is not null
    or v_inv.expires_at<=clock_timestamp() then
  raise exception 'Invitation unavailable';
 end if;
 if v_inv.accept_requested_at is null then
  update public.list_invitations
   set accept_requested_at=clock_timestamp(),
       finalize_after=clock_timestamp()+interval '3 seconds'
   where token=p_token returning finalize_after into v_inv.finalize_after;
 end if;
 return v_inv.finalize_after;
end;
$$;

-- Phase 2: recipient-triggered, retryable finalization. The list lock serializes
-- with owner revoke. A revoke that commits before finalization wins.
create or replace function public.finalize_list_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid; v_inv public.list_invitations%rowtype;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null then raise exception 'Invitation unavailable'; end if;
 select list_id into v_list from public.list_invitations
  where token=p_token and recipient_id=v_actor;
 if not found then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.shopping_lists where id=v_list and deleted_at is null for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 select * into v_inv from public.list_invitations where token=p_token for update;
 if not found or v_inv.recipient_id<>v_actor or v_inv.revoked_at is not null
   or v_inv.declined_at is not null then raise exception 'Invitation unavailable'; end if;
 if v_inv.accepted_at is not null then return v_list; end if;
 if v_inv.finalize_after is null or clock_timestamp()<v_inv.finalize_after
   or v_inv.expires_at<=clock_timestamp() then
  raise exception 'Invitation not ready or expired';
 end if;
 insert into public.list_members(list_id,user_id) values(v_list,v_actor)
  on conflict do nothing;
 update public.list_invitations set accepted_at=clock_timestamp() where token=p_token;
 return v_list;
end;
$$;

create or replace function public.revoke_list_invitation(p_token uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid; v_owner uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
   raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null then raise exception 'Invitation unavailable'; end if;
 select list_id into v_list from public.list_invitations where token=p_token;
 if not found then raise exception 'Invitation unavailable'; end if;
 select owner_id into v_owner from public.shopping_lists
   where id=v_list and deleted_at is null for update;
 if not found or v_owner<>v_actor then raise exception 'Invitation unavailable'; end if;
 update public.list_invitations set revoked_at=now()
   where token=p_token and accepted_at is null and revoked_at is null
   and declined_at is null;
end;
$$;

revoke all on function public.create_list_invitation(uuid,uuid) from public, anon;
revoke all on function public.accept_list_invitation(uuid) from public, anon;
revoke all on function public.finalize_list_invitation(uuid) from public, anon;
revoke all on function public.revoke_list_invitation(uuid) from public, anon;
grant execute on function public.create_list_invitation(uuid,uuid) to authenticated;
grant execute on function public.accept_list_invitation(uuid) to authenticated;
grant execute on function public.finalize_list_invitation(uuid) to authenticated;
grant execute on function public.revoke_list_invitation(uuid) to authenticated;


-- Recipient-only inbox. No invitation bearer token is exposed to other users.
-- token is used as an opaque invitation ID by the authenticated recipient.
create or replace function public.get_incoming_list_invitations()
returns table(invitation_id uuid, list_id uuid, list_name text,
              invited_at timestamptz, expires_at timestamptz, status text)
language sql stable security definer set search_path = ''
as $$
 select i.token, i.list_id, l.name, i.created_at, i.expires_at,
  case when i.accept_requested_at is not null then 'processing' when i.accept_requested_at is not null then 'processing'
       else 'pending' end
 from public.list_invitations i
 join public.shopping_lists l on l.id=i.list_id
 where i.recipient_id=(select auth.uid())
   and i.accepted_at is null and i.revoked_at is null
   and i.declined_at is null and i.expires_at>now()
   and l.deleted_at is null
 order by i.created_at desc;
$$;

-- Owner-only sent-invitation listing. Recipient UUID is exposed to the owner
-- who supplied it, not to other list members or outsiders.
create or replace function public.get_sent_list_invitations(p_list uuid)
returns table(invitation_id uuid, recipient_id uuid,
              invited_at timestamptz, expires_at timestamptz,
              status text)
language plpgsql stable security definer set search_path = ''
as $$
begin
 if auth.uid() is null or not public.is_list_owner(p_list) then
   raise exception 'List unavailable';
 end if;
 return query
 select i.token,i.recipient_id,i.created_at,i.expires_at,
  case when i.revoked_at is not null then 'revoked'
       when i.declined_at is not null then 'declined'
       when i.accepted_at is not null then 'accepted'
       when i.expires_at<=now() then 'expired'
       else 'pending' end
 from public.list_invitations i where i.list_id=p_list
 order by i.created_at desc;
end;
$$;

-- Decline is an authenticated recipient-only operation. Same lock order as
-- accept/revoke: list row first, invitation row second.
create or replace function public.decline_list_invitation(p_token uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
   raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null then raise exception 'Invitation unavailable'; end if;
 select list_id into v_list from public.list_invitations
  where token=p_token and recipient_id=v_actor;
 if not found then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.shopping_lists
  where id=v_list and deleted_at is null for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 update public.list_invitations set declined_at=now()
 where token=p_token and recipient_id=v_actor and accepted_at is null
   and revoked_at is null and declined_at is null and expires_at>now();
 if not found then raise exception 'Invitation unavailable'; end if;
end;
$$;

revoke all on function public.get_incoming_list_invitations() from public, anon;
revoke all on function public.get_sent_list_invitations(uuid) from public, anon;
revoke all on function public.decline_list_invitation(uuid) from public, anon;
grant execute on function public.get_incoming_list_invitations() to authenticated;
grant execute on function public.get_sent_list_invitations(uuid) to authenticated;
grant execute on function public.decline_list_invitation(uuid) to authenticated;

-- TODO BEFORE EXECUTION: prove revoke-over-accept priority with concurrency tests,
-- resolve safe recipient discovery, audit function
-- ownership/permissions and test in a disposable database. No push integration.
-- Required validation before application:
-- owner invite, outsider invite denied, wrong recipient denied, expiry,
-- revoke, decline, inbox/sent visibility, replay, membership visibility,
-- owner revocation, concurrent accept/revoke priority,
-- direct REST table read/write denied, and role/function privilege audit.
-- Invitation UUID is a bearer secret: never log or share it publicly.
