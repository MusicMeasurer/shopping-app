-- ShoppingApp draft 011: coordinate departure membership removals.
-- Apply after 010, disposable test database only.
-- Replaces 010 preparation routine; still does NOT delete auth.users.
create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_list record;
 v_successor uuid;
 v_transferred integer := 0;
 v_deleted integer := 0;
begin
 if p_user is null then raise exception 'User required'; end if;
 -- Lock all lists where departing user is owner OR member, in stable order.
 -- This coordinates with item mutations and membership removals.
 for v_list in
  select l.id,l.owner_id from public.shopping_lists l
  where l.owner_id=p_user
     or exists(select 1 from public.list_members m
               where m.list_id=l.id and m.user_id=p_user)
  order by l.id for update
 loop
  if v_list.owner_id = p_user then
   select m.user_id into v_successor
    from public.list_members m
    where m.list_id=v_list.id and m.user_id<>p_user
    order by m.joined_at,m.user_id limit 1;
   if v_successor is null then
    delete from public.shopping_lists where id=v_list.id;
    v_deleted := v_deleted + 1;
   else
    delete from public.list_members
     where list_id=v_list.id and user_id=v_successor;
    update public.shopping_lists set owner_id=v_successor where id=v_list.id;
    insert into public.ownership_events(list_id,old_owner,new_owner,reason)
     values(v_list.id,p_user,v_successor,'account_deletion');
    insert into public.user_notifications(recipient_id,list_id,event_type,payload)
     values(v_successor,v_list.id,'ownership_received',
      jsonb_build_object('list_id',v_list.id,'reason','account_deletion'));
    v_transferred := v_transferred + 1;
   end if;
  end if;
  delete from public.list_members
   where list_id=v_list.id and user_id=p_user;
  v_successor := null;
 end loop;
 return jsonb_build_object('transferred',v_transferred,'deleted',v_deleted);
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
-- Known unresolved: new membership inserted during preparation, actor
-- authentication, Auth identity deletion atomicity, privilege ownership,
-- historical events retention, and potential deadlocks with other workflows.
-- DO NOT expose this privileged RPC to client roles.
