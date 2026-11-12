-- Disposable PostgreSQL CI only. Supabase commonly installs pgcrypto in extensions.
-- This shim must never be deployed to a hosted Supabase project.
CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
   EXECUTE 'ALTER EXTENSION pgcrypto SET SCHEMA extensions';
 ELSE
   EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
 END IF;
END $$;
