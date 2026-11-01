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
