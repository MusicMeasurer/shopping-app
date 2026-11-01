# Independent security audit: migrations 013–016 in the full 001–016 chain

- Repository: MusicMeasurer/shopping-app
- Branch: feature/cloud-schema-draft
- Audited source HEAD: **cbef0709e740c380d748fb38d9485e2eb617f7c8**
- Audit date: 2026-10-30
- Instruction: [CODEX_AUDIT_PROMPT_016.md](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_AUDIT_PROMPT_016.md)
- Baselines: [CODEX_AUDIT_REPORT_011.md](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_AUDIT_REPORT_011.md) and [CODEX_REVIEW_012.md](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_REVIEW_012.md)
- Deliverable: this English report only. Application source, SQL, other documents, and main are not modified.

## 1. Executive decision

**Suitable for an isolated disposable test database: YES, as an unverified prototype, with the external API disabled until the complete migration chain succeeds.**

**Suitable for production: NO.**

The new changes have meaningful, supportable effects by static analysis:

1. **013 addresses the inherited INSERT ... RETURNING policy defect.** Its active-row, row-local owner branch can authorize the candidate row before insertion. Member access remains scoped by the existing helper, and the deleted-row condition surrounds both branches.
2. **014 disables the dangerous preparation function, rather than implementing safe deletion.** The final function body contains no data-modifying statement and unconditionally raises SQLSTATE 0A000. Even a caller retaining EXECUTE cannot use that body to perform the old transfers/deletions. Direct named service_role EXECUTE is now explicitly revoked as well.
3. **015–016 block the original old-snapshot RPC counterexample at the named RPC entry points.** They check the real PostgreSQL current transaction isolation setting and reject everything other than READ COMMITTED before protected table operations. Their signatures and original bodies are otherwise preserved.
4. **These facts do not prove complete closure of the three baseline High findings.** Account deletion remains unavailable and unimplemented; administrative routes and effective ownership/ACLs are unverified; direct table SELECT policies do not enforce the RPC isolation restriction.

No unconditional Critical exploit or unconditional syntax error was established in 013–016. A conditional High exposure remains for direct-table authorization under old snapshots if such transactions are reachable. Existing integration, ACL, synchronization, and retry requirements also remain.

**No SQL was executed, no database was provisioned, and no runtime security test was run.** This report records static evidence and proposed reproductions, not passing tests. All statements about the final database state are conditional on successful application of the complete chain.

## 2. Evidence and scope

All actual SQL files 001–016, both saved baseline reports, the new gates, H03_ISOLATION_REMEDIATION.md, ACCOUNT_DELETION_IMPLEMENTATION.md, SYNC_PROTOCOL_V02.md, and OWNERSHIP_TRANSFER_RULES.md were read from the audited HEAD.

Source comparison from prior review commit 40f19466fb8a133b5b49782774be7d8e7acee952 to the audited HEAD showed only additions: migrations 013–016 and four instruction/gate/remediation documents. Migrations 001–012 and the baseline reports are unchanged.

Additional source-level checks performed:

- Compared each replacement routine in 016 with its preceding definition. Removing the single added isolation-check block produces an exact source match for apply_item_change, remove_list_member, and transfer_list_ownership, including their signatures.
- The same comparison of 015 against 007 produces an exact match after removing the isolation guard.
- Read PostgreSQL REL_17_STABLE source and documentation for isolation-setting semantics and CREATE OR REPLACE behavior. This is reference-code inspection, not execution against the target server.

Evidence categories used below:

- **Static fact/defect:** directly visible in source, sometimes conditional on a stated transaction mode or privilege.
- **Conditional runtime risk:** reachability, configuration, or execution behavior that must be checked on the actual deployment.
- **Missing functionality:** a required design or implementation absent from the chain.

The target PostgreSQL, Supabase, PostgREST, connection-pool, Auth, and role configurations have not been inspected live. No review statement substitutes for those checks.

## 3. Disposition of the three baseline High findings

The identifiers here refer specifically to CODEX_AUDIT_REPORT_011.md.

| Baseline finding | Evidence in the new code | Current disposition |
|---|---|---|
| **H-01 — Incomplete account-deletion lifecycle** | 014 replaces preparation with an unconditional exception; it adds no authenticated deletion fence, durable attempt, final Auth orchestration, or recovery | **Old preparation path disabled by code; lifecycle not implemented and not accepted as fixed.** Keep deletion unavailable. |
| **H-02 — Administrative deletion EXECUTE boundary** | 014 removes all destructive code from this signature and revokes PUBLIC/anon/authenticated/service_role EXECUTE | **Destructive behavior of this exact function is mitigated by code, including callers with residual EXECUTE.** Effective owners, inherited grants, alternate routines, and backend routes remain unverified. This is not a completed secure administrative deletion feature. |
| **H-03 — Old REPEATABLE READ membership snapshot** | 015 guards pull; 016 guards item mutation, member removal, and transfer before protected table work | **The original RPC reproduction is addressed by code under standard PostgreSQL semantics.** Runtime confirmation is absent, and direct RLS table reads remain outside the guard. Global strict-revocation closure is not established. |

Baseline references: [report 011:94–117](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L94), [118–140](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L118), [141–167](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L141).

It would be inaccurate either to mark all three High findings fully resolved or to claim the old destructive preparation body is still the final callable implementation. Accept the specific mitigations, retain their qualifications, and require the tests in section 10.

## 4. Migration 013: creation RETURNING and access boundaries

**Source:** [013_list_creation_returning_policy.sql:9–18](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/013_list_creation_returning_policy.sql#L9).

The final SELECT policy is:

```sql
deleted_at IS NULL
AND (
  owner_id = (SELECT auth.uid())
  OR public.can_access_list(id)
)
```

### 4.1 Does it address M-012-01?

**Yes by static analysis; actual PostgreSQL/PostgREST behavior still needs verification.**

The prior policy required a helper lookup of a row that did not yet exist when INSERT ... RETURNING required a SELECT-policy WITH CHECK. The new owner branch evaluates the candidate row's owner_id directly. A valid self-owned active candidate can therefore pass without the helper finding it in shopping_lists.

The unchanged insertion policy in [001:77–78](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/001_initial_schema.sql#L77) still requires owner_id = auth.uid() and deleted_at IS NULL. The 012 trigger still requires revision zero and transaction-start timestamps. 013 does not weaken those checks or grant table rights.

Expected creation behavior to test:

- Minimal insertion with defaults: valid under intended privileges.
- INSERT ... RETURNING id, revision, created_at, updated_at: expected to pass the corrected policy.
- Supabase/PostgREST representation return, including client .insert(...).select(): expected to benefit, but the precise API request and deployed schema cache must be tested.
- A member cannot insert a new list owned by another user merely because the SELECT helper grants member reads; the separate INSERT policy still rejects the owner mismatch.

### 4.2 Does it open another user's list?

No direct outsider-read bypass was established in the policy expression.

- An outsider is neither the row's owner nor a member recognized by can_access_list.
- A current member retains access through the existing scoped helper.
- The outer deleted_at condition hides deleted lists from owners and members alike.
- Anonymous is not a target role of this policy.
- A missing UID does not satisfy the owner equality or the helper's ownership/membership match.
- SELECT permission does not confer UPDATE/DELETE permission or change the owner/member RPC authorization checks.

The helper owner must still be trusted and have the intended RLS behavior. A row-local owner branch does not make recursive or incorrectly owned helper definitions safe for every non-owner path.

### 4.3 Interaction with 012 and other mutations

013 does not modify or disable the 012 trigger. The following remain enforced on new rows, with enabled triggers and the intended DDL privilege boundary:

- initial list revision is zero;
- created_at and updated_at equal transaction_timestamp(), consistent with now() defaults;
- explicit equivalent now() values can pass, because value equality is not input-provenance verification;
- later revision/updated_at/owner changes by reviewed RPCs are not blocked by this INSERT-only guard.

Existing malformed rows are not repaired. Historical imports and administrative trigger bypasses remain separate concerns. The specific PUBLIC UPDATE(owner_id) column grant is still revoked by 012; inherited or table-level rights still require audit.

## 5. Migration 014: what is disabled, what is retained, and alternate paths

**Source:** [014_disable_unsafe_account_deletion.sql:4–20](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/014_disable_unsafe_account_deletion.sql#L4).

### 5.1 Fail-closed body

The final public.prepare_account_deletion(uuid) body only raises:

```sql
RAISE EXCEPTION 'Account deletion is temporarily unavailable'
  USING errcode = '0A000';
```

There is no transfer, deletion, membership lookup, event insertion, notification insertion, dynamic SQL, or external call. A caller with sufficient permission to enter the function receives the exception, not the old result. An unauthorized caller can be denied before entry.

This applies even to the function owner, a trusted administrative caller, or an inherited-role caller still holding EXECUTE: a remaining grant alone cannot skip the exception. NULL input does not create an alternate successful branch. A non-void function with an unconditional exception need not reach a RETURN; this is not an identified syntax defect.

Catching the exception outside the function does not execute the removed body. Nor does a normal RLS bypass disable an unconditional PL/pgSQL RAISE.

### 5.2 CREATE OR REPLACE properties

PostgreSQL preserves ownership and permissions when replacing an existing function. It does not simply preserve every old routine attribute: other properties are assigned from the replacement command, including specified or implied defaults.

Here the replacement explicitly states language plpgsql, SECURITY DEFINER, and SET search_path = ''. Its signature and jsonb result match the earlier definition. There is no renamed unsafe sibling in the repository: the same signature from 010/011 is replaced.

The subsequent REVOKE covers PUBLIC, anon, authenticated, and service_role. It does not automatically remove every inherited/indirect EXECUTE path or the owner's inherent authority. Those residual rights are latent configuration issues, not a demonstrated path through the new throwing body.

Required catalog checks remain:

- actual owner and ability of untrusted roles to ALTER/replace the function;
- all matching/overloaded routines and privileged wrappers present in the real database;
- actual proacl and role memberships after replacement;
- final body and effective attributes;
- successful migration completion and invalidation of cached definitions.

An already executing old call is not retroactively undone by editing its catalog definition. Apply with API access disabled and drain/quiesce old work. Do not expose intermediate 010/011, restore their old definitions later, or assume a failed 014 leaves the system gated.

### 5.3 Is account deletion globally impossible now?

**No. The exact preparation RPC is disabled, not all possible administrative operations.**

- [006:7–9](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/006_membership_safety.sql#L7) still makes owner_id reference auth.users with ON DELETE RESTRICT. Direct deletion of a user who still owns a list should fail.
- That FK does not prevent deletion of an account with no owned lists.
- [001:16](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/001_initial_schema.sql#L16) still cascades membership rows when the referenced Auth user is deleted.
- A sufficiently privileged SQL or Auth Admin path can delete eligible identities, remove data directly, or change schema/constraints. The stub is not a global administrator sandbox.
- A user can still perform approved voluntary ownership transfers; that routine is not the safe account-deletion orchestration.
- A backend must not catch 0A000 and silently fall back to direct destructive cleanup.

No user-accessible alternate destructive backend route was established from the reviewed SQL. Actual Auth/backend configuration and deployed routines must be inspected before claiming the entire feature is unavailable. The repository remains a draft local application rather than evidence of a tested cloud route configuration.

## 6. Migrations 015–016: isolation semantics, preservation, and coverage

### 6.1 The setting being checked is the correct setting

**Sources:**

- [015_pull_isolation_guard.sql:12–15](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/015_pull_isolation_guard.sql#L12)
- [016_mutation_isolation_guards.sql:21–24,96–99,120–123](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L21)

current_setting('transaction_isolation') reports the current transaction's registered PostgreSQL isolation setting. It is not the custom GUC used in the former 008 owner guard. The canonical READ COMMITTED value is the lower-case string with a space: 'read committed'.

Important distinctions:

- default_transaction_isolation controls new transactions; changing that default does not relabel an already established old snapshot.
- PostgreSQL checks changes to transaction_isolation. Once the first snapshot is established, changing to another isolation level is rejected. A caller cannot normally retain an old REPEATABLE READ snapshot and merely SET the displayed value to READ COMMITTED.
- Switching before any snapshot/query to READ COMMITTED means the old-snapshot premise no longer applies; it is not a demonstrated bypass.
- The guard also rejects SERIALIZABLE and the explicit 'read uncommitted' setting. PostgreSQL implements READ UNCOMMITTED with READ COMMITTED behavior, but this code intentionally accepts only one canonical label. That is conservative and must be documented as an API compatibility choice.
- Standard registered-setting lookup is not a demonstrated NULL/custom-setting spoof. No bypass through search_path shadowing of pg_catalog.current_setting was established.
- Do not try to force a downgrade inside the RPC after snapshots exist; initialize supported transactions at the trusted API boundary.

These conclusions were cross-checked against PostgreSQL REL_17_STABLE source:

- [guc_tables.c:216–220](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/misc/guc_tables.c#L216) and [4821–4838](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/utils/misc/guc_tables.c#L4821), retrieved blob cf468ba7d1020e93e163d6bd55565a5a13057759.
- [variable.c:583–612](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/commands/variable.c#L583), retrieved blob aee6bbd4f442f8236d5927cea520dcfb5a877a43.
- [CREATE FUNCTION documentation:79–84](https://github.com/postgres/postgres/blob/REL_17_STABLE/doc/src/sgml/ref/create_function.sgml#L79), retrieved blob 3f6e579c8307bd8b0a4930159fa5331c41618079, for replacement semantics.

Reference inspection is not a target-version runtime test.

### 6.2 Guard placement and preserved interfaces

| Final routine | Definition / guard | Static disposition |
|---|---|---|
| pull_item_changes(uuid,bigint,integer) | 015:6–15 | Rejects unsupported isolation before UID validation, locking, or reading change rows |
| apply_item_change(uuid,uuid,text,uuid,text,boolean,bigint) | 016:6–24 | Rejects before list/item work; declaration reads auth.uid(), not protected list/member data |
| remove_list_member(uuid,uuid) | 016:91–99 | Rejects before list lock or membership deletion |
| transfer_list_ownership(uuid,uuid) | 016:114–123 | Rejects before owner lookup, membership swap, event, or notification |
| prepare_account_deletion(uuid) | 014:4–11 | Always unavailable; no isolation guard is needed to make its current body non-destructive |

The actual text comparison confirmed that signatures, defaults, and the prior bodies are unchanged apart from the guards. In particular:

- 015 keeps the same table result columns and input defaults as 007.
- 016 keeps all three prior signatures/default arguments.
- SECURITY DEFINER and SET search_path = '' remain explicit.
- The routines retain default VOLATILE behavior, so this change does not turn authorization queries into an intentionally fixed STABLE function snapshot.
- PostgreSQL CREATE OR REPLACE preserves owner and existing permissions. 016 does not need to re-grant the known prior authenticated EXECUTE permissions to preserve them.
- That preservation also means unwanted historical grants are not cleaned up. Correct sequence and actual ACL inspection remain necessary.
- Applying 016 without its predecessors is unsupported; CREATE OR REPLACE can create an absent routine with defaults rather than reconstruct the intended prior ACL contract.

The repeated DECLARE keyword in the transfer routine remains permissible PL/pgSQL syntax, as noted in the baseline audit. No new unconditional syntax/signature conflict was identified. A clean migration run has not been performed.

### 6.3 Does this block the original H-03 RPC scenario?

**By code and standard PostgreSQL semantics, yes for the named RPCs.**

A B session retaining an old REPEATABLE READ snapshot now gets 0A000 from pull or item mutation before the protected operation. The code does not rely on FOR UPDATE alone forcing old snapshots to become current.

For supported READ COMMITTED calls, the existing locks are retained:

- pull takes FOR SHARE on the active list row;
- mutation, removal, and transfer take FOR UPDATE;
- authorization occurs after acquiring that lock;
- member removal and transfer therefore conflict with an earlier pull/mutation when all writers use this protocol.

After a waiting READ COMMITTED call acquires the lock, the later authorization query in the VOLATILE routine is expected to use current committed state. A newly revoked member should fail. Practical two-session tests must demonstrate this with both commit and rollback orderings.

### 6.4 What remains outside those guards?

| Surface | Isolation enforcement in the reviewed source | Consequence |
|---|---|---|
| Direct shopping_lists SELECT | None in 013 | Old row/owner/member snapshot remains possible if old-snapshot transactions can reach the table |
| Direct shopping_items SELECT | None in 002 | Uses snapshot-based can_access_list without invoking the guarded RPC |
| Direct list_members SELECT | None in 001 | Same residual snapshot issue |
| can_access_list / is_list_owner | No isolation restriction | Necessary to review both direct invocation and their RLS use |
| Direct self-owned list INSERT | 012 checks metadata, not isolation | Unguarded, but no new cross-user membership exploit is established for creating one's own row |
| user_notifications SELECT | Recipient check, no isolation guard | Separate personal-notification/history contract; not evidence of new membership authorization |
| Privileged direct SQL/Auth operations | No global RPC enforcement | Must be constrained by the trusted backend/administrative protocol |
| Future invitation/sharing/creation/deletion RPCs | Not implemented/enforced here | Must satisfy their own isolation, account-fence, and locking requirements |

The source therefore does not enforce “all user-facing data access is fresh READ COMMITTED” globally. PostgREST may normally create such requests, but that deployment fact cannot be assumed as evidence. This is the principal residual scope issue for H-03.

## 7. Findings and remaining risks

### Critical

No unconditional Critical defect established. Actual privileges and API reachability are not verified.

### H-016-01 — Direct RLS reads remain outside the isolation enforcement

**Severity:** High if old-snapshot direct-table transactions are reachable; otherwise an unverified boundary condition for the supported API contract.  
**Classification:** Static coverage gap with a conditional runtime exposure.  
**Status:** Residual baseline H-03 scope, not a bypass of the guarded RPC check.  
**Reproducibility:** Proposed two-session test; not executed.

**Locations:**

- [013:9–18](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/013_list_creation_returning_policy.sql#L9)
- [001:38–47,85–86](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/001_initial_schema.sql#L38)
- [002:49–52](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/002_security_hardening.sql#L49)
- Contrast with [015:12–15](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/015_pull_isolation_guard.sql#L12) and [016:21–24](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L21).

**Scenario:** B establishes a REPEATABLE READ snapshot while a member. A removes B and commits. B's guarded RPC fails as intended, but a direct SELECT from shopping_items or shopping_lists can still consult the old membership snapshot and return historical rows. Use a savepoint around the expected RPC error before continuing the reproduction; otherwise the transaction is aborted.

**Impact:** A global strict-revocation claim would be false if direct old-snapshot table access is supported. This does not show that a new normal READ COMMITTED HTTP request retains access, and it does not show that REPEATABLE READ sees events committed after its snapshot.

**Expected behavior:** An explicitly enforced access contract across every exposed data route.

**Minimal safe fix:** Prove and enforce fresh supported transactions for all exposed direct-table routes, or remove unnecessary direct reads and provide an appropriate guarded API/policy design. If strict rejection is required for direct SQL, the table/RLS path also needs an enforceable design. Preserve the owner-local INSERT RETURNING fix when redesigning policies. Test actual PostgREST role/isolation configuration and any wrappers rather than merely adding more guards to already-covered RPCs.

### H-016-02 — The approved deletion lifecycle is still absent, with the feature gated

**Severity:** Baseline High production requirement; current exact preparation-RPC damage is mitigated by disabling it.  
**Classification:** Missing functionality plus unverified alternate-route isolation.  
**Status:** Baseline H-01 not implemented; H-02 destructive function path blocked by code.  
**Reproducibility:** Stub and route tests proposed; not executed.

**Locations:** [014:4–20](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/014_disable_unsafe_account_deletion.sql#L4), [006:7–9](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/006_membership_safety.sql#L7), [ACCOUNT_DELETION_IMPLEMENTATION.md:5–22](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/ACCOUNT_DELETION_IMPLEMENTATION.md#L5).

**Scenario:** A future backend treats the gated SQL function as an optional preparation step and falls back to direct Auth/Admin cleanup, or re-enables the old body before fencing and recovery exist. For an account owning lists, RESTRICT should reject deletion; a member-only account is not protected by that owner FK.

**Impact:** The approved transfer/deletion behavior cannot be delivered safely through the current stub. Alternate privileged routes can invalidate a claim that account deletion is globally unavailable.

**Expected behavior:** Until the authorized, fenced, durable, recoverable workflow exists, no user-facing deletion route or fallback performs it.

**Minimal safe fix:** Keep the feature disabled, verify all backend/Auth routes and live function definitions, and implement the full lifecycle before re-enabling. Include authoritative actor binding, effective administrative-role checks, per-account fencing, coordinated list/member changes, durable attempts, and Auth failure recovery.

This is not a finding that 014's body still performs unsafe DML: it does not. The old scenario “this final preparation call commits destructive work, then Auth deletion fails” is blocked at the call by the new exception.

### M-016-01 — Owners and preserved grants remain a deployment trust boundary

**Severity:** Medium; required before API exposure.  
**Classification:** Runtime configuration risk and an incomplete ACL contract, carried from the baseline.  
**Reproducibility:** Catalog and role testing required; not executed.

**Locations:** [014:4–15](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/014_disable_unsafe_account_deletion.sql#L4), [015:40–41](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/015_pull_isolation_guard.sql#L40), [016:6–11,91–92,114–115](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L6), [012:31–32](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/012_list_creation_guard.sql#L31).

**Scenario:** The actual database retains inherited column/table UPDATE, a routine owner is unsuitable, or a wrapper/backend exposes a privileged write path. CREATE OR REPLACE preserves owner/permissions; it does not rebuild a least-privilege installation. A role able to replace the supposedly gated function can undo its safety.

**Impact:** Direct workflow bypasses, denied legitimate RPCs, recursive helper RLS, or incomplete deployment hardening. Residual EXECUTE on the throwing function is not by itself a destructive exploit, but matters if the feature is later re-enabled.

**Expected behavior:** Trusted pinned owners, audited effective role memberships, minimal explicit schema/table/column/routine permissions, and no untrusted DDL authority.

**Minimal safe fix:** Inspect/fix actual ACLs and defaults, including PUBLIC and inherited roles; table/column UPDATE; TRUNCATE; schema CREATE; table TRIGGER; routine alteration/replacement authority; and privileged backend routes. Do not add FORCE RLS indiscriminately to helpers designed to avoid recursion.

The previous TRUNCATE list_members omission was fixed by 006. The specific PUBLIC UPDATE(owner_id) column omission was fixed by 012. Neither should be repeated as an unchanged code omission.

### M-016-02 — Transfer still lacks operation identity and ownership-generation preconditions

**Severity:** Medium.  
**Classification:** Existing retry/stale-command design gap, preserved in the replacement body.  
**Reproducibility:** Proposed lost-response/transfer-back test; not executed.

**Location:** [016:114–149](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L114).

**Scenario:** A-to-B succeeds but its response is lost. A's immediate retry is denied because A is no longer owner. If B transfers back before the delayed retry arrives, the old A-to-B command becomes authorized again and performs a new transfer and notification.

**Impact:** An old request can become an unintended new sensitive operation after intervening legitimate state changes. The new isolation check does not identify stale user intent.

**Expected behavior:** Distinct durable operation identity and an expected ownership generation.

**Minimal safe fix:** Add actor/operation result storage and payload comparison with an ownership-version precondition under the list lock. Keep the approved no-recipient-consent product behavior.

### M-016-03 — Initial snapshot, retention, and permission metadata synchronization remain incomplete

**Severity:** Medium; integration blocker.  
**Classification:** Missing functionality carried from the baseline.  
**Reproducibility:** Reconstruction/retention tests proposed; not executed.

**Locations:** [015:32–45](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/015_pull_isolation_guard.sql#L32), [016:78–82,139–148](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L78), [003:16–24](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/003_sync_tables.sql#L16).

**Scenario:** A client rebuilds solely from events despite pre-log rows, needs history already pruned by a future retention job, or treats an unchanged item revision as proof that ownership/membership is unchanged.

**Impact:** Incomplete state reconstruction, stale controls, or unbounded retry of unavailable operations.

**Expected behavior:** A full snapshot bound to an event revision, retained-history floor/recovery contract, terminal unavailable/deleted-list behavior, and authoritative permission refresh.

**Minimal safe fix:** Define and implement those mechanisms before integrating synchronization. Include required row fields in snapshots and isolate guest/account queues. Current absence of a retention job must not be represented as observed pruning.

### M-016-04 — Historical identity retention and Siri authorization are still separate unfinished boundaries

**Severity:** Medium for the affected future features.  
**Classification:** Missing functionality carried from the baseline.  
**Reproducibility:** Not runtime tested.

**Locations:** [008:5–20,24–29](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/008_ownership_infrastructure.sql#L5), [016:144–148](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L144), [SYNC_PROTOCOL_V02.md:32](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/SYNC_PROTOCOL_V02.md#L32).

**Scenarios:** Ownership records/notification JSON retain old identifiers without the approved retention/pseudonymization contract; or a future Shortcut is given a normal user's token and calls the general mutation RPC for update/delete as well as add.

**Impact:** Unspecified historical identity lifecycle and overbroad future Siri capabilities.

**Expected behavior/minimal safe fixes:** Define history access and retention across structured columns and JSON; build a separate list-bound, add-only, revocable Siri credential and endpoint with current authorization, rate limits, and deduplication. The isolation guard is not a capability scope check. No unsafe working Siri endpoint was established in this audit.

### L-016-01 — NULL action validation remains incorrect

**Severity:** Low.  
**Classification:** Static inherited input-validation defect.  
**Reproducibility:** Proposed call; not executed.

**Location:** [016:28–30,47–82](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L28).

NULL NOT IN (...) does not evaluate true. With suitable other parameters the function can enter its delete branch and fail later when a NULL change kind violates NOT NULL. The exception should roll back all effects; no successful unlogged deletion is established.

**Expected behavior/minimal fix:** Reject p_action IS NULL explicitly before action dispatch. Test both early rejection and zero partial writes.

### L-016-02 — Item conflict and cross-list operation-collision errors remain unstructured

**Severity:** Low.  
**Classification:** Existing API/error-contract gap.  
**Reproducibility:** Proposed concurrent test; not executed.

**Locations:** [003:14](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/003_sync_tables.sql#L14), [016:38–45,58–59,85–86](https://github.com/MusicMeasurer/shopping-app/blob/cbef0709e740c380d748fb38d9485e2eb617f7c8/cloud/drafts/016_mutation_isolation_guards.sql#L38).

One actor reusing an operation UUID concurrently on different lists may receive 23505 rather than the explicit payload-mismatch response. Version conflicts remain general exceptions. This can cause inappropriate permanent retries.

**Expected behavior/minimal fix:** Define stable permanent/transient conflict codes and safe operation-key race handling. Preserve atomic rollback. Different-list requests have different payloads; the loser should not receive the other list's result.

MD5 here is payload comparison, not an authentication signature. Exact canonical-payload equality or a modern digest is preferable for a strict mismatch guarantee; no valid-payload collision was demonstrated.

## 8. Complete-chain regression and privilege assessment

### 8.1 Final effective implementations

- Tables, authorization helpers, and original policies start in 001.
- 002/003 close direct client member creation and item writes, hide tombstones from ordinary reads, and protect item identity.
- 006 replaces owner-account CASCADE with RESTRICT and closes direct member DELETE/TRUNCATE.
- 008's custom owner-GUC guard is temporary; 009 removes it. 003 already revoked ordinary table UPDATE, so setting the GUC alone was not proof of a clean-chain ownership exploit.
- 009's transfer implementation is replaced by 016 with the same semantics plus isolation rejection.
- 010/011 preparation is replaced by the non-destructive 014 stub; their old multi-list loop is not the final active implementation.
- 012 metadata checks and PUBLIC owner-column revocation remain.
- 013 is the final list SELECT policy.
- 015 is the final pull implementation.
- 016 is the final mutation/removal/transfer implementation.

### 8.2 Syntax and assumptions

No unconditional syntax error was identified by inspection. This does not establish successful application.

The chain requires Supabase Auth relations/functions and roles, a suitable migration owner, extension/schema/relation privileges, and correct RLS bypass for the trusted helpers/RPCs. It is not a standalone clean PostgreSQL setup without Supabase scaffolding.

Known important semantics:

- Fixed empty search_path retains implicit pg_catalog lookup for built-ins.
- Output variables in pull are not an obvious column ambiguity: c.revision/c.kind/c.snapshot are qualified.
- CREATE OR REPLACE signatures match; return layouts and defaults are preserved.
- Repeated DECLARE is not itself an error.
- An unconditional throwing jsonb routine does not need to produce a successful return value.
- Versioned CREATE TABLE/ADD COLUMN/CREATE TRIGGER statements are not rerunnable without a migration ledger.
- A failed replacement or interrupted chain can leave old implementations active. Stop on first error and keep API access disabled.

014–016 are not a substitute for a migration transaction/deployment plan. Avoid exposing unsafe intermediate versions and quiesce active calls before upgrading. Production consolidation of provisional migrations remains advisable.

### 8.3 Expected role behavior to verify

| Surface | Expected final behavior |
|---|---|
| Anonymous | No cloud application data or mutation permission |
| A owner | Valid creation/RETURNING and authorized item/transfer operations under READ COMMITTED |
| B current member | Read/add/update/delete items; self-leave; no owner-only transfer or direct list mutation |
| C outsider | No private list/item/member reads; no item or ownership changes |
| Direct client item/member/log writes | Denied by actual effective ACLs and applicable RLS |
| Direct list UPDATE/DELETE/TRUNCATE | Denied; inspect inherited and column grants |
| Direct change/operation-log SELECT | No ordinary client rows via the current policy configuration |
| Notifications | Recipient-only reads; direct client writes denied |
| Preparation RPC | Permission denied, or unconditional 0A000 for any caller that can enter |
| Non-READ-COMMITTED guarded RPC | 0A000 before protected table work |
| service_role / database administrator | Trusted privileged capability, not proof of end-user RLS safety |

source-level GRANT/REVOKE statements alone do not establish these actual outcomes. Record schema rights, pg_default_acl, pg_auth_members, relation and column ACLs, sequence permissions, routine proacl/proowner/proconfig/prosecdef, and effective privileges.

### 8.4 Locking and identity assumptions

Accepted READ COMMITTED RPCs retain the common list-row lock protocol. Protected mutation, version/revision, event, and saved result remain in one SQL transaction. Transfer's membership swap, ownership event, and notification remain atomic together.

No new wrong-lock-order bug was established for the four individual RPCs. Batch transactions holding multiple list locks, privileged membership writes, future invitations, and Auth cascades still need a transaction-wide lock/retry design. Do not test the obsolete 011 loop and present its result as proof about the final gated deletion function.

auth.uid() supplies the trusted request actor; the SQL does not validate JWT signatures or consult a live session registry. SQL tests setting request GUCs simulate identity only. Arbitrary SQL access capable of setting identity claims is outside a normal authenticated PostgREST boundary and must not be mistaken for authenticated JWT validation.

## 9. Real Supabase compatibility questions requiring runtime evidence

1. What PostgreSQL/PostgREST versions and role-level defaults are actually deployed?
2. Does every ordinary request begin a fresh READ COMMITTED transaction, including direct table routes, RPC calls, wrappers, and pooled connections?
3. Are any role/database/function settings selecting REPEATABLE READ, SERIALIZABLE, or explicit READ UNCOMMITTED?
4. Do the four RPCs still have the intended EXECUTE grants and trusted owners after exact replacement?
5. Does PostgREST's schema cache expose the intended signatures/default arguments and updated creation behavior?
6. Are real Authorization tokens producing the expected auth.uid(), with no client-controlled actor override?
7. Are errors 0A000 treated as permanent unsupported/unavailable responses, rather than triggering retry loops or destructive deletion fallbacks?
8. Are administrative Auth deletion routes actually disabled or properly isolated?
9. Are schema CREATE, table TRIGGER, routine alteration, trigger bypass, and privileged direct DML unavailable to untrusted users?
10. Can direct table reads occur in unsupported old-snapshot transactions, or is that outside an enforced deployment boundary?

No answer to these questions was established from a live service in this audit.

## 10. Disposable-database test matrix — proposed, NOT EXECUTED

### 10.1 Test setup and evidence

Use a disposable Supabase stack/project, no production data. Keep external API access disabled while applying unchanged 001–016 in order, with stop-on-error. Record the first SQLSTATE and the final function/policy definitions.

Create real test Auth identities A, B, and C. A owns at least two lists; B is a member of one; C is an outsider. Use separate privileged fixture setup only because safe invitation acceptance is not implemented. Add another member for transfer ordering/recipient tests if needed.

Capture:

- actual PostgreSQL, Supabase, PostgREST versions;
- migration identity, object owners, RLS flags, policies;
- schema/table/column/default/routine/sequence privileges and inheritance;
- final pg_get_functiondef output for all replaced functions;
- trigger enabled state and FK delete actions;
- real HTTP requests and responses;
- SQL transaction isolation, wait events, lock graphs, commit outcomes, row/event counts.

Test both SQL role simulations and actual Auth/PostgREST tokens. Never use postgres/service_role alone as evidence that end-user RLS works.

### 10.2 013 creation and access matrix

| Test | Expected result to assert |
|---|---|
| A inserts own active list with metadata omitted, no RETURNING | Success under intended privileges |
| A INSERT ... RETURNING id, revision, created_at, updated_at | Success; revision 0 and transaction-start dates |
| Actual PostgREST minimal/representation-return requests | Both supported paths work with correct Auth UID |
| Wrong-owner insert by A/B/C | Denied; no row |
| Anonymous insert/read | Denied |
| C SELECT A's private list/items/members | No private data |
| Current B SELECT shared list | Allowed |
| Deleted list, including owner/member reads | Hidden |
| Revoked B fresh READ COMMITTED read | Denied/empty as documented |
| Forged initial revision or dates | 012 rejection, no row |
| Later item change/ownership transfer | Creation guard does not block authorized updates |

### 10.3 014 all-callers, zero-effects matrix

For anon, authenticated A/B/C, service_role, function owner, a test inherited-role caller, and a prepared statement created before replacement where feasible:

- Call the exact public.prepare_account_deletion(uuid) signature for A, B, missing/nonexistent identifiers, and NULL.
- Accept permission denial before entry, or require 0A000 once entered.
- Assert unchanged lists, items, memberships, operation/change logs, ownership events, and notifications.
- Inspect for additional live overloads or wrappers and test every reachable administrative route.
- Demonstrate that capturing the exception outside the call does not invoke any removed DML.
- Verify that direct deletion of an owner with lists fails due to RESTRICT.
- Separately test a member-only identity deletion administratively; record the membership cascade and confirm no user-facing fallback is enabled.
- Quiesce old in-flight work during migration. A cached new invocation should use the replacement; an already running old invocation is a separate deployment hazard.

Use separate transactions or savepoints for expected exceptions. An aborted transaction cannot be used to prove later assertions without rollback.

### 10.4 Isolation acceptance and rejection

| Mode | Each of the four guarded RPCs |
|---|---|
| READ COMMITTED | Authorized normal operation proceeds |
| REPEATABLE READ, before/after explicit snapshot creation | 0A000, no protected data returned or DML committed |
| SERIALIZABLE | 0A000, no protected effects |
| Explicit READ UNCOMMITTED | 0A000 under this intentionally strict label contract |
| Different next-transaction default, current transaction READ COMMITTED | Current transaction behavior follows transaction_isolation, not merely the default |
| Attempt to relabel established REPEATABLE READ to READ COMMITTED | PostgreSQL rejects the change; cannot preserve and relabel the old snapshot |
| Same prepared call reused across transactions/modes | Guard re-evaluates actual isolation; cached plan does not freeze a previous accepted value |

Repeat through actual PostgREST/connection pooling. SQL simulations alone do not prove per-request isolation or schema-cache behavior.

### 10.5 Precise H-03 regression scenarios

**Original RPC counterexample, now expected to be blocked:**

1. B begins REPEATABLE READ and establishes an authorized snapshot using an ordinary read without a list row lock.
2. A removes B in a separate READ COMMITTED transaction and commits.
3. B attempts pull and item mutation in the old transaction, with separate savepoints around each expected failure.
4. Require 0A000, no returned change rows, and no new item/version/revision/event/operation effects.
5. Repeat SERIALIZABLE and the membership/transfer RPCs.

**Residual direct-table coverage test:**

1. Repeat the old-snapshot setup.
2. After rollback to a savepoint containing an expected RPC error, issue direct SELECT from shopping_lists, shopping_items, and list_members.
3. Record historical rows and helper decisions. If exposed, this demonstrates H-016-01 rather than a successful RPC-guard bypass.
4. Inspect whether this transaction mode is reachable through the real supported client/API boundary.

**READ COMMITTED lock protocol:**

1. B completes pull or mutation inside an open transaction.
2. A calls remove_list_member in another session.
3. Verify A waits for B to commit/roll back.
4. Once removal commits, a new B call must fail.
5. Reverse ordering so B waits behind removal, then require denial after lock acquisition.
6. Repeat voluntary transfer and recipient removal, with both commit and rollback.

Inspect actual locks/wait events instead of relying only on arbitrary sleep delays.

### 10.6 Unchanged mutation/transfer guarantees and errors

- Successful add/update/delete retries: one operation, one revision/event, saved result returned.
- Same UUID with altered payload: no additional mutation.
- Same actor/operation concurrently on different lists: documented permanent failure for the loser, no partial loser state.
- Same expected item version concurrently: no silent overwrite.
- Wrong-list item UUID or tombstone update: denied.
- Forced error after item update but before log completion: full rollback.
- NULL action: capture the current late-failure defect and require early validation after a future fix.
- A-to-B transfer: new owner not a member, former owner a member, only B notified, one event.
- Lost transfer response, transfer-back, delayed replay: characterize M-016-02.
- Former-owner owner-only calls: denied immediately in new supported requests.
- Multi-list/batched administrative work: inspect deadlocks and retry the entire transaction for 40P01/40001 only under a defined idempotent protocol.

### 10.7 Remaining integration gates

- Full snapshot plus event boundary, retained-history floor, old/future cursors, paging under concurrent writes, deleted/unavailable list handling.
- Metadata refresh when ownership changes without an item revision change.
- Historical identity retention in ownership columns and notification JSON.
- Future invitation acceptance with list locks, recipient verification, and account deletion fencing.
- Future Siri add-only/list-bound credential tests.
- IndexedDB migration, atomic local queue, account/guest isolation, delayed response cancellation, and import confirmation.

These features cannot be marked tested by reviewing the four new SQL files.

## 11. Final resolution register

| Concern | Audited status |
|---|---|
| M-012-01 INSERT RETURNING policy failure | Addressed by 013 by code; runtime pending |
| 012 initial revision/date checks | Preserved; no new bypass established under intended privileges |
| Old destructive 010/011 preparation body | Replaced by unconditional 014 failure for this signature |
| H-01 complete safe deletion lifecycle | Not implemented; feature must remain disabled |
| H-02 destructive behavior through this preparation signature | Mitigated by code, even with residual EXECUTE; actual routes/owners/ACLs unverified |
| H-03 original stale-snapshot pull/mutation RPC scenario | Addressed by 015–016 by code under standard isolation semantics; runtime pending |
| H-03 global strict revocation across direct tables/other routes | Not established; H-016-01 remains conditional |
| Four routine signatures/defaults/original bodies | Preserved by static text comparison apart from guards |
| Complete ACL and trusted-owner model | Still unverified/incomplete |
| Safe invitations, account orchestration, snapshots/retention, Siri/client sync | Not implemented/accepted here |
| Production readiness | **NO** |

**Final verdict:** proceed only with isolated deployment and the negative/concurrent tests. The new code contains credible scoped mitigations, but neither source comments nor this static audit establish full closure of the previous High findings. Only this report is saved and committed; no application code, SQL, main, or other document is changed.
