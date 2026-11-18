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
