# 017 hosted Supabase preflight — REVIEW ONLY

Status: NOT APPROVED FOR DEPLOYMENT. This is a checklist, not evidence that hosted tests passed.

## Target isolation
- Only disposable migration lab `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`), after explicit user approval.
- Never use the original security lab (`tdcrtwpewbngoermckmx`) or a production project.
- Keep Data API OFF until a separately approved API verification plan exists.
- Confirm 001–016 match expected migration history; take a schema-only backup and verify recovery path before 017.

## Read-only preflight queries
Execute using the SQL editor in the disposable lab, **without changing settings**:

```sql
select current_database(), current_user, current_setting('server_version');
select extname, extnamespace::regnamespace::text as schema
from pg_extension where extname = 'pgcrypto';
select nspname from pg_namespace where nspname in ('auth','extensions','public');
select to_regclass('public.shopping_lists') as lists,
       to_regclass('public.list_members') as members,
       to_regclass('public.ownership_events') as events,
       to_regclass('public.user_notifications') as notifications,
       to_regclass('public.list_invitation_links') as invitations;
select proname, pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and proname in
 ('transfer_list_ownership','create_list_invitation_link',
  'accept_list_invitation_link','revoke_list_invitation_link',
  'list_pending_invitation_links');
```

## Required review before execution
1. Check extension availability: candidate 017 calls `extensions.gen_random_bytes` and `extensions.digest`; do not assume all hosted installations use the same schema.
2. Check function owner and EXECUTE grants, including inherited PUBLIC grants, and validate that `SECURITY DEFINER` privileges are limited.
3. Verify schema and RLS policies from 001–016, including list ownership transfer and member removal.
4. Confirm PostgREST exposure and JWT role claims in a separate test; PostgreSQL role simulation is not sufficient.
5. Review bearer-token leakage through logs, URLs, sharing previews and analytics; rate-limit token attempts at the API boundary.
6. Decide whether expiry/revocation should use `clock_timestamp()` consistently in all functions.
7. Obtain an independent security review of the final migration diff.

## Exit criteria
- Disposable PostgreSQL CI success with readable PR report.
- Hosted read-only preflight reviewed, then explicit approval to apply 017 to disposable migration lab.
- Hosted tests show owner/outsider/anon permissions, replay denial, expiry, revoke, transfer, concurrency and rollback.
- No deployment to production until the separate release decision.
