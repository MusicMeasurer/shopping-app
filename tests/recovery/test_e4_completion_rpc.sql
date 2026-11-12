\set ON_ERROR_STOP on
INSERT INTO auth.users(id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.shopping_lists(id,owner_id,name) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Weekly'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Private'),
 ('33333333-3333-4333-8333-333333333333','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Nothing'),
 ('44444444-4444-4444-8444-444444444444','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unmarked');
INSERT INTO public.shopping_items(id,list_id,name,purchased,quantity,unit) VALUES
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','Milk',true,2,'l'),
 ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','Bread',false,1,null),
 ('77777777-7777-4777-8777-777777777777','22222222-2222-4222-8222-222222222222','Secret',true,1,null),
 ('88888888-8888-4888-8888-888888888888','33333333-3333-4333-8333-333333333333','Eggs',true,3,null),
 ('99999999-9999-4999-8999-999999999999','44444444-4444-4444-8444-444444444444','Tea',false,1,null);
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$
DECLARE r jsonb; again jsonb;
BEGIN
 BEGIN
   perform public.complete_e4_list('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','22222222-2222-4222-8222-222222222222',0,'all_purchased');
   raise exception 'Foreign list completion succeeded';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Foreign list completion succeeded' THEN RAISE; END IF;
 END;
 r:=public.complete_e4_list('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',0,'marked_only');
 again:=public.complete_e4_list('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',0,'marked_only');
 IF r<>again OR r->>'archive_id' IS NULL THEN RAISE EXCEPTION 'Replay or archive failed'; END IF;
 BEGIN
   perform public.complete_e4_list('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111',0,'all_purchased');
   raise exception 'Payload mismatch accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Payload mismatch accepted' THEN RAISE; END IF;
 END;
 BEGIN
   perform public.complete_e4_list('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111',0,'all_purchased');
   raise exception 'Stale revision accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Stale revision accepted' THEN RAISE; END IF;
 END;
 perform public.complete_e4_list('dddddddd-dddd-4ddd-8ddd-dddddddddddd','33333333-3333-4333-8333-333333333333',0,'none_purchased');
 perform public.complete_e4_list('cccccccc-cccc-4ccc-8ccc-cccccccccccc','44444444-4444-4444-8444-444444444444',0,'marked_only');
END $$;
RESET ROLE;
DO $$
BEGIN
 IF (select count(*) from public.e4_archive_completions)<>1
 OR (select count(*) from public.e4_archive_items)<>1
 OR (select count(*) from public.list_changes where list_id='11111111-1111-4111-8111-111111111111')<>2
 OR (select revision from public.shopping_lists where id='11111111-1111-4111-8111-111111111111')<>2
 OR (select count(*) from public.shopping_items where list_id='11111111-1111-4111-8111-111111111111' and deleted_at is null)<>0
 THEN RAISE EXCEPTION 'Completion persistence or tombstones failed'; END IF;
END $$;
DELETE FROM public.e4_completion_receipts;
DELETE FROM public.e4_archive_completions;
DELETE FROM public.shopping_lists;
DELETE FROM auth.users WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
