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
ROLLBACK;
