-- Preserve pre-existing duplicates. Guard new names, including RPC and import writes.
create function public.guard_active_list_name()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  name_key text := lower(regexp_replace(new.name, '^[[:space:]]+|[[:space:]]+$', '', 'g'));
begin
  if new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' then
    if old.deleted_at is null and old.owner_id = new.owner_id and
       lower(regexp_replace(old.name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) = name_key then
      return new;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('e4-active-name:' || new.owner_id::text || ':' || name_key, 0));
  if exists (
    select 1 from public.shopping_lists l
    where l.owner_id = new.owner_id and l.id <> new.id and l.deleted_at is null
      and lower(regexp_replace(l.name, '^[[:space:]]+|[[:space:]]+$', '', 'g')) = name_key
  ) then
    raise exception using errcode = '23505', message = 'List name already exists';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_active_list_name() from public, anon, authenticated;
create trigger guard_active_list_name_before_write
before insert or update of owner_id, name, deleted_at on public.shopping_lists
for each row execute function public.guard_active_list_name();
