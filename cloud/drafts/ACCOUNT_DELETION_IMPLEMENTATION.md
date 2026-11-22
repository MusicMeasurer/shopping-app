# Account deletion — transactional implementation contract

Status: DESIGN / BLOCKING. Applies to feature/cloud-schema-draft. Not deployed.

## Entry point
A trusted server workflow authenticates the account owner and performs all list transfers and deletions in one database transaction before deleting the Auth identity. Never expose a service-role key to the client. Deleting auth.users directly is forbidden while the user owns any lists (006 FK RESTRICT).

## Lock order and concurrency
1. Resolve the user identity from the verified session, not client-supplied actor ID.
2. Serialize deletion against other account deletion attempts for that user.
3. Lock all lists owned by the user in stable UUID order. Ownership transfer and membership operations must use the same list locks.
4. Recheck ownership and members under locks; choose successor ordered by joined_at ascending, user_id ascending.
5. If a successor exists, remove successor membership, transfer owner_id, record old owner as member only when account remains active; for account deletion, do not add a departing user as member.
6. Write ownership event and durable notification only to successor.
7. If no successor, delete list and dependent rows. Document that offline clients need terminal list-deletion handling.
8. Remove departing user's memberships from other lists using the same locking protocol.
9. Delete Auth identity only after all list actions succeed. A failure must roll back everything.

## Database boundaries
The current 009 transfer RPC supports voluntary transfers only. It MUST NOT be reused unchanged for deletion: it inserts former owner membership. An administrative deletion operation must use a separate trusted execution context and coordinate Auth deletion.

A normal SQL function cannot safely claim to delete an Auth user via a remote Auth Admin HTTP API in the same database transaction. Prefer an explicitly designed database transaction boundary, with an authenticated privileged server workflow and recovery strategy. Until that architecture is selected, do not expose an account deletion button or promise atomic Auth deletion.

## Required tests
- No shared lists: owned lists removed, Auth identity deleted.
- One or many members: earliest joined_at wins, tie broken by user_id.
- No partial effects on injected failure.
- Concurrent member removal and voluntary transfer.
- Concurrent account deletions involving lists shared by both users.
- Only successors receive notifications; audit events survive according to retention policy.
- Owner deletion without workflow rejected by FK.
- No client may invoke privileged administrative deletion for another user.
