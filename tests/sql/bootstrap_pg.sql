-- CI-only Supabase Auth shim. Never deploy this file to Supabase.
-- Mimics auth.uid() from transaction-local request.jwt.claim.sub.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
-- Supabase exposes public schema to API roles; mimic schema usage.
GRANT USAGE ON SCHEMA public TO authenticated, anon;
