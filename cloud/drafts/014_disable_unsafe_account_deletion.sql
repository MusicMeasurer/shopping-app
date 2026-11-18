-- Draft migration 014. Disposable test database only.
-- Temporarily disable account-deletion preparation until the
-- authenticated, recoverable deletion lifecycle is implemented.
create or replace function public.prepare_account_deletion(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  raise exception 'Account deletion is temporarily unavailable'
    using errcode = '0A000';
end;
$$;

revoke all on function public.prepare_account_deletion(uuid)
from public, anon, authenticated, service_role;

-- This is a fail-closed feature gate, not a completed deletion workflow.
-- It does not replace checking inherited EXECUTE privileges, backend routes,
-- function ownership, or the owner foreign-key restriction.
-- Apply only after 001-013 with API disabled; verify in a disposable DB.
