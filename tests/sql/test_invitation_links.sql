-- Disposable CI only; migrations 001-016 and REVIEW_ONLY 017 pre-applied.
GRANT SELECT,INSERT ON public.shopping_lists TO authenticated;
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000b1'),
 ('00000000-0000-4000-8000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','invitation fixture');
CREATE TEMP TABLE invitation_test_token(token text);
INSERT INTO invitation_test_token SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.list_invitation_links WHERE list_id='10000000-0000-4000-8000-0000000000a1' AND expires_at-created_at > interval '24 hours 1 second') <> 0 THEN
  RAISE EXCEPTION 'TTL exceeded 24 hours';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
DECLARE v_token text;
BEGIN
 SELECT token INTO v_token FROM invitation_test_token;
 IF public.accept_list_invitation_link(v_token) <> '10000000-0000-4000-8000-0000000000a1'::uuid THEN
  RAISE EXCEPTION 'accept returned wrong list';
 END IF;
 IF NOT public.can_access_list('10000000-0000-4000-8000-0000000000a1') THEN
  RAISE EXCEPTION 'accepted member cannot access list';
 END IF;
 BEGIN
  PERFORM public.accept_list_invitation_link(v_token);
  RAISE EXCEPTION 'replay succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='replay succeeded' THEN RAISE; END IF;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM invitation_test_token));
  RAISE EXCEPTION 'third party replay succeeded';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='third party replay succeeded' THEN RAISE; END IF;
 END;
 IF public.can_access_list('10000000-0000-4000-8000-0000000000a1') THEN
  RAISE EXCEPTION 'third party acquired membership';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO invitation_test_token SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1');
SELECT public.transfer_list_ownership('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000b1');
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.list_invitation_links WHERE accepted_at IS NULL AND revoked_at IS NULL) THEN
  RAISE EXCEPTION 'transfer left pending invitations';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM invitation_test_token ORDER BY token DESC LIMIT 1));
  RAISE EXCEPTION 'revoked link accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='revoked link accepted' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
