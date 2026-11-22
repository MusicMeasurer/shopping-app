\set ON_ERROR_STOP on
-- E4 must not expose direct list metadata or revision updates to authenticated clients.
DO $test$
BEGIN
 IF has_table_privilege('authenticated','public.shopping_lists','UPDATE')
 OR has_column_privilege('authenticated','public.shopping_lists','revision','UPDATE')
 OR has_column_privilege('authenticated','public.shopping_lists','kind','UPDATE')
 OR has_column_privilege('authenticated','public.shopping_lists','position','UPDATE')
 OR has_column_privilege('authenticated','public.shopping_lists','deleted_at','UPDATE')
 THEN RAISE EXCEPTION 'Direct E4 list update bypass is open'; END IF;
 IF has_table_privilege('anon','public.shopping_lists','UPDATE')
 THEN RAISE EXCEPTION 'Anonymous list mutation privilege'; END IF;
END $test$;
