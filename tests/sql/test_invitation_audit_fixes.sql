-- CI-only regression for audit fixes. Run after 017 audit-fix candidate.
GRANT INSERT,SELECT ON public.shopping_lists TO authenticated;
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-0000000000a1'),('00000000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES ('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','audit fixture');
CREATE TEMP TABLE audit_token(token text);
INSERT INTO audit_token SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000a1'))<>1 THEN
  RAISE EXCEPTION 'owner inventory incorrect';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000a1');
  RAISE EXCEPTION 'outsider inventory allowed';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='outsider inventory allowed' THEN RAISE; END IF;
 END;
 PERFORM public.accept_list_invitation_link((SELECT token FROM audit_token));
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO audit_token SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM audit_token ORDER BY token DESC LIMIT 1));
  RAISE EXCEPTION 'existing member consumed invitation';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='existing member consumed invitation' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.list_invitation_links WHERE accepted_at IS NULL AND revoked_at IS NULL)<>1 THEN
  RAISE EXCEPTION 'existing member consumed pending link';
 END IF;
END $$;
ROLLBACK;
