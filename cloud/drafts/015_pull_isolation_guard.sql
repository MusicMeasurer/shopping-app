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
