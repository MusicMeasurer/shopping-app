-- Isolated CI permission audit for invitation candidate 017.
-- Check role privileges directly, then exercise owner and outsider RPCs.
DO $$
BEGIN
 IF has_table_privilege('authenticated','public.list_invitation_links','SELECT')
 OR has_table_privilege('authenticated','public.list_invitation_links','INSERT')
 OR has_table_privilege('authenticated','public.list_invitation_links','UPDATE')
 OR has_table_privilege('authenticated','public.list_invitation_links','DELETE')
 OR has_table_privilege('anon','public.list_invitation_links','SELECT')
 OR has_table_privilege('anon','public.list_invitation_links','INSERT')
 OR has_table_privilege('anon','public.list_invitation_links','UPDATE')
 OR has_table_privilege('anon','public.list_invitation_links','DELETE') THEN
  RAISE EXCEPTION 'direct invitation table privileges exposed';
 END IF;
 IF has_table_privilege('authenticated','public.list_members','INSERT')
 OR has_table_privilege('authenticated','public.list_members','UPDATE')
 OR has_table_privilege('authenticated','public.list_members','DELETE') THEN
  RAISE EXCEPTION 'direct membership writes exposed';
 END IF;
 IF has_function_privilege('anon','public.create_list_invitation_link(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.accept_list_invitation_link(text)','EXECUTE')
 OR has_function_privilege('anon','public.revoke_list_invitation_link(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.list_pending_invitation_links(uuid)','EXECUTE')
 OR has_function_privilege('anon','public.accept_list_invitation_link(text)','EXECUTE') THEN
  RAISE EXCEPTION 'anonymous function execution exposed';
 END IF;
 IF NOT has_function_privilege('authenticated','public.accept_list_invitation_link(text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.list_pending_invitation_links(uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'authenticated RPC grant missing';
 END IF;
END $$;
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-0000000000e1'),
 ('00000000-0000-4000-8000-0000000000f1');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-0000000000e1','permission audit');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-0000000000e1');
  RAISE EXCEPTION 'nonowner issued invitation';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='nonowner issued invitation' OR SQLERRM<>'Permission denied' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.revoke_list_invitation_link('10000000-0000-4000-8000-0000000000e1');
  RAISE EXCEPTION 'nonowner revoked invitation';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='nonowner revoked invitation' OR SQLERRM<>'Permission denied' THEN RAISE; END IF;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000e1',true);
CREATE TEMP TABLE owner_invite AS
SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000e1') AS token;
DO $$
DECLARE inv uuid;
BEGIN
 SELECT invitation_id INTO inv FROM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000e1');
 IF inv IS NULL THEN RAISE EXCEPTION 'owner cannot find invitation'; END IF;
 PERFORM public.revoke_list_invitation_link(inv);
 IF EXISTS (SELECT 1 FROM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000e1')) THEN
  RAISE EXCEPTION 'revoked invitation remains pending';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM owner_invite));
  RAISE EXCEPTION 'revoked invitation accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='revoked invitation accepted' OR SQLERRM<>'Invalid invitation' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
