-- Verify persisted pre-017 data and post-upgrade invitation RPC behavior.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.shopping_lists
  WHERE id='10000000-0000-4000-8000-0000000000f8'
  AND owner_id='00000000-0000-4000-8000-0000000000f8'
  AND name='existing groceries' AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'existing list lost or modified by 017';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.list_members
  WHERE list_id='10000000-0000-4000-8000-0000000000f8'
  AND user_id='00000000-0000-4000-8000-0000000000f9') THEN
  RAISE EXCEPTION 'existing member lost by 017';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.shopping_items
  WHERE id='20000000-0000-4000-8000-0000000000f8'
  AND name='milk' AND purchased AND quantity=2 AND unit='L'
  AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'existing item lost or modified by 017';
 END IF;
END $$;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000f8',true);
DO $$
DECLARE v_token text; v_id uuid;
BEGIN
 v_token := public.create_list_invitation_link('10000000-0000-4000-8000-0000000000f8');
 IF length(v_token)<>64 THEN RAISE EXCEPTION 'upgrade owner cannot issue link'; END IF;
 SELECT invitation_id INTO v_id FROM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000f8');
 IF v_id IS NULL THEN RAISE EXCEPTION 'upgrade owner cannot list link'; END IF;
 PERFORM public.revoke_list_invitation_link(v_id);
 IF EXISTS (SELECT 1 FROM public.list_pending_invitation_links('10000000-0000-4000-8000-0000000000f8')) THEN
  RAISE EXCEPTION 'upgrade owner cannot revoke link';
 END IF;
END $$;
ROLLBACK;
