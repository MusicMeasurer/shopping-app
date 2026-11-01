-- ShoppingApp draft 010: server-only preparation for account deletion.
-- Apply after 009 in a disposable test database ONLY.
-- This function transfers or deletes owned lists but DOES NOT delete auth.users.
-- Never expose to authenticated, anon or client-side service keys.

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
 -- No client may invoke this function. Trusted backend must verify actor,
 -- transaction boundaries and function ownership.
 for v_list in
  select id from public.shopping_lists
  where owner_id = p_user order by id for update
 loop
  select m.user_id into v_successor
   from public.list_members m
   where m.list_id = v_list.id and m.user_id <> p_user
   order by m.joined_at asc,m.user_id asc limit 1;
  if v_successor is null then
   delete from public.shopping_lists where id = v_list.id;
   v_deleted := v_deleted + 1;
  else
   delete from public.list_members
    where list_id=v_list.id and user_id=v_successor;
   update public.shopping_lists
    set owner_id=v_successor where id=v_list.id;
   insert into public.ownership_events(list_id,old_owner,new_owner,reason)
    values(v_list.id,p_user,v_successor,'account_deletion');
   insert into public.user_notifications(recipient_id,list_id,event_type,payload)
    values(v_successor,v_list.id,'ownership_received',
     jsonb_build_object('list_id',v_list.id,'reason','account_deletion'));
   v_transferred := v_transferred + 1;
  end if;
  v_successor := null;
 end loop;
 -- Remove departing user from lists they do not own.
 -- IMPORTANT: this direct deletion does not coordinate list locks; it must
 -- be replaced before production.
 delete from public.list_members where user_id=p_user;
 return jsonb_build_object('transferred',v_transferred,'deleted',v_deleted);
end;
$$;
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
-- Explicitly NO GRANT EXECUTE to client roles.
-- Must audit EXECUTE via PUBLIC/default grants, function owner and any
-- privileged API path. This is a draft for controlled testing only.
