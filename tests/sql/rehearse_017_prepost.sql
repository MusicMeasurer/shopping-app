-- Run ONLY against a disposable database with migrations 001-016 installed.
-- psql -v ON_ERROR_STOP=1 -f tests/sql/rehearse_017_prepost.sql
-- Entire migration is applied and validated inside a transaction, then rolled back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE audit_pre_rows(table_name text, row_data jsonb) ON COMMIT DROP;
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT schemaname,tablename FROM pg_tables
          WHERE schemaname='public' AND tablename <> 'list_invitation_links'
 LOOP
  EXECUTE format('INSERT INTO audit_pre_rows SELECT %L, to_jsonb(t) FROM %I.%I t',
    r.tablename,r.schemaname,r.tablename);
 END LOOP;
END $$;
CREATE TEMP TABLE audit_pre_counts AS
SELECT table_name,count(*) AS n FROM audit_pre_rows GROUP BY table_name;
-- Keep the original SQL unchanged; path relative to this test script.
\ir ../../cloud/drafts/017_invitation_links_AUDIT_FIX_REVIEW_ONLY.sql
DO $$
DECLARE mismatches integer; r record;
BEGIN
 -- Verify that all existing public tables retain identical row multisets.
 CREATE TEMP TABLE audit_post_rows(table_name text,row_data jsonb) ON COMMIT DROP;
 FOR r IN SELECT schemaname,tablename FROM pg_tables
          WHERE schemaname='public' AND tablename <> 'list_invitation_links'
 LOOP
  EXECUTE format('INSERT INTO audit_post_rows SELECT %L, to_jsonb(t) FROM %I.%I t',
    r.tablename,r.schemaname,r.tablename);
 END LOOP;
 SELECT count(*) INTO mismatches FROM (
  (SELECT table_name,row_data FROM audit_pre_rows EXCEPT ALL
   SELECT table_name,row_data FROM audit_post_rows)
  UNION ALL
  (SELECT table_name,row_data FROM audit_post_rows EXCEPT ALL
   SELECT table_name,row_data FROM audit_pre_rows)
 ) delta;
 IF mismatches <> 0 THEN
  RAISE EXCEPTION '017 changed % existing public row(s) in rehearsal', mismatches;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid='public.list_invitation_links'::regclass AND relrowsecurity)
 THEN RAISE EXCEPTION 'Invitation RLS not enabled'; END IF;
 IF has_table_privilege('authenticated','public.list_invitation_links','SELECT')
 THEN RAISE EXCEPTION 'Unexpected direct invitation SELECT'; END IF;
 IF has_function_privilege('anon','public.accept_list_invitation_link(text)','EXECUTE')
 THEN RAISE EXCEPTION 'Unexpected anonymous invitation acceptance'; END IF;
 IF NOT has_function_privilege('authenticated','public.accept_list_invitation_link(text)','EXECUTE')
 THEN RAISE EXCEPTION 'Missing authenticated invitation acceptance'; END IF;
 RAISE NOTICE 'PASS: existing public rows identical, invitation RLS and key grants checked';
END $$;
ROLLBACK;
