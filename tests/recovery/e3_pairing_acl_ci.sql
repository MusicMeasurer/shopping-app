-- CI only: explicit E3 RPC grants after functions are installed.
-- Explicitly revoke PUBLIC execute on privileged restored functions.
REVOKE ALL ON FUNCTION public.create_siri_pairing(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_siri_pairing(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.exchange_siri_pairing(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_siri_pairing(text) TO service_role;
REVOKE ALL ON FUNCTION public.list_pending_invitation_links(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_invitation_links(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.list_siri_shortcuts(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_siri_shortcuts(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.revoke_all_siri_shortcuts() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_all_siri_shortcuts() TO authenticated;
