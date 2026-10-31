# Migration 017: reproducible validation protocol (DRAFT)
Date: 2026-10-31. Status: NOT EXECUTED. Do not run against production.
Prerequisite: migration 017 must first pass syntax/privilege review and be installed in a disposable test database with schema 001–016. Never apply REVIEW_ONLY to the current Supabase test project merely to run this checklist.

## Fixtures
Create three real Auth test identities A (list owner), B (invitee), C (outsider), a fresh list L owned by A, and record IDs privately. Avoid credentials, access tokens or invitation IDs in GitHub logs/issues. Use separate authenticated HTTP sessions for A, B and C. For every test, use a fresh invitation unless explicitly testing replay.

## Test matrix
| ID | Operation | Expected result |
| --- | --- | --- |
| I01 | A creates invite for B | One pending invite, expiry in 24h |
| I02 | B reads incoming; A reads sent | B sees invite and list name; A sees status pending |
| I03 | C reads incoming; C tries sent list L | C cannot see invite; sent list rejected |
| I04 | B requests acceptance | Status processing; no membership; B cannot read list items |
| I05 | B attempts finalization before 3s | Rejected; no membership |
| I06 | A revokes while processing, before deadline | Status revoked; finalization rejected; B cannot access L |
| I07 | B declines pending invite | Status declined; finalization and acceptance rejected |
| I08 | B requests acceptance, waits >=3s, finalizes | Accepted exactly once; B gets list membership |
| I09 | B repeats finalization | No duplicate membership |
| I10 | A removes B after I08; B repeats finalization | Rejected; membership not restored |
| I11 | Expired invite; B tries accept/finalize | Rejected; no membership |
| I12 | C guesses/obtains B invite ID, tries accept/decline/finalize | Rejected; no membership |
| I13 | A revokes already accepted invite | Must not silently remove B; owner uses remove_list_member |
| I14 | B loses network after acceptance request; retries | Same finalize_after; finalization can complete later |
| I15 | Anonymous REST direct read/write list_invitations | Denied |
| I16 | Authenticated REST direct read/write list_invitations | Denied |
| I17 | A creates replacement invite while B is processing | Old invitation revoked; new invitation only is valid |
| I18 | Two concurrent finalize calls for same invite | At most one membership row; consistent accepted state |
| I19 | A revokes during processing concurrently with B finalizing before deadline | Revoke wins; membership absent |
| I20 | A revokes after deadline concurrently with B finalizing | Outcome may depend on list lock order; document exact observed order |
| I21 | B accepts after ownership transfer/removal/deletion of list | Rejected; no privilege escalation |
| I22 | Other list member attempts to invite/revoke | Rejected |
| I23 | Account A/B removed during pending invite | FK behavior and permissions remain consistent |

## Ownership-transfer integration tests (approved requirement)
| ID | Operation | Expected result |
| --- | --- | --- |
| T01 | A transfers list to existing member C with B's invitation pending | B invite revoked atomically; B cannot accept/finalize |
| T02 | A transfers list to C while B's acceptance is processing | B invite revoked atomically; B cannot finalize |
| T03 | B finalizes and commits membership BEFORE A transfers to C | B remains a member; invitation remains accepted |
| T04 | A transfers to C BEFORE B finalizes | B finalization fails; no membership created |
| T05 | A transfers to C; C creates a fresh invite for B | New invite works; old revoked invite cannot be reused |
| T06 | A transfers to C; verify A and all other existing members | A becomes member, C becomes owner, others retain membership |
| T07 | Transfer fails due to invalid new owner or transaction error | No invitations revoked; original owner unchanged |

Perform T03/T04 with two concurrent sessions and verify final state. The transfer RPC and invitation RPCs must lock the list row in the same order. Do not split revocation and transfer into two API requests.

## Concurrency protocol (two independent DB sessions or two authenticated HTTP clients)
1. Start with a fresh invite; have B request acceptance and capture the server-returned finalize_after.
2. BEFORE finalize_after: send A revoke and B finalize requests from two independent sessions. B finalization must fail and membership must remain absent.
3. Repeat with revoke sent just before deadline, then with both requests after deadline. Record server-side timestamps and actual transaction commit order, not phone tap times.
4. Verify database state after each trial: invitation terminal status and existence of list_members row must agree. Repeat each timing scenario many times under network jitter.
5. If the revoke request reaches the server after accepted is committed, classify it as post-acceptance membership removal, not as a failed guarantee.

## SQL read-only inspection queries (admin SQL editor)
```sql
-- Inspect function security mode, owner and executable roles.
select n.nspname, p.proname, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proconfig as settings,
       p.proacl as privileges
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like '%list_invitation%'
order by p.proname;

-- Confirm table RLS and ACL.
select schemaname, tablename, rowsecurity
from pg_tables where schemaname='public' and tablename='list_invitations';
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='list_invitations';
```

## Release gates
- Parse and compile migration on a disposable PostgreSQL/Supabase instance.
- All I01–I23 and T01–T07 pass, including real concurrency trials; investigate failures, never mark skipped as passed.
- Independently audit SECURITY DEFINER, RLS, grants, ownership and existing membership-changing RPCs.
- Resolve recipient discovery without exposing account directory.
- Only then request explicit approval to apply a reviewed migration to the shared test project.
