\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $test$
DECLARE first jsonb; replay jsonb; second jsonb;
BEGIN
 first:=public.create_e4_list('11111111-1111-4111-8111-111111111111','Trip','oneoff');
 replay:=public.create_e4_list('11111111-1111-4111-8111-111111111111','Trip','oneoff');
 IF first<>replay OR first->>'owner_id'<>'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 OR first->>'kind'<>'oneoff' OR (first->>'revision')::int<>0
 OR (first->>'position')::int<>0 THEN
   RAISE EXCEPTION 'Creation receipt or idempotent replay invalid';
 END IF;
 second:=public.create_e4_list('22222222-2222-4222-8222-222222222222','Home','permanent');
 IF (second->>'position')::int<>1 THEN RAISE EXCEPTION 'Position not allocated'; END IF;
 BEGIN
   PERFORM public.create_e4_list('11111111-1111-4111-8111-111111111111','Changed','oneoff');
   RAISE EXCEPTION 'Payload mismatch accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Payload mismatch accepted' THEN RAISE; END IF;
 END;
 BEGIN
   PERFORM public.create_e4_list('33333333-3333-4333-8333-333333333333','   ','oneoff');
   RAISE EXCEPTION 'Blank name accepted';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM='Blank name accepted' THEN RAISE; END IF;
 END;
END $test$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $test$
DECLARE result jsonb;
BEGIN
 result:=public.create_e4_list('11111111-1111-4111-8111-111111111111','Other','permanent');
 IF result->>'owner_id'<>'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
 OR (result->>'position')::int<>0 THEN RAISE EXCEPTION 'Owner isolation broken'; END IF;
END $test$;
RESET ROLE;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.shopping_lists)<>3 OR
 (SELECT count(*) FROM public.e4_list_create_operations)<>3 OR
 has_table_privilege('authenticated','public.e4_list_create_operations','SELECT') OR
 has_table_privilege('authenticated','public.e4_list_create_operations','INSERT') OR
 has_function_privilege('anon','public.create_e4_list(uuid,text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Creation ACL or persistence invalid'; END IF;
END $test$;
ROLLBACK;
