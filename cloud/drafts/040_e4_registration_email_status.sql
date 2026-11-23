-- 040 · Server-authoritative sign-up cooldown status.
-- Explicit product decision: minimal public disclosure of 24-hour re-registration
-- cooldown is acceptable on every device, without any local account history.
-- This function does NOT authorize registration. Auth BEFORE INSERT/UPDATE
-- trigger shoppingapp_deletion.registration_guard() remains authoritative.
-- Apply only to shoppingapp-migration-lab after review, never production by default.

create or replace function public.registration_email_status(p_email text)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_email is null or length(btrim(p_email)) = 0 or length(p_email) > 320
      then 'available'::text
    when exists (
      select 1 from shoppingapp_deletion.tombstones t
      where t.email_key = shoppingapp_deletion.digest('email:' || lower(btrim(p_email)))
        and (t.completed_at is null or t.completed_at + interval '24 hours' > now())
    ) then 'cooldown'::text
    else 'available'::text
  end
$function$;

comment on function public.registration_email_status(text) is
  'Minimal public status for 24h re-registration cooldown; no account ID, email, timestamps, or existence status returned. Auth trigger still enforces the block.';

revoke all on function public.registration_email_status(text) from public, anon, authenticated, service_role;
grant execute on function public.registration_email_status(text) to anon, authenticated;
