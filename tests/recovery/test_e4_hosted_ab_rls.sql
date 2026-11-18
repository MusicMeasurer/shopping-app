\set ON_ERROR_STOP on
-- Mirrors the hosted rollback-only A/B role and JWT claim probe.
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('bbbbbbbb-aaaa-4bbb-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.shopping_lists(id,owner_id,name,kind)
 VALUES ('eeeeeeee-1111-4111-8111-111111111111','bbbbbbbb-aaaa-4bbb-8aaa-aaaaaaaaaaaa','AB regression','permanent');
INSERT INTO public.shopping_items(id,list_id,name,purchased)
 VALUES ('eeeeeeee-2222-4222-8222-222222222222','eeeeeeee-1111-4111-8111-111111111111','Apple',true);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $test$
BEGIN
 IF EXISTS (SELECT 1 FROM public.shopping_lists WHERE id='eeeeeeee-1111-4111-8111-111111111111')
 THEN RAISE EXCEPTION 'B sees A list'; END IF;
 BEGIN
  PERFORM public.complete_e4_list('eeeeeeee-3333-4333-8333-333333333333','eeeeeeee-1111-4111-8111-111111111111',0,'all_purchased');
  RAISE EXCEPTION 'B completed A list';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='B completed A list' THEN RAISE; END IF;
 END;
END $test$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-aaaa-4bbb-8aaa-aaaaaaaaaaaa',false);
DO $test$
DECLARE v jsonb;
BEGIN
 v:=public.complete_e4_list('eeeeeeee-3333-4333-8333-333333333333','eeeeeeee-1111-4111-8111-111111111111',0,'all_purchased');
 IF v->>'archive_id' IS NULL OR
 (SELECT count(*) FROM public.e4_archive_completions WHERE source_list_id='eeeeeeee-1111-4111-8111-111111111111')<>1
 THEN RAISE EXCEPTION 'A cannot complete or read archive'; END IF;
END $test$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $test$
BEGIN
 IF EXISTS (SELECT 1 FROM public.e4_archive_completions WHERE source_list_id='eeeeeeee-1111-4111-8111-111111111111')
 OR EXISTS (SELECT 1 FROM public.e4_archive_items WHERE source_item_id='eeeeeeee-2222-4222-8222-222222222222')
 THEN RAISE EXCEPTION 'B sees A archive'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
