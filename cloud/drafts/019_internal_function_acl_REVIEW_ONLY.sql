-- E2 review-only function EXECUTE hardening; apply AFTER 001-016 and ACL 018.
-- Only disposable PostgreSQL / isolated test environments. No production approval.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.guard_item_identity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_new_list_metadata() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_item_list_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
-- Supabase-hosted installs may define an event trigger helper absent from baseline 001-016.
DO $acl$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  END IF;
END $acl$;
COMMIT;
-- Internal trigger/event_trigger functions remain executable by their owner.
-- Authenticated application RPC grants are deliberately unchanged.
