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
