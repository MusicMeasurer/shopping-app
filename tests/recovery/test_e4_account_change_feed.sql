BEGIN;

INSERT INTO auth.users (id) VALUES
  ('38000000-0000-4000-8000-000000000001'),
  ('38000000-0000-4000-8000-000000000002');
INSERT INTO public.shopping_lists (id, owner_id, name) VALUES
  ('38000000-0000-4000-8000-000000000101', '38000000-0000-4000-8000-000000000001', 'Feed A'),
  ('38000000-0000-4000-8000-000000000102', '38000000-0000-4000-8000-000000000002', 'Feed B');
INSERT INTO public.shopping_items (id, list_id, name) VALUES
  ('38000000-0000-4000-8000-000000000201', '38000000-0000-4000-8000-000000000101', 'Milk');
SAVEPOINT discarded_event;
UPDATE public.shopping_items SET name = 'Rolled back'
WHERE id = '38000000-0000-4000-8000-000000000201';
ROLLBACK TO SAVEPOINT discarded_event;
UPDATE public.shopping_items SET deleted_at = now()
WHERE id = '38000000-0000-4000-8000-000000000201';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-000000000001', true);
DO $$
BEGIN
  IF (SELECT array_agg(event_position ORDER BY event_position) FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 0, 2))
      IS DISTINCT FROM ARRAY['1', '2']
  THEN RAISE EXCEPTION 'Unexpected first account page'; END IF;
  IF (SELECT count(*) FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 2, 2)
      WHERE event_position = '3' AND entity = 'item' AND deleted AND snapshot IS NULL) <> 1
  THEN RAISE EXCEPTION 'Missing tombstone or incorrect rollback handling'; END IF;
  IF EXISTS (SELECT 1 FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 0, 20)
      WHERE list_id <> '38000000-0000-4000-8000-000000000101')
  THEN RAISE EXCEPTION 'Feed crossed account boundary'; END IF;
  IF has_function_privilege('anon', 'public.pull_e4_account_changes(uuid,bigint,integer)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous feed access'; END IF;
END
$$;
DO $$
DECLARE
  payload jsonb := '[
    {"operation_id":"38000000-0000-4000-8000-000000000301","list_id":"38000000-0000-4000-8000-000000000101","item_id":"38000000-0000-4000-8000-000000000202","kind":"add","name":"Bread","purchased":false},
    {"operation_id":"38000000-0000-4000-8000-000000000302","list_id":"38000000-0000-4000-8000-000000000102","item_id":"38000000-0000-4000-8000-000000000203","kind":"add","name":"Other account","purchased":false},
    {"operation_id":"38000000-0000-4000-8000-000000000303","list_id":"38000000-0000-4000-8000-000000000101","item_id":"38000000-0000-4000-8000-000000000204","kind":"add","name":"Apples","purchased":false}
  ]'::jsonb;
  receipt jsonb;
BEGIN
  receipt := public.push_e4_account_changes('38000000-0000-4000-8000-000000000001', payload);
  IF receipt->0->'receipt' IS NULL OR receipt->1->>'code' IS DISTINCT FROM '42501'
    OR receipt->2->'receipt' IS NULL
  THEN RAISE EXCEPTION 'Mixed operation batch outcomes are incorrect'; END IF;
  IF public.push_e4_account_changes('38000000-0000-4000-8000-000000000001', payload) IS DISTINCT FROM receipt
  THEN RAISE EXCEPTION 'Batch replay changed operation receipts'; END IF;
  IF has_function_privilege('anon', 'public.push_e4_account_changes(uuid,jsonb)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous batch write access'; END IF;
END
$$;
DO $$
DECLARE
  state jsonb;
BEGIN
  state := public.snapshot_e4_account_changes('38000000-0000-4000-8000-000000000001');
  IF jsonb_array_length(state->'lists') <> 1 OR jsonb_array_length(state->'items') <> 2
    OR state->>'position' IS DISTINCT FROM (SELECT max(event_position::bigint)::text
      FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 0, 50))
  THEN RAISE EXCEPTION 'Snapshot and journal watermark disagree'; END IF;
  IF public.snapshot_e4_account_changes('38000000-0000-4000-8000-000000000002') IS NOT NULL
  THEN RAISE EXCEPTION 'Foreign snapshot visible'; END IF;
  BEGIN
    PERFORM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000002', 0, 50);
    RAISE EXCEPTION 'Mismatched account accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;
RESET ROLE;
DELETE FROM shoppingapp_internal.account_feed_events
WHERE account_id = '38000000-0000-4000-8000-000000000001' AND event_position < 3;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 1, 50);
    RAISE EXCEPTION 'Expired cursor accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
END
$$;
RESET ROLE;
INSERT INTO public.list_members (list_id, user_id) VALUES
  ('38000000-0000-4000-8000-000000000101', '38000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
SELECT public.transfer_list_ownership('38000000-0000-4000-8000-000000000101', '38000000-0000-4000-8000-000000000002');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 2, 50)
    WHERE entity = 'list' AND deleted) THEN RAISE EXCEPTION 'Former owner did not receive list removal'; END IF;
  IF EXISTS (SELECT 1 FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000001', 2, 50)
    WHERE snapshot IS NOT NULL) THEN RAISE EXCEPTION 'Former owner has access to transferred snapshots'; END IF;
END
$$;
SELECT set_config('request.jwt.claim.sub', '38000000-0000-4000-8000-000000000002', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.pull_e4_account_changes('38000000-0000-4000-8000-000000000002', 1, 50)
    WHERE NOT deleted AND list_id = '38000000-0000-4000-8000-000000000101') <> 3
  THEN RAISE EXCEPTION 'New owner did not receive transferred list and active items'; END IF;
END
$$;
ROLLBACK;
