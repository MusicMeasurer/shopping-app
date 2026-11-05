-- E2 review-only function EXECUTE hardening; apply AFTER 001-016 and ACL 018.
-- Only disposable PostgreSQL / isolated test environments. No production approval.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.guard_item_identity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_new_list_metadata() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_item_list_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
COMMIT;
-- Internal trigger/event_trigger functions remain executable by their owner.
-- Authenticated application RPC grants are deliberately unchanged.
