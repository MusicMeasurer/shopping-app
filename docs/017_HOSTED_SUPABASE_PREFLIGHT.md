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

## Hosted read-only preflight results (2026-11-01)

Source: SQL Editor output provided by the user from the disposable migration lab. The assistant did not directly query Supabase.

- PostgreSQL: 17.11.
- pgcrypto schema: extensions; gen_random_bytes(integer) and digest(text,text) resolve.
- RLS enabled: shopping_lists and list_members.
- Invitation table: absent (017 not applied).
- anon SELECT: denied for shopping_lists and list_members.
- authenticated SELECT: allowed for both tables.
- authenticated INSERT: allowed for shopping_lists, denied for list_members.
- authenticated UPDATE and DELETE: denied for both tables.
- transfer_list_ownership: owner postgres; SECURITY DEFINER enabled; anon EXECUTE denied; authenticated EXECUTE allowed.
- Invitation-specific functions: not present in the returned function list.

Assessment: no mismatch identified in the tested configuration. These results do not validate RLS row behavior, complete migration history, hosted API/JWT behavior, or migration 017 security. Deployment remains blocked pending review and explicit approval.

## Conditional approval and execution gate (2026-11-01)

User authorized applying candidate migration 017 **only** to disposable project `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`), **after** verifying a schema backup and a workable recovery path. Data API must remain OFF; other projects must not be touched. This is conditional authorization, **not** evidence of backup verification or migration execution.

### Operator checklist — stop before migration until all items verified

- [ ] Confirm Supabase dashboard project ref is exactly `gmrqeubhotjpmtwokfeq`; verify Data API remains OFF.
- [ ] Obtain a current schema-only backup of the **target lab** including public/auth-related schema definitions, functions, grants, triggers and RLS policies as supported; record where it is stored privately (never commit secrets or user data).
- [ ] Verify the backup is readable and can restore into a **separate disposable recovery database**, or otherwise demonstrate an actual tested recovery procedure. A downloaded backup alone is insufficient.
- [ ] Confirm the recovery procedure covers newly created 017 objects and dependent functions; do not assume that simply running `DROP TABLE` safely reverses 017. Capture the baseline schema and 001–016 migration state.
- [ ] Re-review the exact candidate SQL at the pinned commit and its SHA-256 checksum; check migration 017 has not already been applied.
- [ ] Check for conflicts or destructive statements and confirm extension/function resolution against hosted PostgreSQL 17.11.
- [ ] Only then apply 017 via an explicitly selected SQL editor session for the exact target lab; capture sanitized outcome and read-only post-migration schema/privilege snapshot.
- [ ] Keep Data API OFF throughout. Do not claim H01–H15 are complete; real JWT/RPC tests require a separate approved API access plan.

**Current execution state:** backup and recovery verification not yet evidenced; migration 017 **not applied by assistant**. No direct Supabase connector available in this session. Do not request or share service-role keys, database passwords, JWTs or invitation secrets in chat.

## Recovery strategy clarification (2026-11-01)

The user confirmed that `shoppingapp-migration-lab` contains **only disposable experimental data**; the app they actually use is separate. The preferred future workflow is iPhone-compatible, with reproducibility tests in GitHub Actions instead of requiring a local Windows `pg_dump` installation.

**Important distinction:** CI already applies the combined 001–016 baseline and 017 to a disposable PostgreSQL instance, proving a clean bootstrap under its simulated roles. This does **not** prove exact reconstruction of the hosted Supabase lab (auth schemas, dashboard settings, extensions, ownership, grants, RLS, hosted PostgreSQL 17). A CI bootstrap is not a backup of the hosted project.

**Revised gate proposal, requiring explicit reconciliation before execution:**
1. Collect a read-only hosted inventory of all relevant public objects, functions, owners, grants, RLS policies, extensions and migration state, and compare against 001–016 expected structure.
2. Verify a fresh isolated restore/rebuild using the 001–016 source and compare its object inventory to the hosted snapshot. Document any differences and whether they are reproducible via documented Supabase configuration.
3. Because test data is disposable, an approved rebuild from migrations may serve as a **recovery strategy for the lab** after successful comparison; it does not meet the original requirement of a literal schema-only backup unless the user explicitly accepts that substitution.
4. Keep migration 017 unapplied until the recovery strategy is validated and the user confirms this substitution. Never assume any production data can be reconstructed this way.
