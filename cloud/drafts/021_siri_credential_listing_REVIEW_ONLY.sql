-- E3 Siri metadata-only listing; apply to reviewed environments only.
-- Does not return tokens or hashes.
create or replace function public.list_siri_shortcuts(p_list uuid)
returns table(credential_id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz)
language sql security definer set search_path = ''
as $$
 select c.id,c.created_at,c.expires_at,c.revoked_at
 from public.siri_shortcut_credentials c
 join public.shopping_lists l on l.id=c.list_id
 where l.id=p_list and l.owner_id=auth.uid() and l.deleted_at is null
   and c.owner_id=auth.uid()
 order by c.created_at desc
$$;
revoke all on function public.list_siri_shortcuts(uuid) from public,anon;
grant execute on function public.list_siri_shortcuts(uuid) to authenticated;
