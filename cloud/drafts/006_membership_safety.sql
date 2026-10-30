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
