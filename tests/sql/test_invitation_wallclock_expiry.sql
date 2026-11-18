-- CI regression: expiry must use wall-clock time, not transaction-start time.
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-0000000000c1'),('00000000-0000-4000-8000-0000000000d1');
INSERT INTO public.shopping_lists(id,owner_id,name)
VALUES ('10000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-0000000000c1','clock test');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000c1',true);
CREATE TEMP TABLE expiry_test_token AS
SELECT public.create_list_invitation_link('10000000-0000-4000-8000-0000000000c1') AS token;
RESET ROLE;
UPDATE public.list_invitation_links SET expires_at=clock_timestamp()+interval '1 second'
WHERE list_id='10000000-0000-4000-8000-0000000000c1';
SELECT pg_sleep(2);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',true);
DO $$
BEGIN
 BEGIN
  PERFORM public.accept_list_invitation_link((SELECT token FROM expiry_test_token));
  RAISE EXCEPTION 'expired invitation was accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='expired invitation was accepted' THEN RAISE; END IF;
  IF SQLERRM <> 'Invalid invitation' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.list_invitation_links WHERE list_id='10000000-0000-4000-8000-0000000000c1' AND accepted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'expired token was consumed';
 END IF;
END $$;
ROLLBACK;
