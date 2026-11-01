-- ShoppingApp draft 009: restrict ownership changes to trusted RPC.
-- Apply after 008 in disposable test DB only.
-- Replaces insecure custom GUC guard with a privilege-based approach.

-- Never expose UPDATE of the owner column to client roles, even if another
-- policy or grant is introduced later. The 008 GUC is NOT an authorization.
drop trigger if exists protect_list_owner on public.shopping_lists;
drop function if exists public.reject_list_owner_change();
revoke update on public.shopping_lists from public, anon, authenticated;
revoke update(owner_id) on public.shopping_lists from anon, authenticated;

create or replace function public.transfer_list_ownership(p_list uuid,p_new_owner uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid();
declare v_old_owner uuid;
begin
 if v_actor is null or p_list is null or p_new_owner is null then
  raise exception 'Missing actor or identifiers';
 end if;
 select owner_id into v_old_owner from public.shopping_lists
  where id = p_list and deleted_at is null for update;
 if not found or v_old_owner <> v_actor then
  raise exception 'Only current owner can transfer';
 end if;
 if p_new_owner = v_old_owner then
  raise exception 'New owner must be a member';
 end if;
 if not exists (select 1 from public.list_members
   where list_id=p_list and user_id=p_new_owner) then
  raise exception 'New owner must be a current member';
 end if;
 delete from public.list_members
  where list_id=p_list and user_id=p_new_owner;
 update public.shopping_lists set owner_id=p_new_owner where id=p_list;
 insert into public.list_members(list_id,user_id)
  values(p_list,v_old_owner);
 insert into public.ownership_events(list_id,old_owner,new_owner,reason)
  values(p_list,v_old_owner,p_new_owner,'voluntary');
 insert into public.user_notifications(recipient_id,list_id,event_type,payload)
  values(p_new_owner,p_list,'ownership_received',
   jsonb_build_object('list_id',p_list,'previous_owner',v_old_owner));
end;
$$;
revoke all on function public.transfer_list_ownership(uuid,uuid) from public,anon;
grant execute on function public.transfer_list_ownership(uuid,uuid) to authenticated;

-- Must audit function ownership, grants, RLS, and direct SQL privileges in
-- disposable DB. Account deletion remains unimplemented. Notifications are
-- durable but no client read API beyond RLS SELECT is guaranteed yet.
