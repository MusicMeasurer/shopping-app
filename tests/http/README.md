# Supabase HTTP integration tests

Status: partial real HTTP coverage completed; invitation 017 HTTP coverage pending.

Verified in disposable Supabase lab (see main docs/05_DEV_LOG.md): real Auth A/B/anonymous list read isolation; direct item/member insert denial; owner item RPC lifecycle and replay. These do not establish complete security.

Invitation 017 remains REVIEW_ONLY. Before deployment, test in a fresh disposable Supabase environment with distinct A owner, B invitee, C outsider, and anonymous clients. Verify owner-only issue/revoke/list, first acceptance, replay denial, expiration, revocation, transfer invalidation, concurrency, account deletion, effective grants, and post-revocation membership permissions through real JWT and HTTP. Separately verify fresh install and upgrade with existing data.

PostgreSQL Auth-shim CI seven-check PASS at 19b883a is not a substitute for real Supabase HTTP verification. Never deploy draft 017 or enable a live Data API automatically. Credentials must stay outside the repository. Record test evidence and cleanup before release.
