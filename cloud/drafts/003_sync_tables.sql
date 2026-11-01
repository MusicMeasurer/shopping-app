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
