-- Disposable PostgreSQL 017 regression: ownership transfer invalidates unclaimed links.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-000000000091'),
 ('00000000-0000-4000-8000-000000000092'),
 ('00000000-0000-4000-8000-000000000093');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000091','transfer revocation');
INSERT INTO public.list_members(list_id,user_id) VALUES
 ('10000000-0000-4000-8000-000000000091',
  '00000000-0000-4000-8000-000000000092');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);
CREATE TEMP TABLE transfer_invitation AS
 SELECT public.create_list_invitation_link('10000000-0000-4000-8000-000000000091') AS token;
SELECT public.transfer_list_ownership(
 '10000000-0000-4000-8000-000000000091',
 '00000000-0000-4000-8000-000000000092');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000093',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM transfer_invitation));
  RAISE EXCEPTION 'transfer left prior invitation redeemable';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Invalid invitation' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.list_invitation_links
   WHERE list_id='10000000-0000-4000-8000-000000000091'
   AND revoked_at IS NOT NULL AND accepted_at IS NULL) THEN
  RAISE EXCEPTION 'transfer did not revoke pending invitation';
 END IF;
 IF EXISTS (SELECT 1 FROM public.list_members
   WHERE list_id='10000000-0000-4000-8000-000000000091'
   AND user_id='00000000-0000-4000-8000-000000000093') THEN
  RAISE EXCEPTION 'outsider became member using revoked invitation';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.shopping_lists
   WHERE id='10000000-0000-4000-8000-000000000091'
   AND owner_id='00000000-0000-4000-8000-000000000092') THEN
  RAISE EXCEPTION 'ownership transfer did not persist';
 END IF;
END $$;
ROLLBACK;
