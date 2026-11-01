# Verification plan for 006 and 007

Status: NOT EXECUTED. These are test-only migrations, not production approvals.

## Apply in a disposable Supabase project
Apply 001, 002, 003, 004, 005, 006, 007 in order. Stop at first SQL error and capture SQLSTATE. Record function owners, RLS and grants.

## H-01: deletion safety
Create users A and B; A owns a shared list with B as member. Attempt to delete A from auth.users using a test admin connection. Expect foreign-key rejection and preservation of list, items, membership and change history. Also test A owning a personal list. This is fail-closed protection, NOT the final approved account-deletion behavior.

## H-02: membership removal race
Create A as owner, B as member. B starts a transaction, calls apply_item_change, keeps transaction open. In another session A calls remove_list_member. Expect A to wait for B to commit or roll back. After removal commits, a new B mutation must fail. Repeat with rollback, and with B leaving voluntarily. Direct authenticated DELETE and TRUNCATE of list_members must fail.

## H-03: pull and revocation
B starts pull while another session attempts remove_list_member. The list row lock should establish a consistent order: either B completes first or B is denied after removal. Confirm no events committed after revocation are returned by a new B pull. Repeat with READ COMMITTED and REPEATABLE READ, and with explicit long transactions. Document any anomalous snapshot behavior.

## Remaining blocking work
- Voluntary ownership transfer with immediate notification to new owner only.
- Account deletion transaction selecting earliest joined member, tie-break user_id.
- Full privilege audit and revision-zero server enforcement.
- Initial snapshots, retention and client cursor recovery.
- Conflict and operation-ID collision contract.
- Siri scoped credential and endpoint.
- Full runtime test suite.
