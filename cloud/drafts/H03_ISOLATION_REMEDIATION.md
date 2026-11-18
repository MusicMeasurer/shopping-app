# H-03: transaction isolation boundary — proposed remediation

Status: design only; not a production fix. Branch feature/cloud-schema-draft.

## Root cause
The membership check in SECURITY DEFINER functions reads the transaction's
MVCC snapshot. A list-row lock alone cannot guarantee fresh authorization
when a caller has already established a REPEATABLE READ or SERIALIZABLE
snapshot before another transaction revokes membership. The old snapshot
may continue to expose the old membership row.

## Supported API contract (proposal)
All user-facing list RPCs must run in fresh, short READ COMMITTED transactions
created by the trusted backend/PostgREST boundary. Do not expose a way for
clients to choose transaction isolation or reuse a transaction after a
membership change. Explicitly reject other isolation levels at the start
of each membership-sensitive RPC using
current_setting('transaction_isolation').

Affected operations include apply_item_change, pull_item_changes,
remove_list_member, transfer_list_ownership, and future invitations,
list creation, sharing and account deletion endpoints.

## Limits
An isolation-level guard alone does not prove the ACL is correct.
Each operation must still acquire the list lock before checking current
membership and must use a consistent lock order. A check inside an RPC
does not constrain other SQL routes or privileged backend queries.
PostgREST configuration and actual transaction boundaries require
runtime verification. Existing offline data cannot be remotely revoked.

## Required tests
- A/B share a list. B begins REPEATABLE READ, establishes snapshot.
  A removes B and commits. B's pull and mutation RPCs must reject
  unsupported isolation before reading or changing data.
- Repeat with SERIALIZABLE.
- Repeat with fresh READ COMMITTED requests: removed B must be denied.
- Verify authorized A and retained members can pull/mutate normally.
- Verify no direct SELECT grants expose change logs or private items.
- Verify member removal, transfer, and pull use list-row lock order.
- Capture SQLSTATE and ensure no partial writes on rejection.

## Gate
No claim of H-03 closure until enforcement is implemented in all affected
RPCs, independently audited, and exercised in a disposable database.
