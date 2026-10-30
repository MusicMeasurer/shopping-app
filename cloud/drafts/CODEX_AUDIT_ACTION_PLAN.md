# Independent Codex audit — remediation plan

Status: OPEN / DESIGN ONLY. Based on Codex static review of commit ea9975e; no SQL executed. This file records the findings, not fixes.

## High — blocking
- H-01 Deletion protocol: direct DELETE and RLS-hidden tombstones cannot support offline sync. Design an authorized atomic mutation endpoint; append tombstone and monotonic list revision; block direct DELETE; define retention and full-resync.
- H-02 Idempotency and conflicts: implement operation_id with payload hash, server-verified actor, atomic stored result, item version preconditions, list change log and revision cursor. Reuse of operation_id with changed payload must fail.
- H-03 Siri scope: dedicated endpoint with per-list scoped revocable credential, expiry, server-side authorization, rate limits, and deduplication. Never expose service_role to client.

## Medium — required before integration
- M-04 Explicit schema/table/function/column privileges and SECURITY DEFINER ownership review. Audit TRUNCATE, REFERENCES, TRIGGER, CREATE and role inheritance.
- M-05 Immutable item ID and created_at; server-generated updated_at; separate client timestamp from server revision.
- M-06 Invitation lifecycle: hashed single-use token, expiry, revocation, recipient verification, atomic acceptance with current owner permissions.
- M-07 IndexedDB v1 migration: preserve item UUIDs, map groceries/household to stable cloud UUIDs, transactional local queue and explicit import preview.
- M-08 Local principal isolation: guest and each account get isolated data, cursors and queues; cancel/invalidate old sync responses when switching.
- M-09 Distinct membership, JWT/session and Siri credential revocation guarantees; document offline cached-data limits.

## Low
- L-10 Update test plan status and 001→002 migration order; preserve negative tests.

## Required gates
1. Replace draft migrations with coherent, repeatable test migrations; no deployment of 001/002 as-is.
2. Automated RLS/ACL tests with owner A, member B, outsider C and anon.
3. Atomic mutation tests for concurrency, duplicate operation IDs, tombstones, stale versions and pagination.
4. Invitation and Siri endpoint negative tests with revoked credentials and wrong lists.
5. Client migration and account-switch isolation tests.
6. Review results before changing main or publishing.

## Decision pending
- Deleting a user currently cascades to owned shared lists. Choose explicit owner deletion/transfer policy before production.
- Design invitation delivery before selecting SMTP provider.
- Keep the backend portable behind a provider adapter.

No code in this branch is production-ready; no backend is provisioned.
