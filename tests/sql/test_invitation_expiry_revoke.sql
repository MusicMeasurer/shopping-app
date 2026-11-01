-- Disposable PostgreSQL CI only. Test expiry and explicit revocation, rollback.
GRANT INSERT,SELECT ON public.shopping_lists TO authenticated;
BEGIN;
INSERT INTO auth.users(id) VALUES
('00000000-0000-4000-8000-0000000000a1'),
('00000000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
('10000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a1','expiry/revoke fixture');
CREATE TEMP TABLE invite_fixture(label text primary key, token text, invitation_id uuid);
INSERT INTO invite_fixture(label,token) VALUES
('expired',public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1')),
('revoked',public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1')),
('valid',public.create_list_invitation_link('10000000-0000-4000-8000-0000000000a1'));
RESET ROLE;
UPDATE invite_fixture f SET invitation_id=i.id
FROM public.list_invitation_links i
WHERE i.token_hash=encode(extensions.digest(f.token,'sha256'),'hex');
UPDATE public.list_invitation_links SET expires_at=now()-interval '1 second'
WHERE id=(SELECT invitation_id FROM invite_fixture WHERE label='expired');
DO $$
BEGIN
 IF (SELECT count(*) FROM public.list_invitation_links i JOIN invite_fixture f ON i.id=f.invitation_id
     WHERE f.label='valid' AND i.expires_at-i.created_at BETWEEN interval '23 hours 59 minutes' AND interval '24 hours 1 minute')<>1
 THEN RAISE EXCEPTION '24h creation TTL mismatch'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
SELECT public.revoke_list_invitation_link((SELECT invitation_id FROM invite_fixture WHERE label='revoked'));
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
DECLARE v_label text; v_token text;
BEGIN
 FOR v_label,v_token IN SELECT label,token FROM invite_fixture WHERE label IN ('expired','revoked')
 LOOP
  BEGIN
   PERFORM public.accept_list_invitation_link(v_token);
   RAISE EXCEPTION 'SECURITY TEST FAIL: % invite accepted',v_label;
  EXCEPTION WHEN OTHERS THEN
   IF SQLERRM LIKE 'SECURITY TEST FAIL:%' THEN RAISE; END IF;
  END;
 END LOOP;
 IF public.can_access_list('10000000-0000-4000-8000-0000000000a1') THEN
  RAISE EXCEPTION 'failed invites granted access';
 END IF;
 IF public.accept_list_invitation_link((SELECT token FROM invite_fixture WHERE label='valid'))
  <> '10000000-0000-4000-8000-0000000000a1'::uuid THEN
  RAISE EXCEPTION 'valid invite failed';
 END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (SELECT count(*) FROM public.list_invitation_links WHERE accepted_at IS NOT NULL)<>1 THEN
  RAISE EXCEPTION 'wrong accepted count';
 END IF;
 IF (SELECT count(*) FROM public.list_members WHERE list_id='10000000-0000-4000-8000-0000000000a1')<>1 THEN
  RAISE EXCEPTION 'wrong member count';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.list_invitation_links i JOIN invite_fixture f ON i.id=f.invitation_id
  WHERE f.label='revoked' AND i.revoked_at IS NOT NULL AND i.accepted_at IS NULL) THEN
  RAISE EXCEPTION 'revoke state incorrect';
 END IF;
END $$;
ROLLBACK;
