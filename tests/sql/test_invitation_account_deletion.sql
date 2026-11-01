-- Disposable CI regression: auth account deletion must not be blocked by invitation history.
-- Invitation records are ephemeral and are removed when issuer or acceptor is deleted.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-000000000071'),
 ('00000000-0000-4000-8000-000000000072'),
 ('00000000-0000-4000-8000-000000000073');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000071','issuer deletion'),
 ('10000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000073','acceptor deletion');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',true);
CREATE TEMP TABLE issuer_token AS SELECT public.create_list_invitation_link('10000000-0000-4000-8000-000000000071') token;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000073',true);
CREATE TEMP TABLE acceptor_token AS SELECT public.create_list_invitation_link('10000000-0000-4000-8000-000000000073') token;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',true);
SELECT public.accept_list_invitation_link((SELECT token FROM acceptor_token));
RESET ROLE;
-- Deleting accepting account must remove accepted invitation but preserve owner/list.
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000072';
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.list_invitation_links WHERE list_id='10000000-0000-4000-8000-000000000073') THEN
  RAISE EXCEPTION 'accepted invitation survived acceptor account deletion';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.shopping_lists WHERE id='10000000-0000-4000-8000-000000000073') THEN
  RAISE EXCEPTION 'unrelated owner list was deleted';
 END IF;
END $$;
-- Deleting issuer account must remove outstanding invitations.
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000071';
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.list_invitation_links WHERE created_by='00000000-0000-4000-8000-000000000071') THEN
  RAISE EXCEPTION 'issuer invitation survived account deletion';
 END IF;
END $$;
ROLLBACK;
