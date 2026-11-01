# Supabase HTTP integration tests

Status: partial real HTTP coverage completed; invitation 017 HTTP coverage pending.

Verified in disposable Supabase lab (see main docs/05_DEV_LOG.md): real Auth A/B/anonymous list read isolation; direct item/member insert denial; owner item RPC lifecycle and replay. These do not establish complete security.

Invitation 017 remains REVIEW_ONLY. Before deployment, test in a fresh disposable Supabase environment with distinct A owner, B invitee, C outsider, and anonymous clients. Verify owner-only issue/revoke/list, first acceptance, replay denial, expiration, revocation, transfer invalidation, concurrency, account deletion, effective grants, and post-revocation membership permissions through real JWT and HTTP. Separately verify fresh install and upgrade with existing data.

PostgreSQL Auth-shim CI nine-check PASS at 3a9bdce is not a substitute for real Supabase HTTP verification. Never deploy draft 017 or enable a live Data API automatically. Credentials must stay outside the repository. Record test evidence and cleanup before release.

## Invitation HTTP smoke harness (prepared, NOT executed)

Run `python3 tests/http/test_invitation_rpc.py` only after explicitly provisioning an isolated disposable Supabase project and applying reviewed 001–017 migrations there. Set these environment variables **outside the repository**:

- `TEST_SUPABASE_URL`: disposable HTTPS project URL.
- `TEST_SUPABASE_ANON_KEY`: publishable/anon API key for that project.
- `TEST_OWNER_JWT`: real authenticated A JWT, owner of the test list.
- `TEST_INVITEE_JWT`: real authenticated B JWT, initially not a member.
- `TEST_OUTSIDER_JWT`: real authenticated C JWT, not a member.
- `TEST_OWNER_LIST_ID`: UUID of a disposable list owned by A.

The script **modifies test data**: creates two links, accepts one as B (creating membership), revokes the other. Do not reuse the same B/list fixtures for a second run without resetting them. It intentionally never prints raw tokens, JWTs or API error bodies.

This is a smoke test, not the full gate: expiry, transfer, concurrency, user deletion, migration rollback and comprehensive HTTP permission checks remain outstanding. No CI secrets or project credentials have been configured and no hosted test has been run.
