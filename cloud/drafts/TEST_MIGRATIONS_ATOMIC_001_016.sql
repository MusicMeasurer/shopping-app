-- Disposable Supabase test project ONLY. Do not use in production.
-- Run with Data API disabled. On any SQL error, stop and report.
BEGIN;
-- Migration 001
-- ShoppingApp cloud schema DRAFT 0.1 (Supabase/PostgreSQL)
-- Not deployed. Review security and run integration tests before production.
create extension if not exists pgcrypto;

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.list_members (
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
-- Owner is represented by shopping_lists.owner_id, not by a member row.

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  purchased boolean not null default false,
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  unit text check (unit is null or char_length(unit) <= 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index shopping_items_list_idx on public.shopping_items(list_id, updated_at);
create index shopping_lists_owner_idx on public.shopping_lists(owner_id);
create index list_members_user_idx on public.list_members(user_id);

-- SECURITY DEFINER avoids recursive RLS lookups. Only returns a boolean.
create or replace function public.can_access_list(p_list uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shopping_lists l
    where l.id = p_list and l.deleted_at is null
      and (l.owner_id = (select auth.uid())
        or exists (select 1 from public.list_members m
                   where m.list_id = l.id and m.user_id = (select auth.uid())))
  );
$$;
revoke all on function public.can_access_list(uuid) from public;
grant execute on function public.can_access_list(uuid) to authenticated;

create or replace function public.is_list_owner(p_list uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.shopping_lists l
    where l.id = p_list and l.owner_id = (select auth.uid()) and l.deleted_at is null
  );
$$;
revoke all on function public.is_list_owner(uuid) from public;
grant execute on function public.is_list_owner(uuid) to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;
create trigger lists_updated before update on public.shopping_lists
for each row execute function public.set_updated_at();
create trigger items_updated before update on public.shopping_items
for each row execute function public.set_updated_at();

alter table public.shopping_lists enable row level security;
alter table public.list_members enable row level security;
alter table public.shopping_items enable row level security;

create policy lists_read on public.shopping_lists for select to authenticated
using (public.can_access_list(id));
create policy lists_insert on public.shopping_lists for insert to authenticated
with check (owner_id = (select auth.uid()) and deleted_at is null);
create policy lists_update on public.shopping_lists for update to authenticated
using (public.is_list_owner(id))
with check (public.is_list_owner(id));
create policy lists_delete on public.shopping_lists for delete to authenticated
using (public.is_list_owner(id));

create policy members_read on public.list_members for select to authenticated
using (public.can_access_list(list_id));
create policy members_insert on public.list_members for insert to authenticated
with check (public.is_list_owner(list_id) and user_id <> (select auth.uid()));
create policy members_delete on public.list_members for delete to authenticated
using (public.is_list_owner(list_id) or user_id = (select auth.uid()));

create policy items_read on public.shopping_items for select to authenticated
using (public.can_access_list(list_id));
create policy items_insert on public.shopping_items for insert to authenticated
with check (public.can_access_list(list_id) and deleted_at is null);
create policy items_update on public.shopping_items for update to authenticated
using (public.can_access_list(list_id))
with check (public.can_access_list(list_id));
create policy items_delete on public.shopping_items for delete to authenticated
using (public.can_access_list(list_id));

-- Hardening still required before deployment:
-- 1. Prevent owner_id and item.list_id reassignment using triggers/column grants.
-- 2. Restrict membership writes to server-side invitation acceptance.
-- 3. Add durable sync operation IDs, conflict policy, and tombstone retention.
-- 4. Test RLS using distinct real authenticated users and anon role.
-- 5. Evaluate deletion semantics (soft-delete vs hard-delete) and user lifecycle.


-- Migration 002
-- ShoppingApp draft 002: tighten initial schema before any deployment.
-- Apply after 001_initial_schema.sql. NOT YET EXECUTED OR VERIFIED.
-- Membership invitations require a separate trusted server-side workflow.

-- Avoid direct client-side membership creation. A future backend invitation
-- acceptance function must verify the invitation, recipient and expiry.
drop policy if exists members_insert on public.list_members;
revoke insert, update on public.list_members from anon, authenticated;

-- Never let a client reassign list ownership or move an item between lists.
-- Triggers provide a second line of defense beyond column privileges.
create or replace function public.reject_list_owner_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Changing list owner is not supported';
  end if;
  return new;
end;
$$;
create trigger protect_list_owner
before update on public.shopping_lists
for each row execute function public.reject_list_owner_change();

create or replace function public.reject_item_list_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.list_id is distinct from old.list_id then
    raise exception 'Moving items between lists is not supported';
  end if;
  return new;
end;
$$;
create trigger protect_item_list
before update on public.shopping_items
for each row execute function public.reject_item_list_change();

-- Membership rows may only be removed by owner or by member leaving.
-- No policy permits a member to promote themselves or invite others.
drop policy if exists members_delete on public.list_members;
create policy members_delete on public.list_members
for delete to authenticated
using (public.is_list_owner(list_id) or user_id = (select auth.uid()));

-- Keep soft-deleted items out of ordinary reads. The eventual sync endpoint
-- must use a separately scoped mechanism to retrieve tombstones.
drop policy if exists items_read on public.shopping_items;
create policy items_read on public.shopping_items
for select to authenticated
using (public.can_access_list(list_id) and deleted_at is null);

-- Prevent clients from restoring or altering soft-deleted items.
drop policy if exists items_update on public.shopping_items;
create policy items_update on public.shopping_items
for update to authenticated
using (public.can_access_list(list_id) and deleted_at is null)
with check (public.can_access_list(list_id) and deleted_at is null);

-- Caveats: these draft changes are not a full sync design. RLS select
-- filtering of tombstones means an authenticated client cannot yet sync
-- deletions. Do not deploy until this is addressed and tests pass.


-- Migration 003
-- ShoppingApp draft 003, stage A: sync tables and client ACL.
-- Apply AFTER 001 and 002 in a disposable test database only.
-- Not production-ready. RPC functions follow in 004.
alter table public.shopping_lists add column revision bigint not null default 0 check (revision >= 0);
alter table public.shopping_items add column version bigint not null default 1 check (version >= 1);

create table public.item_operations (
 actor_id uuid not null references auth.users(id) on delete cascade,
 operation_id uuid not null,
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 payload_hash text not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_id,operation_id)
);
create table public.list_changes (
 list_id uuid not null references public.shopping_lists(id) on delete cascade,
 revision bigint not null,
 item_id uuid not null,
 kind text not null check (kind in ('add','update','delete')),
 snapshot jsonb not null,
 created_at timestamptz not null default now(),
 primary key(list_id,revision)
);
alter table public.item_operations enable row level security;
alter table public.list_changes enable row level security;

-- Client mutations must go through a controlled RPC.
revoke insert, update, delete, truncate on public.shopping_items from public, anon, authenticated;
revoke insert, update, delete, truncate on public.item_operations from public, anon, authenticated;
revoke insert, update, delete, truncate on public.list_changes from public, anon, authenticated;
revoke update, delete, truncate on public.shopping_lists from public, anon, authenticated;

-- Immutable item identifiers and creation time.
create or replace function public.guard_item_identity()
returns trigger language plpgsql set search_path = ''
as $$
begin
 if new.id is distinct from old.id
 or new.list_id is distinct from old.list_id
 or new.created_at is distinct from old.created_at then
  raise exception 'Item identity is immutable';
 end if;
 return new;
end;
$$;
create trigger guard_item_identity_before_update
before update on public.shopping_items
for each row execute function public.guard_item_identity();

-- 002 owner-change trigger intentionally remains: a later migration must
-- replace it with a secure ownership-transfer operation.


-- Migration 004
-- ShoppingApp draft 004: transactional item mutations.
-- Apply after 001, 002, 003 in a disposable test database.
-- SECURITY REVIEW REQUIRED before execution outside a test database.
create or replace function public.apply_item_change(
 p_operation uuid, p_list uuid, p_action text, p_item uuid,
 p_name text default null, p_purchased boolean default null,
 p_expected_version bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_previous public.item_operations%rowtype;
 v_item public.shopping_items%rowtype;
 v_revision bigint;
 v_result jsonb;
begin
 if v_actor is null or p_operation is null or p_list is null or p_item is null then
  raise exception 'Invalid actor or identifiers';
 end if;
 if p_action not in ('add','update','delete') then
  raise exception 'Unsupported action';
 end if;
 -- Lock the list before reading membership or mutating its items.
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;
 -- A canonical text payload avoids relying on client-provided hashes.
 v_hash := md5(jsonb_build_array(p_list,p_action,p_item,p_name,p_purchased,p_expected_version)::text);
 select * into v_previous from public.item_operations
  where actor_id = v_actor and operation_id = p_operation;
 if found then
  if v_previous.payload_hash <> v_hash then
   raise exception 'Operation ID payload mismatch';
  end if;
  return v_previous.result;
 end if;
 if p_action = 'add' then
  if p_name is null or length(trim(p_name)) not between 1 and 120 then
   raise exception 'Invalid name';
  end if;
  insert into public.shopping_items(id,list_id,name,purchased)
   values(p_item,p_list,trim(p_name),coalesce(p_purchased,false))
   returning * into v_item;
 else
  select * into v_item from public.shopping_items
   where id = p_item and list_id = p_list and deleted_at is null for update;
  if not found then raise exception 'Item unavailable'; end if;
  if p_expected_version is null or p_expected_version <> v_item.version then
   raise exception 'Version conflict';
  end if;
  if p_action = 'update' then
   if p_name is not null and length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid name';
   end if;
   update public.shopping_items
    set name = coalesce(trim(p_name),name),
        purchased = coalesce(p_purchased,purchased),
        version = version + 1
    where id = p_item returning * into v_item;
  else
   update public.shopping_items
    set deleted_at = now(), version = version + 1
    where id = p_item returning * into v_item;
  end if;
 end if;
 update public.shopping_lists set revision = revision + 1
  where id = p_list returning revision into v_revision;
 insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
  values(p_list,v_revision,p_item,p_action,
   jsonb_build_object('id',v_item.id,'name',v_item.name,
    'purchased',v_item.purchased,'version',v_item.version,
    'deleted',v_item.deleted_at is not null));
 v_result := jsonb_build_object('operation_id',p_operation,
  'list_revision',v_revision,'item_version',v_item.version);
 insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
  values(v_actor,p_operation,p_list,v_hash,v_result);
 return v_result;
end;
$$;
revoke all on function public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint) from public, anon;
grant execute on function public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint) to authenticated;

-- Known limitations:
-- Existing 002 item UPDATE RLS policy is bypassed only when the SECURITY DEFINER
-- function owner has sufficient privileges. Verify owner and ACL in test DB.
-- 002 list-owner trigger does not block revision-only updates.
-- Concurrent reuse of operation UUID on different lists may raise a uniqueness
-- error rather than returning an idempotent result.
-- No pull API, retention, initial snapshot or structured conflict response yet.


-- Migration 005
-- ShoppingApp draft 005: authorized incremental pull.
-- Apply after 001-004 in disposable test database only.
create or replace function public.pull_item_changes(
 p_list uuid, p_after_revision bigint default 0, p_page_size integer default 100
) returns table(revision bigint, kind text, snapshot jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
 if auth.uid() is null or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;
 if p_after_revision is null or p_after_revision < 0
 or p_page_size is null or p_page_size < 1 or p_page_size > 500 then
  raise exception 'Invalid cursor or page size';
 end if;
 return query
  select c.revision,c.kind,c.snapshot
  from public.list_changes c
  where c.list_id = p_list and c.revision > p_after_revision
  order by c.revision
  limit p_page_size;
end;
$$;
revoke all on function public.pull_item_changes(uuid,bigint,integer) from public, anon;
grant execute on function public.pull_item_changes(uuid,bigint,integer) to authenticated;
-- Future work: snapshot boundary, history retention and cursor-too-old response.


-- Migration 006
-- ShoppingApp draft 006: fail-closed ownership and membership lifecycle.
-- Test database ONLY; apply after 001-005. No production deployment.
-- The approved ownership transfer workflow is NOT yet implemented.

-- Block accidental auth-user deletion while owned lists exist. This replaces
-- the destructive ON DELETE CASCADE from migration 001.
alter table public.shopping_lists drop constraint if exists shopping_lists_owner_id_fkey;
alter table public.shopping_lists add constraint shopping_lists_owner_id_fkey
 foreign key (owner_id) references auth.users(id) on delete restrict;

-- Members cannot bypass coordinated locking by direct table deletion.
drop policy if exists members_delete on public.list_members;
revoke delete, truncate on public.list_members from public, anon, authenticated;

-- Removal and leaving use one trusted operation, with list lock first.
create or replace function public.remove_list_member(p_list uuid, p_member uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
 if v_actor is null or p_list is null or p_member is null then
  raise exception 'Missing authenticated actor or identifiers';
 end if;
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found then raise exception 'List unavailable'; end if;
 if not (public.is_list_owner(p_list) or v_actor = p_member) then
  raise exception 'Permission denied';
 end if;
 delete from public.list_members
  where list_id = p_list and user_id = p_member;
end;
$$;
revoke all on function public.remove_list_member(uuid,uuid) from public, anon;
grant execute on function public.remove_list_member(uuid,uuid) to authenticated;

-- NOTE: Do not grant client DELETE on shopping_lists.
-- Current schema cannot yet implement voluntary ownership transfer because
-- migration 002 rejects owner_id changes. That needs a separate privileged
-- transfer operation and notification/audit workflow.
-- Verify actual function owner, RLS bypass, ACL and concurrency in test DB.


-- Migration 007
-- ShoppingApp draft 007: serialize pull against membership revocation.
-- Apply after 006 in disposable test DB only.
create or replace function public.pull_item_changes(
 p_list uuid, p_after_revision bigint default 0, p_page_size integer default 100
) returns table(revision bigint, kind text, snapshot jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
 if auth.uid() is null or p_list is null then
  raise exception 'Authentication and list required';
 end if;
 if p_after_revision is null or p_after_revision < 0
 or p_page_size is null or p_page_size < 1 or p_page_size > 500 then
  raise exception 'Invalid cursor or page size';
 end if;

 -- This row lock conflicts with FOR UPDATE used by member removal and
 -- item mutation. It is held until the surrounding transaction completes.
 perform 1 from public.shopping_lists l
  where l.id = p_list and l.deleted_at is null for share;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;

 return query
  select c.revision,c.kind,c.snapshot
  from public.list_changes c
  where c.list_id = p_list and c.revision > p_after_revision
  order by c.revision
  limit p_page_size;
end;
$$;
revoke all on function public.pull_item_changes(uuid,bigint,integer) from public, anon;
grant execute on function public.pull_item_changes(uuid,bigint,integer) to authenticated;

-- This relies on all membership mutations using the same list-row lock.
-- Test READ COMMITTED and longer REPEATABLE READ transactions separately.
-- Snapshot consistency and retention remain open.


-- Migration 008
-- ShoppingApp draft 008: ownership transfer infrastructure.
-- Apply after 007 in disposable test DB only.
-- Does not implement account deletion or Auth admin orchestration.

create table public.ownership_events (
 id bigint generated always as identity primary key,
 list_id uuid not null,
 old_owner uuid not null,
 new_owner uuid not null,
 reason text not null check (reason in ('voluntary','account_deletion')),
 created_at timestamptz not null default now()
);
create table public.user_notifications (
 id bigint generated always as identity primary key,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 list_id uuid,
 event_type text not null,
 payload jsonb not null,
 created_at timestamptz not null default now(),
 read_at timestamptz
);
create index user_notifications_recipient_idx
 on public.user_notifications(recipient_id,created_at desc);
alter table public.ownership_events enable row level security;
alter table public.user_notifications enable row level security;
create policy notifications_read on public.user_notifications
 for select to authenticated using (recipient_id = (select auth.uid()));
revoke insert,update,delete,truncate on public.ownership_events from public,anon,authenticated;
revoke insert,update,delete,truncate on public.user_notifications from public,anon,authenticated;

-- The old trigger from 002 blocks all owner changes. Replace with a guard
-- allowing only an explicit trusted transaction-local context.
drop trigger if exists protect_list_owner on public.shopping_lists;
create or replace function public.reject_list_owner_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
 if new.owner_id is distinct from old.owner_id
 and current_setting('shoppingapp.owner_transfer_allowed',true) is distinct from 'yes' then
  raise exception 'Ownership changes require trusted workflow';
 end if;
 return new;
end;
$$;
create trigger protect_list_owner before update on public.shopping_lists
for each row execute function public.reject_list_owner_change();

-- IMPORTANT SECURITY BLOCKER: a custom GUC is NOT a security boundary.
-- A SQL-capable client may set it. Before deployment replace with a
-- protected execution-context mechanism or privileged function ownership
-- and column-level access controls; review this migration critically.


-- Migration 009
-- ShoppingApp draft 009: restrict ownership changes to trusted RPC.
-- Apply after 008 in disposable test DB only.
-- Replaces insecure custom GUC guard with a privilege-based approach.

-- Never expose UPDATE of the owner column to client roles, even if another
-- policy or grant is introduced later. The 008 GUC is NOT an authorization.
drop trigger if exists protect_list_owner on public.shopping_lists;
drop function if exists public.reject_list_owner_change();
revoke update on public.shopping_lists from public, anon, authenticated;
revoke update(owner_id) on public.shopping_lists from anon, authenticated;

create or replace function public.transfer_list_ownership(p_list uuid,p_new_owner uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
declare v_old_owner uuid;
begin
 if v_actor is null or p_list is null or p_new_owner is null then
  raise exception 'Missing actor or identifiers';
 end if;
 select owner_id into v_old_owner from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or v_old_owner <> v_actor then
  raise exception 'Only current owner can transfer';
 end if;
 if p_new_owner = v_old_owner then
  raise exception 'New owner must be a member';
 end if;
 if not exists (select 1 from public.list_members
   where list_id=p_list and user_id=p_new_owner) then
  raise exception 'New owner must be a current member';
 end if;
 delete from public.list_members
  where list_id=p_list and user_id=p_new_owner;
 update public.shopping_lists set owner_id=p_new_owner where id=p_list;
 insert into public.list_members(list_id,user_id)
  values(p_list,v_old_owner);
 insert into public.ownership_events(list_id,old_owner,new_owner,reason)
  values(p_list,v_old_owner,p_new_owner,'voluntary');
 insert into public.user_notifications(recipient_id,list_id,event_type,payload)
  values(p_new_owner,p_list,'ownership_received',
   jsonb_build_object('list_id',p_list,'previous_owner',v_old_owner));
end;
$$;
revoke all on function public.transfer_list_ownership(uuid,uuid) from public,anon;
grant execute on function public.transfer_list_ownership(uuid,uuid) to authenticated;

-- Must audit function ownership, grants, RLS, and direct SQL privileges in
-- disposable DB. Account deletion remains unimplemented. Notifications are
-- durable but no client read API beyond RLS SELECT is guaranteed yet.


-- Migration 010
-- ShoppingApp draft 010: server-only preparation for account deletion.
-- Apply after 009 in a disposable test database ONLY.
-- This function transfers or deletes owned lists but DOES NOT delete auth.users.
-- Never expose to authenticated, anon or client-side service keys.

create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_list record;
 v_successor uuid;
 v_transferred integer := 0;
 v_deleted integer := 0;
begin
 if p_user is null then raise exception 'User required'; end if;
 -- No client may invoke this function. Trusted backend must verify actor,
 -- transaction boundaries and function ownership.
 for v_list in
  select id from public.shopping_lists
  where owner_id = p_user order by id for update
 loop
  select m.user_id into v_successor
   from public.list_members m
   where m.list_id = v_list.id and m.user_id <> p_user
   order by m.joined_at asc,m.user_id asc limit 1;
  if v_successor is null then
   delete from public.shopping_lists where id = v_list.id;
   v_deleted := v_deleted + 1;
  else
   delete from public.list_members
    where list_id=v_list.id and user_id=v_successor;
   update public.shopping_lists
    set owner_id=v_successor where id=v_list.id;
   insert into public.ownership_events(list_id,old_owner,new_owner,reason)
    values(v_list.id,p_user,v_successor,'account_deletion');
   insert into public.user_notifications(recipient_id,list_id,event_type,payload)
    values(v_successor,v_list.id,'ownership_received',
     jsonb_build_object('list_id',v_list.id,'reason','account_deletion'));
   v_transferred := v_transferred + 1;
  end if;
  v_successor := null;
 end loop;
 -- Remove departing user from lists they do not own.
 -- IMPORTANT: this direct deletion does not coordinate list locks; it must
 -- be replaced before production.
 delete from public.list_members where user_id=p_user;
 return jsonb_build_object('transferred',v_transferred,'deleted',v_deleted);
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
-- Explicitly NO GRANT EXECUTE to client roles.
-- Must audit EXECUTE via PUBLIC/default grants, function owner and any
-- privileged API path. This is a draft for controlled testing only.


-- Migration 011
-- ShoppingApp draft 011: coordinate departure membership removals.
-- Apply after 010, disposable test database only.
-- Replaces 010 preparation routine; still does NOT delete auth.users.
create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_list record;
 v_successor uuid;
 v_transferred integer := 0;
 v_deleted integer := 0;
begin
 if p_user is null then raise exception 'User required'; end if;
 -- Lock all lists where departing user is owner OR member, in stable order.
 -- This coordinates with item mutations and membership removals.
 for v_list in
  select l.id,l.owner_id from public.shopping_lists l
  where l.owner_id=p_user
     or exists(select 1 from public.list_members m
               where m.list_id=l.id and m.user_id=p_user)
  order by l.id for update
 loop
  if v_list.owner_id = p_user then
   select m.user_id into v_successor
    from public.list_members m
    where m.list_id=v_list.id and m.user_id<>p_user
    order by m.joined_at,m.user_id limit 1;
   if v_successor is null then
    delete from public.shopping_lists where id=v_list.id;
    v_deleted := v_deleted + 1;
   else
    delete from public.list_members
     where list_id=v_list.id and user_id=v_successor;
    update public.shopping_lists set owner_id=v_successor where id=v_list.id;
    insert into public.ownership_events(list_id,old_owner,new_owner,reason)
     values(v_list.id,p_user,v_successor,'account_deletion');
    insert into public.user_notifications(recipient_id,list_id,event_type,payload)
     values(v_successor,v_list.id,'ownership_received',
      jsonb_build_object('list_id',v_list.id,'reason','account_deletion'));
    v_transferred := v_transferred + 1;
   end if;
  end if;
  delete from public.list_members
   where list_id=v_list.id and user_id=p_user;
  v_successor := null;
 end loop;
 return jsonb_build_object('transferred',v_transferred,'deleted',v_deleted);
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
-- Known unresolved: new membership inserted during preparation, actor
-- authentication, Auth identity deletion atomicity, privilege ownership,
-- historical events retention, and potential deadlocks with other workflows.
-- DO NOT expose this privileged RPC to client roles.


-- Migration 012
-- ShoppingApp draft 012: fail-closed initial list metadata.
-- Apply only after 001-011 in a disposable test database with API disabled.
-- This migration does not resolve the account deletion or isolation High findings.
--
-- A client creating a list must not choose a nonzero initial revision or
-- backdate its server-owned timestamps. RPC-driven revisions remain possible.
create or replace function public.guard_new_list_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision is distinct from 0 then
    raise exception 'Initial list revision must be zero'
      using errcode = '22023';
  end if;
  if new.created_at is distinct from transaction_timestamp()
     or new.updated_at is distinct from transaction_timestamp() then
    -- Server defaults may use now() (= transaction_timestamp()).
    raise exception 'Initial list timestamps must be server-generated'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger guard_new_list_metadata_before_insert
before insert on public.shopping_lists
for each row execute function public.guard_new_list_metadata();

-- Defense in depth: do not permit direct client column updates of owner_id.
revoke update(owner_id) on public.shopping_lists from public, anon, authenticated;

-- Remaining audit gates: actual ACLs/role inheritance, ownership and
-- account-deletion fencing, supported isolation mode, and runtime tests.


-- Migration 013
-- ShoppingApp draft 013: make self-owned INSERT ... RETURNING compatible with RLS.
-- Apply after 012 in a disposable test database only.
-- No production deployment or runtime verification.
--
-- PostgreSQL may check the SELECT policy before the newly inserted row
-- exists when INSERT ... RETURNING requests a representation. A row-local
-- owner check allows the new owner's row without querying it by id.
-- Member reads still require the existing scoped membership helper.
drop policy if exists lists_read on public.shopping_lists;
create policy lists_read on public.shopping_lists
for select to authenticated
using (
  deleted_at is null
  and (
    owner_id = (select auth.uid())
    or public.can_access_list(id)
  )
);

-- This does not grant INSERT/SELECT table privileges; the existing role ACL
-- must be verified in a disposable Supabase/PostgREST test environment.
-- Regression tests: self-owned INSERT RETURNING; outsider SELECT denial;
-- member SELECT allowed; deleted list hidden; wrong-owner INSERT denied;
-- revoked member denied; no change to ownership-transfer RPC.
-- H-01/H-02/H-03 from CODEX_AUDIT_REPORT_011.md remain unresolved.


-- Migration 014
-- Draft migration 014. Disposable test database only.
-- Temporarily disable account-deletion preparation until the
-- authenticated, recoverable deletion lifecycle is implemented.
create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Account deletion is temporarily unavailable'
    using errcode = '0A000';
end;
$$;

revoke all on function public.prepare_account_deletion(uuid)
from public, anon, authenticated, service_role;

-- This is a fail-closed feature gate, not a completed deletion workflow.
-- It does not replace checking inherited EXECUTE privileges, backend routes,
-- function ownership, or the owner foreign-key restriction.
-- Apply only after 001-013 with API disabled; verify in a disposable DB.


-- Migration 015
-- Draft 015: enforce READ COMMITTED for incremental pull.
-- Apply after 014 in a disposable test database only.
-- H-03 is NOT fully closed until all authorized mutation, membership and
-- transfer operations are similarly constrained and concurrency-tested.
-- This guard rejects stale REPEATABLE READ and SERIALIZABLE snapshots.
create or replace function public.pull_item_changes(
 p_list uuid, p_after_revision bigint default 0, p_page_size integer default 100
) returns table(revision bigint, kind text, snapshot jsonb)
language plpgsql security definer set search_path = ''
as $$
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Pull requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
 if auth.uid() is null or p_list is null then
  raise exception 'Authentication and list required';
 end if;
 if p_after_revision is null or p_after_revision < 0
 or p_page_size is null or p_page_size < 1 or p_page_size > 500 then
  raise exception 'Invalid cursor or page size';
 end if;

 -- This row lock conflicts with FOR UPDATE used by member removal and
 -- item mutation. It is held until the surrounding transaction completes.
 perform 1 from public.shopping_lists l
  where l.id = p_list and l.deleted_at is null for share;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;

 return query
  select c.revision,c.kind,c.snapshot
  from public.list_changes c
  where c.list_id = p_list and c.revision > p_after_revision
  order by c.revision
  limit p_page_size;
end;
$$;
revoke all on function public.pull_item_changes(uuid,bigint,integer) from public, anon;
grant execute on function public.pull_item_changes(uuid,bigint,integer) to authenticated;

-- This relies on all membership mutations using the same list-row lock.
-- Test READ COMMITTED and longer REPEATABLE READ transactions separately.
-- Snapshot consistency and retention remain open.


-- Migration 016
-- Draft 016: reject stale transaction snapshots in authenticated RPCs.
-- Apply after 015, disposable test database only. No runtime tests performed.
-- Replaces function bodies, retaining existing signatures and grants.
-- Requires independent review of PostgreSQL/Supabase transaction behavior.

create or replace function public.apply_item_change(
 p_operation uuid, p_list uuid, p_action text, p_item uuid,
 p_name text default null, p_purchased boolean default null,
 p_expected_version bigint default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_actor uuid := auth.uid();
 v_hash text;
 v_previous public.item_operations%rowtype;
 v_item public.shopping_items%rowtype;
 v_revision bigint;
 v_result jsonb;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
 if v_actor is null or p_operation is null or p_list is null or p_item is null then
  raise exception 'Invalid actor or identifiers';
 end if;
 if p_action not in ('add','update','delete') then
  raise exception 'Unsupported action';
 end if;
 -- Lock the list before reading membership or mutating its items.
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or not public.can_access_list(p_list) then
  raise exception 'List unavailable';
 end if;
 -- A canonical text payload avoids relying on client-provided hashes.
 v_hash := md5(jsonb_build_array(p_list,p_action,p_item,p_name,p_purchased,p_expected_version)::text);
 select * into v_previous from public.item_operations
  where actor_id = v_actor and operation_id = p_operation;
 if found then
  if v_previous.payload_hash <> v_hash then
   raise exception 'Operation ID payload mismatch';
  end if;
  return v_previous.result;
 end if;
 if p_action = 'add' then
  if p_name is null or length(trim(p_name)) not between 1 and 120 then
   raise exception 'Invalid name';
  end if;
  insert into public.shopping_items(id,list_id,name,purchased)
   values(p_item,p_list,trim(p_name),coalesce(p_purchased,false))
   returning * into v_item;
 else
  select * into v_item from public.shopping_items
   where id = p_item and list_id = p_list and deleted_at is null for update;
  if not found then raise exception 'Item unavailable'; end if;
  if p_expected_version is null or p_expected_version <> v_item.version then
   raise exception 'Version conflict';
  end if;
  if p_action = 'update' then
   if p_name is not null and length(trim(p_name)) not between 1 and 120 then
    raise exception 'Invalid name';
   end if;
   update public.shopping_items
    set name = coalesce(trim(p_name),name),
        purchased = coalesce(p_purchased,purchased),
        version = version + 1
    where id = p_item returning * into v_item;
  else
   update public.shopping_items
    set deleted_at = now(), version = version + 1
    where id = p_item returning * into v_item;
  end if;
 end if;
 update public.shopping_lists set revision = revision + 1
  where id = p_list returning revision into v_revision;
 insert into public.list_changes(list_id,revision,item_id,kind,snapshot)
  values(p_list,v_revision,p_item,p_action,
   jsonb_build_object('id',v_item.id,'name',v_item.name,
    'purchased',v_item.purchased,'version',v_item.version,
    'deleted',v_item.deleted_at is not null));
 v_result := jsonb_build_object('operation_id',p_operation,
  'list_revision',v_revision,'item_version',v_item.version);
 insert into public.item_operations(actor_id,operation_id,list_id,payload_hash,result)
  values(v_actor,p_operation,p_list,v_hash,v_result);
 return v_result;
end;
$$;

create or replace function public.remove_list_member(p_list uuid, p_member uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
 if v_actor is null or p_list is null or p_member is null then
  raise exception 'Missing authenticated actor or identifiers';
 end if;
 perform 1 from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found then raise exception 'List unavailable'; end if;
 if not (public.is_list_owner(p_list) or v_actor = p_member) then
  raise exception 'Permission denied';
 end if;
 delete from public.list_members
  where list_id = p_list and user_id = p_member;
end;
$$;

create or replace function public.transfer_list_ownership(p_list uuid,p_new_owner uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
declare v_old_owner uuid;
begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Operation requires READ COMMITTED isolation'
    using errcode = '0A000';
 end if;
 if v_actor is null or p_list is null or p_new_owner is null then
  raise exception 'Missing actor or identifiers';
 end if;
 select owner_id into v_old_owner from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or v_old_owner <> v_actor then
  raise exception 'Only current owner can transfer';
 end if;
 if p_new_owner = v_old_owner then
  raise exception 'New owner must be a member';
 end if;
 if not exists (select 1 from public.list_members
   where list_id=p_list and user_id=p_new_owner) then
  raise exception 'New owner must be a current member';
 end if;
 delete from public.list_members
  where list_id=p_list and user_id=p_new_owner;
 update public.shopping_lists set owner_id=p_new_owner where id=p_list;
 insert into public.list_members(list_id,user_id)
  values(p_list,v_old_owner);
 insert into public.ownership_events(list_id,old_owner,new_owner,reason)
  values(p_list,v_old_owner,p_new_owner,'voluntary');
 insert into public.user_notifications(recipient_id,list_id,event_type,payload)
  values(p_new_owner,p_list,'ownership_received',
   jsonb_build_object('list_id',p_list,'previous_owner',v_old_owner));
end;
$$;

-- Account deletion remains disabled by 014. Other future RPCs must
-- follow the same supported-isolation contract and lock ordering.

COMMIT;
