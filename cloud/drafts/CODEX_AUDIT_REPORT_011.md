# Independent security and correctness audit: ShoppingApp SQL 001–011

- Repository: MusicMeasurer/shopping-app
- Branch: feature/cloud-schema-draft
- Audited source commit: **9caad76f501df561fabab4a54b0391eb12e9d699**
- Audit date: 2026-10-30
- Instruction: [CODEX_AUDIT_PROMPT_011.md](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/CODEX_AUDIT_PROMPT_011.md)
- Gate read before analysis: [CODEX_AUDIT_GATE_011.md](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/CODEX_AUDIT_GATE_011.md)
- Deliverable: this report only. SQL, application code, other documentation, and main were not modified.

## 1. Executive verdict and evidence limits

**Ready for an isolated disposable test database: YES, as an unverified prototype to test, with the API inaccessible during migration and all eleven migrations applied before client access.**

**Ready for production: NO.**

The final sequence materially improves the earlier prototype. Migration 006 replaces destructive owner-account cascading with a restrictive foreign key and coordinates explicit membership removal. Migration 007 coordinates pull with those removals. Migration 009 implements an authorized voluntary transfer with transactional membership changes, an audit event, and a notification. Migration 011 replaces the uncoordinated membership cleanup in 010.

Those improvements do not establish production safety. The major unresolved boundaries are:

1. Account preparation is not a complete, recoverable account-deletion lifecycle. No account-level deletion fence prevents new ownership or membership after preparation.
2. The administrative preparation function accepts any user UUID and relies entirely on caller permissions and a future backend. Default or inherited EXECUTE grants, especially service_role grants, are not fully controlled by these migrations.
3. The revocation protocol is not sufficient for previously established REPEATABLE READ snapshots.
4. Privilege-only ownership protection after 009 requires a complete ACL contract; client-controlled initial revisions, synchronization recovery, and transfer retry semantics remain incomplete.

**No database was provisioned, no migration or test SQL was executed, and no production service was contacted.** Findings below distinguish:

- **Code-confirmed:** a property or missing check directly visible in the reviewed source, sometimes conditional on an explicitly stated execution mode.
- **Runtime risk:** an environment, ACL, planner, or concurrency outcome requiring deployment and measurement.
- **Missing functionality:** a required protocol or workflow that is not implemented.

Every reproduction described here is a proposed test, not a test result. A static counterexample is not a claim of successful runtime exploitation.

Scope includes all SQL migrations 001–011, the gate and prompt, SYNC_PROTOCOL_V02.md, OWNERSHIP_TRANSFER_RULES.md, ACCOUNT_DELETION_IMPLEMENTATION.md, and SECURITY_RETEST_006_007.md. All project references below identify the audited commit, rather than a moving branch.

## 2. Complete migration sequence and PostgreSQL/Supabase compatibility

### 2.1 Sequence assessment

| Migration | Effective contribution | Important qualification |
|---|---|---|
| 001 | Tables, authorization helpers, RLS, timestamp triggers | Owner FK initially cascades; initial client policies are not the final security state |
| 002 | Blocks direct membership creation; protects owner/item-list changes; hides deleted items | Its item UPDATE check prevents direct client soft deletion; later RPC must run under a suitable definer |
| 003 | Item versions, list revisions, operation/change logs; client write revocations; immutable item identity | List creation remains client-accessible if external/default INSERT grants permit it |
| 004 | Transactional item RPC | Depends on trusted owner and appropriate RLS bypass; NULL-action and error-contract issues remain |
| 005 | Initial pull RPC | Superseded by 007; do not evaluate its authorization race as the final implementation |
| 006 | Owner FK RESTRICT; no direct client member removal/TRUNCATE; removal RPC | Fixes the previously identified destructive owner cascade and direct-removal race under the intended locking protocol |
| 007 | Pull takes list FOR SHARE before authorization | Fixes the prior READ COMMITTED check/read race when all access-changing writers follow the list lock protocol |
| 008 | Ownership events, notifications, temporary custom-GUC owner guard | The GUC is not an authorization boundary; this must not become an exposed deployment endpoint |
| 009 | Removes temporary guard and restricts client UPDATE; adds transfer RPC | Final ownership protection is privilege-based; verify every source of UPDATE rights |
| 010 | Administrative preparation function | Membership cleanup is uncoordinated; implementation is superseded by 011 |
| 011 | Preparation locks affected lists and removes memberships under those locks | Still lacks account fencing, complete caller authorization/orchestration, and final Auth deletion |

**No unconditional SQL syntax error preventing first application of 001–011 to a correctly configured modern Supabase was identified by static inspection. This is not an execution result.**

Specific checks:

- Migration 009 lines 15–16 contain two DECLARE keywords. This is unusual but is not, by itself, a PL/pgSQL syntax defect. PostgreSQL's grammar explicitly permits extra DECLARE tokens. This was checked by reading the upstream parser source, not by executing SQL: [pl_gram.y, declaration grammar](https://github.com/postgres/postgres/blob/master/src/pl/plpgsql/src/pl_gram.y#L485), retrieved blob 37785f58cc2075586d3fa88f6653a35c694a886b. The target server version must still be recorded during testing.
- Output names in 005/007 do not create an obvious ambiguous-column error: the change-log columns are qualified with c.
- Empty search_path on the reviewed functions does not hide implicitly searched pg_catalog built-ins such as now, md5, jsonb_build_array, and jsonb_build_object. Application and Auth relations/functions are schema-qualified.
- The 002 owner trigger permits revision-only updates in 004. Migration 009 drops that trigger and its function; later owner updates are therefore not blocked by the old trigger.
- A suitable SECURITY DEFINER owner can bypass the 002 item UPDATE RLS check that otherwise prevents setting deleted_at.
- 006 targets the FK name generated by the unchanged 001 definition. An installation with manually renamed constraints is not the clean-sequence case.
- The migrations are not rerunnable: existing tables, columns, and triggers will cause duplicate-object errors on replay. This is normal for versioned migrations, but requires a migration ledger and defined recovery from partial application.

### 2.2 Required assumptions and possible failure classes

The sequence is Supabase-dependent, not standalone SQL for an empty PostgreSQL installation. It assumes auth.users, auth.uid(), anon/authenticated roles, and a migration role authorized to create the extension and all objects and reference Auth users.

First application or later invocation can fail if these assumptions are false:

- Missing Auth schema, roles, or relation: missing-object errors.
- Insufficient extension/schema/table/function privileges: privilege errors such as SQLSTATE 42501.
- An unsuitable definer owner: denied DML, denied RLS checks, or recursive authorization-helper evaluation.
- API role lacking schema USAGE or required table INSERT/SELECT: legitimate requests fail.
- Inherited/default permissions left broader than intended: unwanted operations may remain available.

These are conditional failure classes, not observed errors. Record the actual server version, SQLSTATE, owner, and grants at the first failure; do not silently add grants and then label the original migration sequence successful.

### 2.3 Intermediate states

Apply the chain with external API access disabled, preferably in one controlled transaction where supported by the migration runner. No statement in these files establishes a complete cross-file deployment transaction.

008 and 009 should be consolidated into one reviewed migration before production. However, an important distinction is necessary: **003 has already revoked ordinary client table UPDATE before 008 runs.** Setting the custom GUC alone does not restore that permission. The report therefore does not claim that a clean 001–008 installation automatically lets any authenticated client transfer ownership.

Likewise, do not expose the uncoordinated 010 implementation before replacement by 011. After finalization, test the final definitions, not obsolete definitions in isolation.

## 3. Findings by severity

### Critical

No unconditional Critical exploit was established. Actual ACLs, role inheritance, effective function ownership, and live API behavior were unavailable. That evidence limit is not a security approval.

### H-01 — Preparation is not a complete account-deletion lifecycle

**Severity:** High; production blocker.  
**Classification:** Code-confirmed missing lifecycle controls and missing backend functionality.  
**Reproducibility:** Proposed failure/concurrency tests; not executed.

**Locations:**

- [011_account_deletion_locking.sql:13–47](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/011_account_deletion_locking.sql#L13)
- [001_initial_schema.sql:77–78](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/001_initial_schema.sql#L77)
- [ACCOUNT_DELETION_IMPLEMENTATION.md:9–22](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/ACCOUNT_DELETION_IMPLEMENTATION.md#L9)

**Failure scenario:** A owns a personal list and a shared list. A trusted caller executes preparation and commits it. The personal list is deleted and the shared list is transferred. The subsequent Auth Admin request fails or never happens. A's Auth identity and sessions remain active, but preparation has already changed or destroyed application data. The function has no durable deletion-attempt record or saved result identifying the completed stage.

A may also create a new owned list after preparation commits. An existing owner can transfer another list to A while A is still a member, or a future invitation flow can add A to a new list. List-row locks do not prevent those future relationships. Final Auth deletion can then fail on the restrictive ownership FK or remove newly created memberships by cascade outside the coordinated removal RPC.

**Impact:** The approved all-or-nothing user experience is not implemented. Failed or retried deletion can leave an active account with already altered data, an uncertain workflow stage, or new relationships not covered by preparation.

**Expected behavior:** Authenticate the departing user, fence that account against new application activity and new ownership/membership relationships, serialize deletion attempts, and define durable progression and recovery through final identity deletion.

**Minimal safe fix:** Keep deletion unavailable to clients. Select an explicit lifecycle architecture. Introduce a durable account deletion state/attempt and ensure creation, invitation acceptance, transfers to that account, and mutations honor the fence under a common protocol. Use either a reviewed single database transaction boundary compatible with the Auth lifecycle or a recoverable orchestration with documented partial-failure semantics. An external Auth Admin HTTP call cannot be made atomic merely by calling this SQL function first.

The 006 FK remains valuable fail-closed protection: it prevents silent cascading destruction of still-owned lists. It does not undo a preparation transaction that was already committed.

### H-02 — Administrative deletion relies on an incompletely specified EXECUTE boundary

**Severity:** High if a user-controlled or insufficiently authorized privileged caller can execute it; otherwise a blocking unverified administrative boundary.  
**Classification:** Code-confirmed absence of in-function caller authorization; environment-dependent exposure.  
**Reproducibility:** Requires actual function ACL and backend-route inspection; not executed.

**Locations:**

- [010_prepare_account_deletion.sql:6–17,50–53](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/010_prepare_account_deletion.sql#L6)
- [011_account_deletion_locking.sql:4–13,50–54](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/011_account_deletion_locking.sql#L4)

**Scenario:** A role receives EXECUTE through a Supabase default grant, another granted role, or an administrative API route. It invokes prepare_account_deletion with another user's UUID. The function does not compare p_user to a verified actor or verify a protected administrative context. Under the intended powerful definer, it can delete personal lists, transfer shared lists, and remove memberships for that user.

The explicit revocations cover PUBLIC, anon, and authenticated. They do not revoke a separately existing service_role grant or grants inherited through other roles. CREATE OR REPLACE in 011 does not inherently reset the existing function owner or all existing permissions.

**Impact:** Exposure of this boundary can enable destructive cross-account operations. The service-role key remaining on a server is necessary but insufficient if that server exposes an arbitrary p_user operation without binding it to an authorized workflow.

**Expected behavior:** Only a dedicated trusted administrative execution identity and an authenticated, authorized deletion workflow can invoke preparation for the intended account.

**Minimal safe fix:** Enumerate actual EXECUTE rights, including service_role and inheritance; revoke all unintended grants and configure defaults. Explicitly grant only a dedicated backend execution role if needed. Bind p_user to the authenticated deletion request in the backend, enforce the deletion fence, and audit attempts. Validate that no PostgREST or generic privileged route exposes arbitrary-user execution.

**Boundary qualification:** The source does not establish that anon or authenticated can currently call this function. A standard service_role is intentionally powerful; this finding concerns an unverified reachability boundary, not a claim that RLS protects against service-role compromise.

### H-03 — Cached membership remains usable inside an old REPEATABLE READ snapshot

**Severity:** High if long-lived REPEATABLE READ sessions are supported; otherwise a deployment/isolation restriction that must be enforced.  
**Classification:** Code-level snapshot counterexample, conditional on transaction mode.  
**Reproducibility:** Proposed two-session test; not executed.

**Locations:**

- [006_membership_safety.sql:24–31](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/006_membership_safety.sql#L24)
- [007_pull_authorization_lock.sql:19–30,36–38](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/007_pull_authorization_lock.sql#L19)
- [004_apply_item_change.sql:25–30](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L25)
- [001_initial_schema.sql:38–47](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/001_initial_schema.sql#L38)

**Scenario:**

1. B starts REPEATABLE READ while a member and establishes a snapshot with an ordinary read, without retaining a list row lock.
2. A calls remove_list_member and commits. This deletes the membership but does not update the list row.
3. B calls pull or item mutation in the original transaction. Acquiring a lock on the unchanged list row need not force a serialization failure. The authorization helper can still see B's membership in the old transaction snapshot.

**Impact:** The list lock alone does not make old snapshots see a committed revocation. This can permit access or a new mutation initiated after revocation inside the old transaction.

**Expected behavior:** A precise supported transaction/isolation contract, with fail-closed behavior for unsupported old snapshots.

**Minimal safe fix:** If the supported API model is one READ COMMITTED transaction per request, enforce and test that restriction and reject unsupported isolation in these RPCs as appropriate. If long transactions must be supported, update a protected list authorization epoch/version on access changes and design locking/serialization so old-snapshot access fails or retries. Include direct table reads in the isolation threat model; they also follow MVCC snapshots.

This is different from ordinary cached-JWT behavior. A new READ COMMITTED request after revocation should consult current membership and fail even if its JWT has not expired.

### M-01 — Final ownership security depends on a complete ACL contract that is not encoded

**Severity:** Medium; required before any API exposure.  
**Classification:** Code-confirmed ACL coverage gap and runtime configuration risk.  
**Reproducibility:** Catalog and role tests required; not executed.

**Locations:**

- [003_sync_tables.sql:29–32](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/003_sync_tables.sql#L29)
- [006_membership_safety.sql:12–13](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/006_membership_safety.sql#L12)
- [008_ownership_infrastructure.sql:31–51](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/008_ownership_infrastructure.sql#L31)
- [009_transfer_ownership.sql:5–10](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/009_transfer_ownership.sql#L5)

**Scenario:** An installation has an UPDATE(owner_id) column grant to PUBLIC or an inherited role. 009 revokes table UPDATE from PUBLIC/anon/authenticated, but its column-specific revocation covers only anon/authenticated. Separately granted column rights are not removed by revoking table-level UPDATE.

After 009 there is no immutable-owner trigger. An existing owner with remaining UPDATE(owner_id) rights may be able to change ownership directly under the existing owner-based UPDATE policy, bypassing current-member eligibility, former-owner membership insertion, audit, and notification.

**Impact:** Privileged workflows can be bypassed if external grants differ from the assumed defaults. Conversely, legitimate creation and reads depend on grants not fully issued by these migrations.

**Expected behavior:** An explicit, reproducible permission model for schema USAGE/CREATE, tables, columns, routines, sequences, default privileges, and role inheritance.

**Minimal safe fix:** Revoke unintended table and column permissions from PUBLIC and all applicable roles; inspect inherited permissions. Pin trusted function/table owners and verify RLS behavior. Explicitly provide only required client grants. Treat public-schema CREATE and routine defaults as part of the review.

006 has now closed the previously reported omission of TRUNCATE list_members. Do not repeat that old finding as an unresolved omission. All final TRUNCATE rights still require actual testing because RLS does not govern TRUNCATE.

No SQL injection through the reviewed fixed search_path and schema-qualified application references was established. PUBLIC EXECUTE on trigger-only helpers is not, by itself, a callable arbitrary-mutation API; still normalize their ACLs.

### M-02 — List creation accepts client-controlled initial revision and timestamps

**Severity:** Medium.  
**Classification:** Code-confirmed validation gap, conditional on the intended client INSERT permission.  
**Reproducibility:** Proposed insertion/RPC test; not executed.

**Locations:**

- [001_initial_schema.sql:5–11,77–78](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/001_initial_schema.sql#L5)
- [003_sync_tables.sql:4,32](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/003_sync_tables.sql#L4)
- [004_apply_item_change.sql:70–71](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L70)

**Scenario:** A creates a valid self-owned list with revision 9223372036854775807. The next item RPC fails when incrementing bigint. Any nonzero starting revision also creates a history boundary without corresponding events. INSERT can supply created_at and updated_at as well.

**Impact:** A list can be made unusable or violate server-cursor assumptions. This does not demonstrate access to another user's list.

**Expected behavior:** Creation assigns the initial revision and server-owned metadata.

**Minimal safe fix:** Use a controlled creation operation, or restrict insertable columns and enforce initial revision zero on INSERT. Do not add a permanent table CHECK revision = 0, which would prohibit later increments.

### M-03 — Snapshot, retention, terminal deletion, and ownership-sync contracts remain incomplete

**Severity:** Medium; production integration blocker.  
**Classification:** Missing functionality.  
**Reproducibility:** Proposed reconstruction and lifecycle tests; not executed.

**Locations:**

- [007_pull_authorization_lock.sql:25–38](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/007_pull_authorization_lock.sql#L25)
- [004_apply_item_change.sql:72–76](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L72)
- [009_transfer_ownership.sql:33–42](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/009_transfer_ownership.sql#L33)
- [011_account_deletion_locking.sql:28–44](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/011_account_deletion_locking.sql#L28)

**Scenarios and impact:**

- Rows present before the change-log migration have no backfilled events; pull from revision zero alone cannot reconstruct them.
- A future retention job can remove necessary history, but there is no minimum-retained revision, cursor-too-old response, or revision-bound full snapshot.
- Ownership transfer and membership changes do not increment the item-change revision or emit metadata events in that feed. An unchanged item cursor does not prove that a client's owner/member controls are current.
- Deletion of a personal list cascades its history, and an inaccessible/deleted list receives a generic error. Terminal handling and pending-operation cleanup are not defined.
- Event snapshots omit created_at and other full-row fields. A client cannot assume they are a complete serialization of shopping_items.

**Expected behavior:** A documented full-state/metadata refresh and consistent snapshot-plus-feed protocol, including lost access and deleted lists.

**Minimal safe fix:** Specify a full snapshot with a revision boundary and complete required fields, retention floor and recovery responses, future-cursor handling, and a metadata refresh/version mechanism. Define inaccessible-list behavior without leaking whether an unrelated list exists. Update client permissions from authoritative metadata on sync.

There is no retention job in this source, so current event deletion by retention is not claimed. With all events retained and all item writes going through 004, ordered revision pagination is a sound basis. It does not by itself provide a complete initial snapshot or ownership synchronization.

### M-04 — Ownership transfer has no durable retry or stale-command identity

**Severity:** Medium.  
**Classification:** Missing operation-level idempotency for a sensitive workflow.  
**Reproducibility:** Proposed lost-response/transfer-back test; not executed.

**Location:** [009_transfer_ownership.sql:12–46](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/009_transfer_ownership.sql#L12).

**Scenario:** A transfers to B, but loses the response. A's immediate retry fails because A is no longer owner, leaving the client unable to distinguish success from another failure through a durable operation result. If B transfers back to A before that retry arrives, the old A-to-B request is again authorized and can perform an unintended new transfer and notification.

**Impact:** An old retry can become a new sensitive operation after intervening valid changes. This is not an outsider privilege escalation.

**Expected behavior:** Retries identify the original operation, while a new deliberate transfer is a distinct operation bound to the current ownership generation.

**Minimal safe fix:** Add actor/operation identity with a durable result and payload comparison, plus an ownership-version precondition. Serialize these checks under the existing list lock. Preserve the approved behavior of immediate transfers and no recipient consent.

### M-05 — Multi-resource locking and Auth cascades have no verified transaction-wide protocol

**Severity:** Medium.  
**Classification:** Runtime concurrency risk and missing orchestration specification, not a proven deadlock in two ordinary 011 calls.  
**Reproducibility:** Concurrent session and lock-graph tests required; not executed.

**Locations:**

- [011_account_deletion_locking.sql:16–44](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/011_account_deletion_locking.sql#L16)
- [009_transfer_ownership.sql:21–42](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/009_transfer_ownership.sql#L21)
- [001_initial_schema.sql:15–16](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/001_initial_schema.sql#L15)
- [ACCOUNT_DELETION_IMPLEMENTATION.md:8–22](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/ACCOUNT_DELETION_IMPLEMENTATION.md#L8)

**Risk scenarios:** A larger transaction already holds a later list lock before invoking a sorted multi-list workflow; or backend account locks and foreign-key locks on successor Auth rows are acquired in a different order. Actual Auth-user deletion also cascades member rows without calling remove_list_member. An owner RESTRICT FK does not force a member-only account through preparation.

**Impact:** Deadlocks, retry failures, or access changes outside the coordinated list-lock protocol. Arbitrary membership insertion during preparation remains unhandled.

**Expected behavior:** One transaction-wide protocol covering account fences, all list locks, membership writes, successor references, and final identity deletion.

**Minimal safe fix:** Define ordering and transaction boundaries for every participating workflow, not only the SELECT in 011. Use bounded whole-transaction retry for SQLSTATE 40P01 and 40001, with idempotent external orchestration. Make membership creation honor both the list lock and the account lifecycle fence.

**Important qualification:** ORDER BY immutable list UUID followed by FOR UPDATE is a reasonable list-lock ordering approach. No code-confirmed planner-induced reversal of two clean 011 operations was established. The open issue is the complete lock graph and unimplemented workflows, not an assertion that ORDER BY is ignored.

### M-06 — Ownership-event identity retention conflicts with an unspecified deletion policy

**Severity:** Medium.  
**Classification:** Missing data-lifecycle policy explicitly required by the product rules.  
**Reproducibility:** Code inspection establishes retained fields; policy and runtime deletion behavior remain untested.

**Locations:**

- [008_ownership_infrastructure.sql:5–20,24–29](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/008_ownership_infrastructure.sql#L5)
- [009_transfer_ownership.sql:38–42](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/009_transfer_ownership.sql#L38)
- [OWNERSHIP_TRANSFER_RULES.md:28](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/OWNERSHIP_TRANSFER_RULES.md#L28)

**Scenario:** An account is deleted, while ownership_events retains old_owner/new_owner UUIDs and voluntary-transfer notifications for another user retain previous_owner in JSON. These references do not cascade with the former account.

**Impact:** The system retains identifiable relationship history without an agreed retention or pseudonymization contract. Conversely, adding broad cascades later could destroy the audit history the product requires.

**Expected behavior:** Deliberate minimum retention and authorized access for historical audit data, covering both structured columns and notification JSON.

**Minimal safe fix:** Select and document retention/pseudonymization rules, implement them under a privileged lifecycle operation, and test surviving audit/notification records after account and list deletion. Client write revocations make events client-immutable; they do not constitute tamper-evident protection against privileged administrators.

### M-07 — The existing item RPC is not a Siri add-only authorization boundary

**Severity:** Medium; blocks Siri integration, not evidence of an existing insecure Siri endpoint.  
**Classification:** Missing functionality.

**Locations:**

- [004_apply_item_change.sql:12,41–67,84–85](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L41)
- [SYNC_PROTOCOL_V02.md:32](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/SYNC_PROTOCOL_V02.md#L32)

**Scenario:** A future Shortcut is given a normal user's token and calls apply_item_change directly. That token can authorize update/delete and other user-permitted calls, not just addition to one bound list.

**Impact:** Credential copying grants broader rights than the intended Siri capability.

**Expected behavior:** Separate revocable, list-bound, add-only credential and a minimal endpoint.

**Minimal safe fix:** Implement a dedicated endpoint that verifies credential binding, expiry/revocation, current membership, fixed action, rate limits, and idempotency. Do not provide a service-role key or unrestricted user access token to Shortcuts. No unsafe implemented Siri endpoint was found in the reviewed SQL.

### L-01 — Item operation collision and conflict errors lack a stable API contract

**Severity:** Low.  
**Classification:** Error-contract gap; atomic rollback is preserved by the code structure.  
**Reproducibility:** Proposed concurrent test; not executed.

**Locations:** [003_sync_tables.sql:14](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/003_sync_tables.sql#L14), [004_apply_item_change.sql:32–39,52–53,79–80](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L32).

**Scenario:** One actor concurrently uses one operation UUID for different lists. Their list locks do not serialize the shared operation key. One transaction can fail with 23505 rather than the explicit payload-mismatch error. Version conflicts use a general exception without structured current-state information.

**Impact:** Clients can misclassify permanent conflicts as transient failures and retry indefinitely.

**Expected behavior:** Stable distinguishable permanent conflict responses and documented retry rules.

**Minimal safe fix:** Serialize by actor/operation or handle the unique-key race safely; define structured error codes and conflict payloads without leaking unauthorized data.

Different lists mean different payloads. The losing request should be rejected, not return the other list's successful result. Its item/revision changes roll back on the exception; this is not an established duplicate-write vulnerability.

MD5 is not used as an authorization signature here. Prefer exact canonical-payload comparison or a modern digest for the strict payload-mismatch guarantee; no practical valid-payload collision was demonstrated.

### L-02 — NULL action bypasses the intended validation branch

**Severity:** Low.  
**Classification:** Code-confirmed input-validation defect.  
**Reproducibility:** Proposed RPC call; not executed.

**Location:** [004_apply_item_change.sql:22–24,41–73](https://github.com/MusicMeasurer/shopping-app/blob/9caad76f501df561fabab4a54b0391eb12e9d699/cloud/drafts/004_apply_item_change.sql#L22).

**Scenario:** p_action is NULL. NULL NOT IN (...) is NULL, so the intended Unsupported action exception is not raised. With suitable remaining arguments the function enters its delete branch.

**Impact:** Incorrect and unnecessarily late failure. In the current schema the eventual NULL change kind violates NOT NULL and should roll back the entire call. A successful unlogged deletion is not established.

**Expected behavior:** Immediate invalid-action rejection.

**Minimal safe fix:** Check p_action IS NULL explicitly before NOT IN.

## 4. Final authorization and privilege boundaries

### 4.1 Expected final role behavior — not test results

| Surface | Expected authenticated behavior | Final protection / caveat |
|---|---|---|
| shopping_lists SELECT | Owner/current member only | RLS helper; requires suitable helper owner and SELECT/schema grants |
| shopping_lists INSERT | Self-owned active list | INSERT policy; revision/metadata issue M-02 remains |
| shopping_lists UPDATE/DELETE/TRUNCATE | Denied directly | 003/009 revocations; verify column/inherited grants |
| shopping_items SELECT | Active items in accessible lists | 002 SELECT policy |
| shopping_items direct writes/TRUNCATE | Denied | 003 revocations; immutable identity trigger also exists |
| list_members SELECT | Accessible-list members | Initial read policy |
| list_members direct INSERT/UPDATE | Denied | 002 revoke and no insertion/update policy |
| list_members direct DELETE/TRUNCATE | Denied | 006 policy removal and revocations |
| item_operations/list_changes direct SELECT | No client rows via ordinary RLS | RLS enabled, no client SELECT policy; actual table grants still need review |
| item_operations/list_changes writes | Denied | 003 revocations |
| ownership_events client access | No ordinary client read/write | RLS has no client read policy; writes revoked |
| user_notifications SELECT | Own recipient only | 008 recipient policy; actual SELECT grant required |
| user_notifications direct writes | Denied | 008 revocations; no read_at-update workflow exists |
| apply_item_change | Accessible list only | UID, list lock, membership, version, operation log |
| pull_item_changes | Accessible list only | Final 007 lock and authorization |
| remove_list_member | Owner removes member, or self leaves | 006 list lock and actor check |
| transfer_list_ownership | Current owner to current member | 009 list lock and actor check |
| prepare_account_deletion | No public/client execution | Administrative ACL boundary must be verified, H-02 |

Anonymous has no intended data access. Helper EXECUTE may still exist through direct default grants even after PUBLIC revocation, but a missing auth.uid() makes the boolean helpers return false; no disclosure through these helpers was established. Revoke unnecessary grants anyway.

### 4.2 SECURITY DEFINER considerations

Fixed search_path and qualified application references are positive. They do not determine function ownership or permissions. Verify proowner, prosecdef, proconfig, proacl, table owners, RLS flags, default privileges, and inherited roles after the exact chain.

The helpers intentionally need a trusted path around recursive RLS. Adding FORCE ROW LEVEL SECURITY without redesigning that path can break it. Do not infer that SECURITY DEFINER automatically bypasses RLS for an arbitrary owner.

auth.uid() resolves trusted request context; it does not validate JWT signatures inside PostgreSQL and does not prove a session remains active. A direct SQL test that sets JWT GUCs simulates identity; it does not test authentication. Arbitrary SQL access as a request role must not be confused with a safe external-authentication interface.

service_role is a trusted administrative capability, not an RLS-limited client. RLS bypass does not disable normal triggers. Direct service-role DML can bypass operation logs unless the backend deliberately uses controlled workflows.

### 4.3 Membership and ownership conclusions

Under the intended READ COMMITTED, one-operation-per-request model and complete ACLs, 004, 006, 007, and 009 use conflicting locks on the same list row. A member removal should wait for an earlier item/pull operation, and a later operation should see the removal. A voluntary transfer validates current ownership under the row lock and current membership of the recipient.

009 atomically removes the new owner's member row, changes owner_id, inserts the former owner as a member, appends a voluntary audit event, and notifies only the new owner. It correctly does not require recipient acceptance. An exception rolls back those database effects together.

011 selects successors by joined_at then user_id and does not add the departing account as a member. It removes that account from each selected list while holding the list lock. These are real improvements over 010.

The invariant that an owner is not also a member is maintained by these reviewed routines given a valid initial state. It is not a general cross-table constraint enforced against arbitrary trusted SQL. Administrative fixtures and future invitation code must maintain it.

No safe invitation/add-member RPC exists. Current client creation is closed rather than insecurely implemented. A future implementation must check recipient and invitation lifecycle, acquire the list lock, and respect account deletion fences. Its concurrency safety cannot be approved in advance.

## 5. Revoked members and cached JWTs

For a **new READ COMMITTED request after committed removal**, a still-valid cached JWT should not preserve access: membership is looked up in database state. A JWT does not contain an irrevocable database membership grant.

007 and 006 should now serialize in-flight reads/removals when all writers participate. Do not report the superseded 005 race as the final implementation's READ COMMITTED behavior.

Exceptions and limits:

- Old REPEATABLE READ snapshots are covered by H-03.
- Auth-user deletion cascades and privileged membership writes require the same lifecycle protocol.
- Ending an Auth session or revoking a refresh token is not the same as invalidating every already-issued access JWT. The SQL does not check a session registry.
- An offline downloaded copy cannot be remotely erased while the device is offline.
- A former owner becomes a member after voluntary transfer and is expected to retain ordinary item access; owner-only RPCs must reject them immediately.
- A membership change that is not visible through a client's item cursor still requires authoritative permission refresh.

## 6. Item mutation and synchronization correctness

Positive properties visible in the final sequence:

1. The actor comes from auth.uid(), not a request actor field.
2. Item/list IDs and operation ID are required.
3. List locking precedes item selection and mutation.
4. Updates/deletions require exact expected version.
5. Item ID, list ID, and created_at are immutable under the trigger.
6. RPC does not accept item timestamps.
7. Item change, version/revision increase, change event, and saved operation result share the calling transaction.
8. Identical same-list retries reach the saved result before reapplying a mutation.
9. Deleted items are hidden from ordinary reads; authorized pull returns deletion snapshots.
10. Per-list revision ordering avoids timestamp-cursor errors.

Qualifications:

- Atomicity is only within the database transaction. Network delivery, Auth deletion, and future external services are not included automatically.
- A no-op update still increments version/revision; this is not inherently incorrect, but should be documented.
- A deleted item cannot be updated or restored through this RPC. A new operation trying to reuse its ID fails; the original successful operation can still be deduplicated while the operation log is retained and authorization remains valid.
- Operation results are scoped by actor and UUID. Exact same-list retries are the supported success case; different-list UUID reuse is an altered payload.
- Event retention and idempotency retention must be coordinated with how long devices may retry.
- Snapshot/page metadata, initial state, and terminal lost-access behavior are incomplete, as in M-03.
- The local IndexedDB migration, transactional pending queue, account isolation, and merge preview remain design requirements, not implemented SQL features. This audit did not execute client migration tests.

## 7. Reproducible isolated verification plan — NOT EXECUTED

### 7.1 Environment and evidence capture

Use a disposable Supabase project/local stack with the production-target PostgreSQL version. Disable its external application API during migration. Create real test Auth users A (owner), B (member), C (outsider), and an anonymous API client. For tie-break and multi-list tests, add another controlled member.

Apply unmodified 001–011 in order with stop-on-error. Record:

- PostgreSQL and Supabase/PostgREST versions;
- migration role and exact SQLSTATE/message at any failure;
- pg_namespace ACLs, pg_default_acl, table ACLs and column ACLs;
- table owners and relrowsecurity/relforcerowsecurity;
- routine identities, proowner, prosecdef, proconfig, and proacl;
- role membership/inheritance and sequence rights;
- actual has_function_privilege/has_table_privilege/has_column_privilege outcomes.

The report-only commit must not be treated as evidence that this deployment happened.

SQL catalog diagnostics can be run by the test administrator. For example:

```sql
SELECT n.nspname, p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY p.proname, identity_arguments;

SELECT
  has_function_privilege(
    'anon', 'public.prepare_account_deletion(uuid)', 'EXECUTE'
  ) AS anon_execute,
  has_function_privilege(
    'authenticated', 'public.prepare_account_deletion(uuid)', 'EXECUTE'
  ) AS authenticated_execute,
  has_function_privilege(
    'service_role', 'public.prepare_account_deletion(uuid)', 'EXECUTE'
  ) AS service_role_execute;
```

These diagnostics are proposed, not executed.

### 7.2 Permission and API matrix

Run both direct SQL role simulations and real Auth/PostgREST requests. In SQL simulations, set transaction-local role and request claims for each user and clear them between tests. Verify that the simulation's auth.uid() matches the fixture. SQL GUC simulation does not validate JWT signatures.

| Test | Required assertion |
|---|---|
| A/B/C/anonymous SELECT | Only authorized data is returned, including nested API queries |
| Every routine by every role | Expected success/denial; enumerate helper and administrative routines too |
| Direct item/list/member/log/event/notification DML | Only documented surfaces work; no bypass through upsert or column grants |
| TRUNCATE every public table | Denied to client roles, especially list_members after 006 |
| Schema CREATE and routine defaults | No unreviewed application-object creation or EXECUTE path |
| Ownership column via table/column grants | No direct reassignment; 009 workflow cannot be bypassed |
| Wrong or missing actor | No private data or destructive behavior |
| Privileged administrative route | No user-controlled target UUID without backend authorization |
| service_role without user sub | Record real behavior; administrative permission alone must not masquerade as user authorization |

Perform TRUNCATE tests only in the disposable fixture and restore/reset between cases.

### 7.3 Item transaction tests

- Exact retries for add, update, and delete after successful commit/lost response: one event, one revision increment, same result.
- Altered payload with same actor/operation: permanent rejection and no new changes.
- Same actor/operation concurrently on different lists: one success, one documented permanent failure; no partial loser mutation.
- Two users updating the same expected version: one succeeds; the other cannot overwrite the new value.
- Wrong-list item UUID, tombstone update, and item-ID reuse: no move/restore/cross-list modification.
- NULL action, NULL identifiers, invalid names, null/out-of-range page settings: expected errors and unchanged state.
- Force an error at the operation-log insert: item, revision, and event changes roll back.
- Attempt to change item identity/created_at directly: denied/trigger-rejected as appropriate.
- Attempt self-owned list insertion with maximum bigint revision: demonstrate M-02, then verify rejection after a future fix.

### 7.4 Membership and pull concurrency

Use separate database connections, explicit BEGIN/COMMIT/ROLLBACK, and inspect wait events/locks. Do not rely solely on sleeps.

**READ COMMITTED baseline:**

1. B calls an item RPC in a transaction and keeps it open.
2. A calls remove_list_member in another transaction.
3. A should wait until B completes; afterwards a new B mutation must fail.
4. Repeat with B pull holding FOR SHARE, B leaving voluntarily, rollback, and transfer.
5. Attempt direct member DELETE/TRUNCATE; it must not bypass the RPC.

**REPEATABLE READ counterexample for H-03:**

1. B starts BEGIN ISOLATION LEVEL REPEATABLE READ and establishes a snapshot with an ordinary authorized list read, not a locking RPC.
2. A removes B through the RPC and commits.
3. B, in the old transaction, calls pull and an add-item mutation.
4. Record returned rows, errors, commit outcome, and whether the old membership was used.
5. After a future fix, require documented rejection/serialization or enforce the supported READ COMMITTED request model.

### 7.5 Ownership transfer

- A transfers to B; verify owner B, member A, no member row for B, one event, notification only to B.
- Transfer back repeatedly; no recipient acceptance or waiting period is required.
- B/C attempt to transfer a list they do not own; no changes.
- A selects a nonmember or self; no transfer.
- Race recipient removal against transfer: serialized outcome, never an invalid owner.
- Inject failure during membership/event/notification writes: all earlier effects roll back.
- Lose the response, transfer back, replay the old request: characterize M-04.
- Verify former-owner owner-only calls fail and metadata refresh updates the client.

### 7.6 Account preparation, deletion, and recovery

- Before preparation, direct Auth deletion of an owner must fail due to RESTRICT, preserving all owned data.
- Also test direct deletion of a member-only user: RESTRICT on owned lists does not require that account to pass through preparation.
- No successor: personal list is deleted by preparation.
- One successor: transfer exactly once, no departing-user member row, one event/notification.
- Multiple successors: earliest joined_at wins; equal timestamps use user_id ascending.
- Non-owned memberships: removal is coordinated with list operations.
- Inject a failure halfway through multiple lists: no partial committed preparation.
- Race preparation with voluntary transfer/removal, two same-user preparations, and two accounts with overlapping lists.
- Simulate Auth Admin failure after committed preparation and restart the backend: demonstrate what can and cannot recover.
- Attempt new list creation, new transfer to the departing account, and future invitation acceptance during/after preparation.
- Record deadlocks and serialization failures; verify bounded whole-workflow retry and durable progress.
- Verify historical audit/notification identity treatment after final deletion.

A failure injected inside the one SQL call should roll back its database effects. A failed HTTP identity deletion after a committed call cannot do so automatically. Keep those tests separate.

### 7.7 Synchronization and integration

- More than 500 events with page sizes 1/100/500, concurrent writes, and max-returned-revision cursor advancement: no skipped item events.
- Initial rows predating the log: identify required snapshot/backfill behavior.
- Simulated retention gap, future cursor, list deletion, revoked access: explicit recovery and bounded retry.
- Ownership change with no item mutation: client must still refresh authoritative permissions.
- Actual iPhone Siri endpoint once implemented: only add to the bound list; no read/update/delete or arbitrary actor/list.
- IndexedDB upgrade and account switching once implemented: preserved item UUIDs, stable fixed-list mapping, atomic queue, isolated guest/account data, no stale response mixing.

## 8. Previous findings: final-sequence disposition

| Earlier issue | Current static disposition |
|---|---|
| Owner deletion cascades shared lists | Fixed fail-closed by 006 RESTRICT; final product lifecycle still H-01 |
| Direct member DELETE bypasses locks | Closed by 006 if actual ACLs match |
| Missing TRUNCATE list_members revocation | Added in 006; verify actual rights |
| Pull's separate authorization/read race under READ COMMITTED | Addressed by 007 when all relevant writers follow the lock protocol |
| Direct item writes, mutable item identity | Addressed by 003 subject to full ACL verification |
| Item versions, operation ledger, tombstones absent | Implemented in 003/004; not runtime verified |
| Voluntary ownership transfer absent | Implemented by 009 with remaining retry/ACL concerns |
| Uncoordinated 010 departure cleanup | Superseded by 011 for selected list rows |
| Safe invitation workflow | Still absent; currently closed to direct client insertion |
| Snapshot/retention and initial revision validation | Still open |
| Siri credential/endpoint | Still absent |
| Account identity deletion and recovery | Still absent |

## 9. Final readiness decision

**Isolated test database: YES, with conditions.** This source is suitable for controlled execution, inspection, and negative tests in an expendable environment. Apply all migrations with API access disabled, record actual owners/ACLs, and test the final definitions. This is permission to investigate a prototype, not acceptance of its security.

**Production: NO.** Resolve the account deletion lifecycle and administrative boundary, explicitly support/enforce transaction isolation, close the ACL contract, and implement synchronization recovery before production integration. Ownership transfer and account preparation require practical concurrent-session tests. No SQL or application changes were made by this audit; only this report is committed at the user's request.

**Runtime verification: NOT PERFORMED.** No deployment, passing security test, successful migration execution, or production readiness is claimed.
