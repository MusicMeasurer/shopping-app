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
  IF (SELECT array_agg(position ORDER BY position) FROM public.pull_e4_account_changes(0, 2))
      IS DISTINCT FROM ARRAY['1', '2']
  THEN RAISE EXCEPTION 'Unexpected first account page'; END IF;
  IF (SELECT count(*) FROM public.pull_e4_account_changes(2, 2)
      WHERE position = '3' AND entity = 'item' AND deleted AND snapshot IS NULL) <> 1
  THEN RAISE EXCEPTION 'Missing tombstone or incorrect rollback handling'; END IF;
  IF EXISTS (SELECT 1 FROM public.pull_e4_account_changes(0, 20)
      WHERE list_id <> '38000000-0000-4000-8000-000000000101')
  THEN RAISE EXCEPTION 'Feed crossed account boundary'; END IF;
  IF has_function_privilege('anon', 'public.pull_e4_account_changes(bigint,integer)', 'EXECUTE')
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
  receipt := public.push_e4_account_changes(payload);
  IF receipt->0->'receipt' IS NULL OR receipt->1->>'code' IS DISTINCT FROM '42501'
    OR receipt->2->'receipt' IS NULL
  THEN RAISE EXCEPTION 'Mixed operation batch outcomes are incorrect'; END IF;
  IF public.push_e4_account_changes(payload) IS DISTINCT FROM receipt
  THEN RAISE EXCEPTION 'Batch replay changed operation receipts'; END IF;
  IF has_function_privilege('anon', 'public.push_e4_account_changes(jsonb)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Anonymous batch write access'; END IF;
END
$$;
ROLLBACK;
