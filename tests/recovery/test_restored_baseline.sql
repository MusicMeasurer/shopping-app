-- CI-only structural and behavioral smoke checks after rebuilding baseline 001-016 + ACL.
-- The historic live lab has additional migrations: this checks a safe baseline, NOT full parity.
BEGIN;
DO $$
DECLARE
  required text;
BEGIN
  FOREACH required IN ARRAY ARRAY[
    'shopping_lists','shopping_items','item_operations','list_changes','list_members'
  ] LOOP
    IF to_regclass('public.' || required) IS NULL THEN
      RAISE EXCEPTION 'Missing restored table: %', required;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='apply_item_change'
  ) THEN
    RAISE EXCEPTION 'Missing restored mutation function';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='pull_item_changes'
  ) THEN
    RAISE EXCEPTION 'Missing restored pull function';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relname IN ('shopping_lists','shopping_items','item_operations','list_changes')
      AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Restored table missing RLS';
  END IF;
  IF has_table_privilege('anon','public.shopping_lists','SELECT') THEN
    RAISE EXCEPTION 'Anonymous access unexpectedly permitted';
  END IF;
  IF has_function_privilege('anon','public.apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint)','EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous mutation unexpectedly permitted';
  END IF;
END $$;
ROLLBACK;
