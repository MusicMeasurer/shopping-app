-- E4 metadata additive draft. REVIEW ONLY; not applied to any Supabase project.
-- Requires existing 001-016 schema and an isolated disposable test database.
-- Do not use this draft as a production migration without hosted A/B security review.
-- No archive/deletion semantics are chosen here (FR-002-03 remains open).

alter table public.shopping_lists
  add column if not exists kind text,
  add column if not exists position bigint;

-- Preserve existing list identity and owner; backfill only missing metadata.
-- Existing cloud lists predate E4; default to permanent, never infer kind from names.
update public.shopping_lists set kind = 'permanent' where kind is null;

-- Stable deterministic order for pre-E4 rows; positions may be sparse afterwards.
with ranked as (
  select id, row_number() over (partition by owner_id order by created_at, id) - 1 as position
  from public.shopping_lists
)
update public.shopping_lists as l
set position = ranked.position
from ranked
where l.id = ranked.id and l.position is null;

alter table public.shopping_lists
  alter column kind set default 'permanent',
  alter column kind set not null,
  alter column position set default 0,
  alter column position set not null;

alter table public.shopping_lists
  add constraint shopping_lists_e4_kind_check
  check (kind in ('permanent', 'oneoff'));
alter table public.shopping_lists
  add constraint shopping_lists_e4_position_check
  check (position >= 0);

create index if not exists shopping_lists_owner_e4_order_idx
  on public.shopping_lists(owner_id, position, created_at, id)
  where deleted_at is null;

-- SECURITY GATE: existing owner UPDATE RLS permits direct updates. Before enabling
-- E4 writes, replace this with a versioned owner-scoped RPC and restrict column
-- privileges/other direct mutation paths. Never assume RLS alone enforces revision.
-- Rollback requires an explicit compatibility/data-retention review; dropping
-- columns after E4 writes would lose user-defined kind/order.
