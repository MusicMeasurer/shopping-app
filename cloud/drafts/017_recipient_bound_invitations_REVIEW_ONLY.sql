-- ShoppingApp migration 017 DRAFT: recipient-bound, one-use invitations.
-- Review only. DO NOT execute until independently reviewed and approved.
-- Product decision 2026-10-31: in-app inbox, explicit accept/decline, owner revoke;
-- no push notifications in current scope. Recipient lookup and safe display RPCs
-- remain to be designed; current migration is NOT feature-complete.
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
 constraint invitation_expiry check (expires_at > created_at),
 constraint invitation_terminal check (accepted_at is null or revoked_at is null)
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
     and accepted_at is null and revoked_at is null;
 insert into public.list_invitations(list_id,recipient_id,created_by,expires_at)
 values(p_list,p_recipient,v_actor,now()+interval '24 hours')
 returning token into v_token;
 return v_token;
end;
$$;

create or replace function public.accept_list_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_list uuid; v_inv public.list_invitations%rowtype;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
   raise exception 'Operation requires READ COMMITTED isolation' using errcode='0A000';
 end if;
 if v_actor is null or p_token is null then raise exception 'Invitation unavailable'; end if;
 -- Read only the list identifier first; lock list before invitation to match
 -- create/revoke/member-removal lock ordering.
 select list_id into v_list from public.list_invitations where token=p_token;
 if not found then raise exception 'Invitation unavailable'; end if;
 perform 1 from public.shopping_lists where id=v_list and deleted_at is null for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 select * into v_inv from public.list_invitations where token=p_token for update;
 if not found or v_inv.list_id<>v_list or v_inv.recipient_id<>v_actor
    or v_inv.revoked_at is not null or v_inv.accepted_at is not null
    or v_inv.expires_at<=now() then
   raise exception 'Invitation unavailable';
 end if;
 insert into public.list_members(list_id,user_id) values(v_list,v_actor)
 on conflict do nothing;
 update public.list_invitations set accepted_at=now() where token=p_token;
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
   where token=p_token and accepted_at is null and revoked_at is null;
end;
$$;

revoke all on function public.create_list_invitation(uuid,uuid) from public, anon;
revoke all on function public.accept_list_invitation(uuid) from public, anon;
revoke all on function public.revoke_list_invitation(uuid) from public, anon;
grant execute on function public.create_list_invitation(uuid,uuid) to authenticated;
grant execute on function public.accept_list_invitation(uuid) to authenticated;
grant execute on function public.revoke_list_invitation(uuid) to authenticated;

-- TODO: add recipient-scoped inbox RPC (without exposing bearer tokens to other users),
-- decline RPC, owner-scoped sent-invitations listing, and recipient discovery policy.
-- Owner revoke RPC already exists above. No push notification integration.
-- Required validation before application:
-- owner invite, outsider invite denied, wrong recipient denied, expiry,
-- revoke, replay, membership visibility, owner revocation, concurrent accept/revoke,
-- direct REST table read/write denied, and role/function privilege audit.
-- Invitation UUID is a bearer secret: never log or share it publicly.
