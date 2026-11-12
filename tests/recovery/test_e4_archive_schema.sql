\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.e4_archive_completions'::regclass AND relrowsecurity)
    OR NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.e4_archive_items'::regclass AND relrowsecurity)
  THEN RAISE EXCEPTION 'Archive RLS disabled'; END IF;
  IF has_table_privilege('authenticated','public.e4_archive_completions','INSERT')
     OR has_table_privilege('authenticated','public.e4_archive_items','UPDATE')
     OR has_table_privilege('anon','public.e4_archive_completions','SELECT')
  THEN RAISE EXCEPTION 'Unsafe archive grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.e4_archive_completions'::regclass
      AND confrelid='public.shopping_lists'::regclass)
  THEN RAISE EXCEPTION 'Archive cascades from active list'; END IF;
END $$;
-- SQL-level policy smoke test with two ephemeral users and non-client setup.
INSERT INTO auth.users(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.e4_archive_completions
 (id,owner_id,source_list_id,source_list_name,operation_id)
 VALUES
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Groceries','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
INSERT INTO public.e4_archive_items(completion_id,ordinal,name,quantity,unit)
 VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',0,'Milk',2,'l');
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.e4_archive_completions) <> 1
 OR (SELECT count(*) FROM public.e4_archive_items) <> 1 THEN
 RAISE EXCEPTION 'Owner cannot read archive'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',false);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.e4_archive_completions) <> 0
 OR (SELECT count(*) FROM public.e4_archive_items) <> 0 THEN
 RAISE EXCEPTION 'Foreign archive leaked'; END IF;
END $$;
RESET ROLE;
DELETE FROM public.e4_archive_completions;
DELETE FROM auth.users WHERE id IN ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
