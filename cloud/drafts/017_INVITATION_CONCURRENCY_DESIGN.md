# Invitation concurrency design - review only

2026-10-31. No deployment authorized.

Requirements: in-app inbox and sent invitation list, explicit accept/decline, owner revoke, no push yet. Revoke must outrank acceptance while acceptance is pending.

Existing SQL 017 locks rows but does not guarantee owner priority. Do not deploy it.

Proposed two-phase protocol:
1. Accept request changes pending to accept_requested, without adding list membership. Record finalize_after timestamp.
2. Owner may revoke both pending and accept_requested before finalization.
3. Finalization after a short grace window rechecks invitation state under list and invitation locks, then atomically inserts membership and marks accepted.
4. Client displays processing until finalization confirms accepted. Recovery must work if client closes.
5. After finalization, revoke invitation cannot undo accepted membership; owner must remove the member.

Boundary: priority holds for revokes processed before finalization. A request delayed by network until after finalization cannot retroactively win. Agree this contract before coding.

Needed operations: create, list incoming, list sent, accept request, finalize, decline, revoke. Recipient discovery must not leak other users. Verify RLS, SECURITY DEFINER grants, row lock order, expiry, replay and concurrent accept/revoke tests.
