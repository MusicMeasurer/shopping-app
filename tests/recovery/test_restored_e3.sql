-- E3 disposable restoration verification: invitation and Siri SQL layer.
BEGIN;
DO $$
DECLARE
 name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
   'list_invitation_links','siri_shortcut_credentials','siri_shortcut_operations'
 ] LOOP
   IF to_regclass('public.' || name) IS NULL THEN
     RAISE EXCEPTION 'Missing E3 table %', name;
   END IF;
   IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||name)) THEN
     RAISE EXCEPTION 'E3 table missing RLS %', name;
   END IF;
   IF has_table_privilege('anon','public.'||name,'SELECT') THEN
     RAISE EXCEPTION 'E3 table leaked to anon %', name;
   END IF;
 END LOOP;
 IF has_function_privilege('anon','public.siri_add_item(text,uuid,uuid,text)','EXECUTE') THEN
   RAISE EXCEPTION 'anon may call Siri mutation';
 END IF;
 IF has_function_privilege('authenticated','public.siri_add_item(text,uuid,uuid,text)','EXECUTE') THEN
   RAISE EXCEPTION 'authenticated may call service-only Siri mutation';
 END IF;
 IF NOT has_function_privilege('service_role','public.siri_add_item(text,uuid,uuid,text)','EXECUTE') THEN
   RAISE EXCEPTION 'service role cannot call Siri mutation';
 END IF;
 IF has_function_privilege('anon','public.create_list_invitation_link(uuid)','EXECUTE') THEN
   RAISE EXCEPTION 'anon may create invitation';
 END IF;
END $$;
ROLLBACK;
