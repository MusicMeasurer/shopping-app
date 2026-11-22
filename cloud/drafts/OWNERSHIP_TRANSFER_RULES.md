# Ownership transfer and account deletion — approved product rules (2026-10-30)

Status: APPROVED PRODUCT DECISION / NOT IMPLEMENTED. Applies to future cloud shared lists.

## Voluntary ownership transfer
- Current owner may choose any current member as new owner at any time.
- No recipient consent or acceptance workflow. Transfer completes immediately after server authorization.
- Previous owner becomes an ordinary member of the same list.
- Only the new owner receives a durable in-app notification. Other members receive no ownership-change notification.
- New owner may transfer ownership again; no special waiting period is required.

## Account deletion
- Confirmation text (RU): «При удалении аккаунта ваши личные списки будут безвозвратно удалены, а общие списки переданы новым владельцам».
- Do not show individual lists or proposed successors in the confirmation dialog.
- For each list owned by the deleting user:
  - No other members: permanently delete list and its items.
  - One or more members: transfer ownership to the member with earliest joined_at.
  - Tie-break equal joined_at by user_id ascending for deterministic result.
- No recipient acceptance required.
- Notify only each new owner, via durable in-app notifications.
- After all transfers/deletions succeed, delete account; avoid partial orphaning.
- Re-evaluate current membership inside the server transaction rather than relying on a stale client preview.

## Data integrity / security
- Ownership changes must use an authorized server-side operation, not generic client UPDATE of owner_id.
- Previous owner's membership insertion and new owner's membership removal must be atomic with owner_id change. Owner must not also remain a list_members row.
- Transfer and account deletion must serialize against membership changes and concurrent transfers.
- Append an immutable ownership audit event with list, old/new owner, reason, timestamp; account deletion may require pseudonymization/minimal retention of old identity.
- Notification creation is durable and atomic with the ownership change; delivery/read status can be asynchronous.
- Account deletion needs a coordinated server-side workflow; existing FK owner_id ON DELETE CASCADE must not be allowed to silently destroy shared lists.
- The client should disable owner-only controls for former owner on next sync, and server must enforce permissions immediately.
- Hard deletion and offline sync tombstone/retention rules require separate reconciliation before production.

## Acceptance checks
- A transfers to B; B becomes owner, A member; only B receives notification.
- B can transfer back to A, repeatedly.
- Deleting owner with 0 members deletes list; with 1 member transfers to that member; with multiple chooses earliest joined_at, tie by user_id.
- Concurrent member removal and account deletion never leaves an orphan or assigns ownership to a departed member.
- If any transfer fails, account deletion does not partially complete.
- Previously cached devices cannot perform owner-only actions after transfer.
- No direct client owner_id UPDATE is permitted.

No database or production app changes have been made.
