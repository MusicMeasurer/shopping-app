-- E3 pairing reconstruction checks. Read-only assertions in rollback transaction.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.siri_pairing_requests') IS NULL THEN
   RAISE EXCEPTION 'Missing Siri pairing table';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.siri_pairing_requests'::regclass) THEN
   RAISE EXCEPTION 'Pairing table missing RLS';
 END IF;
 IF has_table_privilege('anon','public.siri_pairing_requests','SELECT') OR
    has_table_privilege('authenticated','public.siri_pairing_requests','SELECT') THEN
   RAISE EXCEPTION 'Pairing secrets exposed through direct SELECT';
 END IF;
 IF has_function_privilege('anon','public.create_siri_pairing(uuid)','EXECUTE') OR
    has_function_privilege('anon','public.exchange_siri_pairing(text)','EXECUTE') OR
    has_function_privilege('authenticated','public.exchange_siri_pairing(text)','EXECUTE') THEN
   RAISE EXCEPTION 'Pairing RPC privilege leak';
 END IF;
 IF NOT has_function_privilege('authenticated','public.create_siri_pairing(uuid)','EXECUTE') OR
    NOT has_function_privilege('service_role','public.exchange_siri_pairing(text)','EXECUTE') THEN
   RAISE EXCEPTION 'Expected pairing RPC grants absent';
 END IF;
 IF (SELECT is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name='siri_shortcut_credentials'
     AND column_name='expires_at') <> 'YES' THEN
   RAISE EXCEPTION 'Indefinite Siri credential cannot be represented';
 END IF;
END $$;
ROLLBACK;
