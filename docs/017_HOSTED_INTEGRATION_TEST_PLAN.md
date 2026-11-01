# 017 — Hosted Supabase integration test plan (approval gate)

**Status:** prepared, NOT executed. Target only the disposable migration lab `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`). Never use the original security lab (`tdcrtwpewbngoermckmx`). Data API currently OFF; enabling it requires separate explicit authorization. Do not apply 017 without approval. Production is out of scope.

## Prerequisites

1. Pin the exact reviewed 017 candidate commit and verify seven disposable PostgreSQL CI checks are green.
2. Confirm baseline migrations 001–016 and extension placement; capture read-only schema/privilege/RLS snapshot.
3. Choose a supported, explicitly approved path for testing real Supabase Auth JWT and RPCs. Do not turn on Data API implicitly. Ensure test identities are disposable and never expose service-role credentials or JWTs in logs.
4. Prepare at least three disposable authenticated identities (owner, invitee, outsider); establish cleanup/rollback procedure before writes.

## Test matrix (each row needs evidence and pass/fail)

| ID | Scenario | Required result |
|---|---|---|
| H01 | Anonymous create/accept/revoke/inventory RPC | denied |
| H02 | Authenticated outsider creates/revokes/views owner's links | denied, no inventory disclosure |
| H03 | Owner creates link | 64 lowercase hex secret returned once; only SHA-256 stored |
| H04 | Owner inventory | invitation ID/expiry only; no raw token/hash |
| H05 | First authenticated non-member explicitly accepts | membership created; link marked consumed |
| H06 | Replay and concurrent accept | exactly one success, other denied |
| H07 | Already-member and owner attempts | denied |
| H08 | Expired/revoked/malformed token | denied without state disclosure |
| H09 | Ten pending links; attempt eleven; expiry frees capacity | limit enforced, slot reusable |
| H10 | Transfer ownership | pending links revoked atomically; old owner loses create rights |
| H11 | Concurrent acceptance vs transfer/revoke/expiry | consistent result and no deadlock |
| H12 | Delete invitee/issuer after transferring ownership as necessary | invitation references cleaned; no orphaned lists |
| H13 | Direct table access through real JWT and RLS | invitation table not exposed to anon/authenticated |
| H14 | Token redaction in iOS deep-link, share, logs, telemetry | no secret leakage; opening link never auto-accepts |
| H15 | Per-account/list issuance and failed-accept rate limits | enforced server-side and independently of app client; if not implemented, release blocked or explicit risk acceptance |

## Evidence / controls

- Record timestamp, target environment, migration checksum/commit, role/identity (never JWT), input class (never token), observed result and test operator.
- Do not paste invitation tokens, token hashes, JWTs, service-role keys or full invitation URLs into GitHub, logs or chats.
- No test may alter the original security lab or production. Hosted migration execution is a separate approval step.
- Stop on unexpected permission escalation, cross-user disclosure, destructive effects or repeated lock failures. Capture sanitized error evidence and revert only via an approved recovery plan.

## Exit criteria

- All SQL CI tests pass; hosted Auth/JWT/RPC/RLS tests H01–H13 pass with evidence; app/token controls H14 and abuse controls H15 implemented and verified or residual risk explicitly accepted before rollout.
- Log outcomes and decisions in `docs/05_DEV_LOG.md`; update current-stage and roadmap files once the tested state is known.
- Cloud sync and Siri work may proceed on independent branches while 017 remains blocked from deployment.
