\set ON_ERROR_STOP on
-- Isolated PostgreSQL only. A/B owner isolation, idempotency, version gate and ACL.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.shopping_lists(id,owner_id,name,kind,position) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Groceries','permanent',0),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private','permanent',0);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $test$
DECLARE first_result jsonb; replay jsonb;
BEGIN
 first_result := public.apply_e4_list_metadata(
  '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',0,'Renamed',null,null);
 replay := public.apply_e4_list_metadata(
  '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',0,'Renamed',null,null);
 IF first_result <> replay OR first_result->>'operation_id' <> '33333333-3333-4333-8333-333333333333'
 OR (first_result->>'revision')::bigint <> 1 OR first_result->>'name' <> 'Renamed'
 THEN RAISE EXCEPTION 'Rename receipt or replay invalid'; END IF;
 BEGIN
  PERFORM public.apply_e4_list_metadata(
   '33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',0,'Different',null,null);
  RAISE EXCEPTION 'Changed payload replay accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'Changed payload replay accepted' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.apply_e4_list_metadata(
   '44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',0,null,'oneoff',null);
  RAISE EXCEPTION 'Stale revision accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'Stale revision accepted' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.apply_e4_list_metadata(
   '55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222',0,'Intrusion',null,null);
  RAISE EXCEPTION 'Foreign mutation accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'Foreign mutation accepted' THEN RAISE; END IF;
 END;
 PERFORM public.apply_e4_list_metadata(
  '66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',1,null,'oneoff',null);
 PERFORM public.apply_e4_list_metadata(
  '77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',2,null,null,3);
 IF (SELECT revision FROM public.shopping_lists WHERE id='11111111-1111-4111-8111-111111111111')<>3
 THEN RAISE EXCEPTION 'Revision did not advance'; END IF;
 BEGIN
  PERFORM public.apply_e4_list_metadata(
   '88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111',3,null,null,null);
  RAISE EXCEPTION 'Empty mutation accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'Empty mutation accepted' THEN RAISE; END IF;
 END;
END $test$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $test$
BEGIN
 IF EXISTS (SELECT 1 FROM public.e4_list_operations)
 THEN RAISE EXCEPTION 'Operation receipts visible directly'; END IF;
 BEGIN
  PERFORM public.apply_e4_list_metadata(
   '99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111',3,'Hijack',null,null);
  RAISE EXCEPTION 'B modified A list';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'B modified A list' THEN RAISE; END IF;
 END;
END $test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT name FROM public.shopping_lists WHERE id='11111111-1111-4111-8111-111111111111')<>'Renamed'
 OR (SELECT kind FROM public.shopping_lists WHERE id='11111111-1111-4111-8111-111111111111')<>'oneoff'
 OR (SELECT position FROM public.shopping_lists WHERE id='11111111-1111-4111-8111-111111111111')<>3
 OR (SELECT name FROM public.shopping_lists WHERE id='22222222-2222-4222-8222-222222222222')<>'Private'
 OR (SELECT count(*) FROM public.e4_list_operations)<>3
 THEN RAISE EXCEPTION 'Persisted metadata or operation isolation invalid'; END IF;
 IF has_table_privilege('authenticated','public.e4_list_operations','SELECT')
 OR has_table_privilege('authenticated','public.e4_list_operations','INSERT')
 OR has_function_privilege('anon','public.apply_e4_list_metadata(uuid,uuid,bigint,text,text,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'Metadata RPC grants unsafe'; END IF;
END $test$;
ROLLBACK;
