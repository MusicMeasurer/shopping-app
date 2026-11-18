-- Disposable PostgreSQL CI database ONLY; run after migrations 001-016.
-- A trusted fixture inserts membership (not an invitation flow).
-- All changes are rolled back. No persistent data or Data API needed.
GRANT SELECT, INSERT ON public.shopping_lists TO authenticated;
GRANT SELECT ON public.shopping_items, public.list_members TO authenticated;
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('00000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('10000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000a1','temporary membership fixture');
RESET ROLE;
-- Trusted server-side fixture, not a client operation.
INSERT INTO public.list_members(list_id,user_id) VALUES
 ('10000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
BEGIN
 IF NOT public.can_access_list('10000000-0000-4000-8000-0000000000a1') THEN
   RAISE EXCEPTION 'member cannot access list';
 END IF;
 IF (SELECT count(*) FROM public.shopping_lists
     WHERE id='10000000-0000-4000-8000-0000000000a1') <> 1 THEN
   RAISE EXCEPTION 'member cannot read shared list';
 END IF;
END $$;
-- Member writes via authorized RPC, not direct INSERT.
SELECT public.apply_item_change(
 '20000000-0000-4000-8000-0000000000b1',
 '10000000-0000-4000-8000-0000000000a1','add',
 '30000000-0000-4000-8000-0000000000b1','shared test item');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000a1',true);
SELECT public.remove_list_member(
 '10000000-0000-4000-8000-0000000000a1',
 '00000000-0000-4000-8000-0000000000b1');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000b1',true);
DO $$
BEGIN
 IF public.can_access_list('10000000-0000-4000-8000-0000000000a1') THEN
   RAISE EXCEPTION 'revoked member retained access';
 END IF;
 IF EXISTS (SELECT 1 FROM public.shopping_lists
            WHERE id='10000000-0000-4000-8000-0000000000a1') THEN
   RAISE EXCEPTION 'revoked member can still read list';
 END IF;
END $$;
-- Unauthorized post-revocation mutation must raise.
DO $$
BEGIN
 BEGIN
   PERFORM public.apply_item_change(
     '20000000-0000-4000-8000-0000000000b2',
     '10000000-0000-4000-8000-0000000000a1','add',
     '30000000-0000-4000-8000-0000000000b2','must not exist');
   RAISE EXCEPTION 'revoked member mutation unexpectedly succeeded';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM = 'revoked member mutation unexpectedly succeeded' THEN
     RAISE;
   END IF;
 END;
END $$;
ROLLBACK;
