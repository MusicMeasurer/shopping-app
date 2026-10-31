# Invitation concurrency design - review only

2026-10-31. No deployment authorized.

Requirements: in-app inbox and sent invitation list, explicit accept/decline, owner revoke, no push yet. Revoke must outrank acceptance while acceptance is pending.

Existing SQL 017 locks rows but does not guarantee owner priority. Do not deploy it.

Approved by product owner 2026-10-31: three-second grace period, with a visible processing state; network delays may extend the perceived wait. The three seconds are measured by the server, not by a client timer. Never show success or grant access until the server confirms finalized acceptance. If the client disconnects, reopening the app must reconcile the pending state.

Proposed two-phase protocol:
1. Accept request changes pending to accept_requested, without adding list membership. Record finalize_after timestamp.
2. Owner may revoke both pending and accept_requested before finalization.
3. Finalization after a short grace window rechecks invitation state under list and invitation locks, then atomically inserts membership and marks accepted.
4. Client displays processing until finalization confirms accepted. Recovery must work if client closes.
5. After finalization, revoke invitation cannot undo accepted membership; owner must remove the member.

Implementation note: use database server time for finalize_after and recheck it in the finalization transaction. A pending acceptance must not grant list membership, including through existing access-check RPCs. Handle expiry, decline and revoke during the pending phase. Ensure finalization can be retried safely after a client crash; do not require an always-running paid background worker.

Boundary: priority holds for revokes processed before finalization. A request delayed by network until after finalization cannot retroactively win. Agree this contract before coding.

Needed operations: create, list incoming, list sent, accept request, finalize, decline, revoke. Recipient discovery must not leak other users. Verify RLS, SECURITY DEFINER grants, row lock order, expiry, replay and concurrent accept/revoke tests.

## Approved ownership-transfer rule (2026-10-31)

On transfer of shopping list ownership, all unfinished invitations for that list (pending and accept_requested/processing) MUST be revoked atomically in the SAME database transaction as the ownership change. Accepted memberships remain unchanged; already declined/revoked/expired invitations retain their historical state. The new owner can create fresh invitations.

Implementation: the ownership-transfer RPC must lock the list row first (same lock ordering as invitation mutation RPCs), revoke unfinished invitation rows, and transfer ownership before committing. A competing finalize must either commit before ownership transfer (membership remains) or observe the revoked invitation after transfer and fail. Do not implement this as two separate client/API requests. Test both serialization orders and verify no unaccepted invitation remains usable after transfer. Existing transfer_list_ownership must be audited and changed as needed before migration 017 is deployed.
