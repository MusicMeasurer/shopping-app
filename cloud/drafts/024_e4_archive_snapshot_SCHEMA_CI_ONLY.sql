-- E4 archive durable snapshots: additive, isolated-CI candidate, NOT deployed.
-- Snapshot records intentionally have no FK to deletable shopping_lists.
create table public.e4_archive_completions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_list_id uuid not null,
  source_list_name text not null check (length(trim(source_list_name)) between 1 and 120),
  operation_id uuid not null,
  completed_at timestamptz not null default now(),
  unique(owner_id, operation_id)
);
create table public.e4_archive_items (
  completion_id uuid not null references public.e4_archive_completions(id) on delete cascade,
  ordinal bigint not null check (ordinal >= 0),
  source_item_id uuid,
  name text not null check (length(trim(name)) between 1 and 120),
  quantity numeric(12,3) check (quantity is null or quantity > 0),
  unit text check (unit is null or length(unit) <= 32),
  primary key(completion_id, ordinal)
);
create index e4_archive_completions_owner_time_idx
  on public.e4_archive_completions(owner_id, completed_at desc, id);
alter table public.e4_archive_completions enable row level security;
alter table public.e4_archive_items enable row level security;
revoke all on public.e4_archive_completions, public.e4_archive_items from public, anon, authenticated;
grant select on public.e4_archive_completions, public.e4_archive_items to authenticated;
create policy e4_archive_owner_read on public.e4_archive_completions
  for select to authenticated using (owner_id = (select auth.uid()));
create policy e4_archive_items_owner_read on public.e4_archive_items
  for select to authenticated using (exists (
    select 1 from public.e4_archive_completions c
    where c.id = completion_id and c.owner_id = (select auth.uid())
  ));
-- No INSERT/UPDATE/DELETE grants or policies to clients.
-- Atomic completion RPC, revision gate, idempotent receipt and list reset are
-- deliberately NOT part of this first schema increment. No cloud archive writes
-- are enabled until the complete RPC is implemented and A/B tested.
