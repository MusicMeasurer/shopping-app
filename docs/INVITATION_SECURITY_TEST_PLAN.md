# Invitation and shared-list access — security test plan (REVIEW ONLY)

Status: DESIGN / NOT RUN. FR-010 is a subsequent product stage; migration 017 remains REVIEW_ONLY and must not be applied to either Supabase project until independently reviewed.

## Invariants
1. Only the current owner may issue or cancel an invitation for an active list.
2. An invitation binds one exact recipient account (immutable auth user id), one list, a server-generated unpredictable token or equivalent trusted proof, and an expiration. A forwarded token must not grant access to a different authenticated account.
3. Acceptance requires the authenticated recipient to match the invitee, the invitation to be unexpired and unused, and the list to remain active. Acceptance and membership creation must be atomic.
4. A nonmember must never read invitation details, list items or list membership through public tables/RPC.
5. Repeated acceptance must not create duplicate memberships or expand privileges; concurrent acceptance/revocation must be serialized safely.
6. Revoking membership must immediately block reads, writes and sync from the removed user. Outstanding invitations must not silently restore revoked access.
7. Ownership transfer (if implemented) must invalidate outstanding invitations atomically; the former owner must not retain owner-only rights.
8. Client cannot directly insert/update membership or bypass server-side invitation checks.

## Behavioral test matrix
- Owner issues an invite for B; B accepts; B can read and mutate through approved RPC; A retains ownership.
- C attempts to accept B's invite; deny without consuming it.
- Anonymous and nonmember attempts to issue/accept/revoke; deny.
- B attempts to use expired, cancelled, already-consumed or forged invite; deny as specified.
- B accepts twice, and two simultaneous B accept requests race; one membership, consistent response.
- A revokes B; B read/write/sync denied; reusing prior invite cannot restore membership.
- A deletes list or transfers ownership while invite is pending; pending invite cannot grant access.
- Direct membership INSERT/UPDATE denied even with valid login.
- All negative tests verify *database state* as well as HTTP status; avoid tests that accidentally consume invitations.

## Test staging
1. Static review of migration 017, function SECURITY DEFINER search paths, grants and RLS.
2. Rollback-only SQL tests in disposable PostgreSQL, using realistic roles and concurrency where needed.
3. Real Auth A/B/C HTTP tests in disposable migration lab only, after explicit temporary Data API enablement.
4. Verify cleanup of synthetic membership/invitations and close Data API.
5. Record run ID, PASS/FAIL and limitations in docs/05_DEV_LOG.md.

No service_role credentials in client, logs or repository. Do not run on original security lab or production.
