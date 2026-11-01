-- CI regression for pending invitation cap (disposable database only).
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000081');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000081','cap fixture');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
DO $$
DECLARE i int;
BEGIN
 FOR i IN 1..10 LOOP
  PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
 END LOOP;
 IF (SELECT count(*) FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081')) <> 10 THEN
  RAISE EXCEPTION 'pending count mismatch';
 END IF;
 BEGIN
  PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
  RAISE EXCEPTION 'limit bypass';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Too many pending invitations' THEN RAISE; END IF;
 END;
END $$;
-- Revoke one pending link: the slot must become reusable.
DO $
DECLARE v_id uuid;
BEGIN
 SELECT invitation_id INTO v_id FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081') LIMIT 1;
 PERFORM public.revoke_list_invitation_link(v_id);
 PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
 IF (SELECT count(*) FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081')) <> 10 THEN
  RAISE EXCEPTION 'revoke did not free a slot';
 END IF;
END $;
RESET ROLE;
-- Simulate expiry of one unconsumed invitation in this disposable test transaction.
UPDATE public.list_invitation_links SET expires_at=clock_timestamp()-interval '1 second'
WHERE id=(SELECT id FROM public.list_invitation_links
 WHERE list_id='10000000-0000-4000-8000-000000000081'
 AND revoked_at IS NULL AND accepted_at IS NULL
 ORDER BY created_at,id LIMIT 1);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
DO $
BEGIN
 PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
 IF (SELECT count(*) FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081')) <> 10 THEN
  RAISE EXCEPTION 'expiry did not free a slot';
 END IF;
END $;
-- Repeated revoke/create cannot bypass the rolling 24-hour issuance cap.
DO $
DECLARE v_id uuid; v_total int;
BEGIN
 LOOP
  SELECT count(*) INTO v_total FROM public.list_invitation_links
   WHERE list_id='10000000-0000-4000-8000-000000000081'
     AND created_at > clock_timestamp()-interval '24 hours';
  EXIT WHEN v_total >= 20;
  SELECT invitation_id INTO v_id FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081') LIMIT 1;
  PERFORM public.revoke_list_invitation_link(v_id);
  PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
 END LOOP;
 SELECT invitation_id INTO v_id FROM public.list_pending_invitation_links('10000000-0000-4000-8000-000000000081') LIMIT 1;
 PERFORM public.revoke_list_invitation_link(v_id);
 BEGIN
  PERFORM public.create_list_invitation_link('10000000-0000-4000-8000-000000000081');
  RAISE EXCEPTION 'daily cap bypass';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'Daily invitation creation limit reached' THEN RAISE; END IF;
 END;
END $;
ROLLBACK;
