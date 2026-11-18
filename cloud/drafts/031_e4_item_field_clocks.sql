-- Additive migration. Existing clients and versioned RPCs keep their contracts.
alter table public.shopping_items add column field_changed_at jsonb;

create function public.set_item_field_clocks()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  changed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if tg_op = 'INSERT' then
    new.field_changed_at := pg_catalog.jsonb_build_object(
      'name', changed_at, 'amount', changed_at, 'purchased', changed_at
    );
  else
    new.field_changed_at := pg_catalog.jsonb_build_object(
      'name', case when new.name is distinct from old.name then changed_at
        else coalesce((old.field_changed_at->>'name')::timestamptz, old.updated_at) end,
      'amount', case when (new.quantity, new.unit) is distinct from (old.quantity, old.unit) then changed_at
        else coalesce((old.field_changed_at->>'amount')::timestamptz, old.updated_at) end,
      'purchased', case when new.purchased is distinct from old.purchased then changed_at
        else coalesce((old.field_changed_at->>'purchased')::timestamptz, old.updated_at) end
    );
  end if;
  return new;
end;
$$;

create trigger set_item_field_clocks_before_write
before insert or update on public.shopping_items
for each row execute function public.set_item_field_clocks();

revoke execute on function public.set_item_field_clocks() from public, anon, authenticated;
