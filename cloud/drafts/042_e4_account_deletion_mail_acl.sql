-- 042 · Correct missing worker-only RPC privileges from migration 039.
-- Apply only to the reviewed target after confirming migration 039 is present.
-- No function bodies, client grants, or table privileges are changed.
begin;
revoke execute on function public.reserve_account_deletion_reminder(uuid,uuid),
  public.retry_rejected_account_deletion_reminder(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_account_deletion_reminder(uuid,uuid),
  public.retry_rejected_account_deletion_reminder(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
