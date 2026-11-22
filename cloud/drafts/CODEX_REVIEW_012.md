# Independent review of migration 012: list creation guard

- Repository: MusicMeasurer/shopping-app
- Branch: feature/cloud-schema-draft
- Reviewed HEAD: **ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8**
- Review date: 2026-10-30
- Reviewed change: [012_list_creation_guard.sql](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/012_list_creation_guard.sql), blob 927d29d83a179f3bd624ca05705353df8da239af
- Baseline report: [CODEX_AUDIT_REPORT_011.md](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/CODEX_AUDIT_REPORT_011.md), blob 2ee0829fda6fdf521d23a1b5d39cd9fad95e3cf1
- Change scope: this review document only is saved and committed. No SQL, application source, other documentation, or main is changed.

## 1. Verdict and method

**The new trigger correctly addresses the baseline M-02 insertion-value problem by static inspection:** a newly inserted list must have revision zero and both timestamps equal to the PostgreSQL transaction start time. It does not impose a permanent revision-zero constraint, so later RPC increments remain possible.

**It also closes the specific direct PUBLIC UPDATE(owner_id) column-grant omission identified in baseline M-01.** It does not establish a complete privilege or role-inheritance contract.

**Ordinary raw SQL creation that omits the guarded columns is compatible with the trigger. However, complete list-creation compatibility is not yet established:** this review identifies a pre-existing RLS problem with INSERT ... RETURNING and creation APIs that request a representation. That problem is in migration 001 and is neither introduced nor fixed by 012.

**The three previous High findings H-01, H-02, and H-03 remain unresolved. Migration 012 does not make the project production-ready.**

- Ready for an isolated disposable test database: **YES**, with all migrations 001–012 applied while API access is disabled, and with the tests below treated as required investigation.
- Ready for production: **NO**.
- Runtime verification: **NOT PERFORMED**. No SQL was executed, no database was provisioned, and no production service was accessed.

This is a static source and privilege-boundary review. All eleven preceding migrations and the actual saved baseline report were fetched from the reviewed HEAD. Comparison against the baseline report commit 57be1079173dace997c6069cda65c67e66aa89e7 showed that the only intervening repository change was the addition of migration 012. Source inspection and comparison are evidence; proposed database results below are not reported as executed tests.

Severity distinctions:

- No new Critical or High vulnerability was established in 012.
- One additional **Medium** compatibility defect was identified in the inherited creation path.
- Limitations, privileged bypass conditions, and unchanged baseline findings are described separately, rather than relabeled as new defects in the trigger.

## 2. What 012 actually changes

### 2.1 Initial list revision

**Location:** [012:7–16,27–29](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/012_list_creation_guard.sql#L7).

The BEFORE INSERT, FOR EACH ROW trigger checks:

```sql
new.revision IS DISTINCT FROM 0
```

This is appropriate for the requested insertion invariant:

- Omitted revision receives the default zero from [003:4](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/003_sync_tables.sql#L4) and passes.
- Explicit zero passes.
- Positive, negative, maximum-bigint, and NULL values are rejected.
- Values that cannot be converted to bigint may fail type conversion before reaching the trigger; this is not a bypass.
- Using IS DISTINCT FROM avoids SQL NULL three-valued-logic mistakes.
- Rejection uses explicit SQLSTATE 22023.
- All rows in a multi-row insert are checked; an error aborts the statement rather than accepting a bad row.

This closes the earlier path where a new list could start at maximum bigint and make the next revision increment overflow. It also prevents a client from choosing a nonzero initial history position.

This is the list's **revision**, not the shopping item's **version**. The item version default of one in 003 is unchanged.

### 2.2 Initial timestamps

**Location:** [012:17–23](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/012_list_creation_guard.sql#L17).

Both created_at and updated_at must equal transaction_timestamp(). The defaults in [001:9–10](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/001_initial_schema.sql#L9) are now(), which is the same transaction-start timestamp in PostgreSQL.

Consequently:

- Omitting both timestamp columns is compatible with the check.
- Supplying DEFAULT is compatible when the caller has the required column privileges.
- Arbitrary historical/future timestamps, infinity values, and NULL are rejected.
- Both dates must be correct independently; setting only one to a forged value is rejected.
- A timestamp with another timezone spelling but the same timestamptz instant is equivalent and may pass. That is not an incorrect timestamp.
- Client clock values are not a suitable input. Date.now(), millisecond serialization, clock skew, and request delay do not reliably match the exact server transaction timestamp.
- statement_timestamp() or clock_timestamp() is not an interchangeable contract: either could coincide in a particular call, but can differ and therefore be rejected.

**Important precision:** the trigger enforces the resulting values, not the provenance of the SQL expressions. A SQL caller can explicitly supply now() or transaction_timestamp(), and those values pass. This is not a bypass of the stored-value invariant: the stored dates are still the required server transaction time. The error message “must be server-generated” should not be read as proof that the client omitted those columns.

A long transaction has an older transaction_timestamp() than the wall clock at its later INSERT. The existing now() defaults already have that behavior. This migration enforces transaction-start semantics; it does not enforce statement time or commit time.

If a future requirement is to disallow any explicit client metadata column, including an exactly matching value, enforce column-level INSERT rights or use a controlled creation RPC. A row trigger comparing values cannot distinguish all equivalent input expressions.

### 2.3 Owner column revocation

**Location:** [012:31–32](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/012_list_creation_guard.sql#L31).

The new REVOKE UPDATE(owner_id) covers PUBLIC as well as anon and authenticated. This addresses the specific PUBLIC column-grant example in the prior report, which was not covered by [009:9–10](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/009_transfer_ownership.sql#L9).

Qualifications:

- A separate inherited-role grant can still confer the right.
- A table-level UPDATE grant also authorizes column updates; revoking a column grant does not override an independent table-level grant.
- Under the intended unchanged chain, table-level client UPDATE has already been revoked by 003/009.
- Other columns, schema permissions, function ownership, and default privileges are not comprehensively defined by 012.
- The revocation is for UPDATE, not INSERT, and therefore does not remove the ability to supply owner_id when creating one's own list.
- It does not revoke the trusted definer's rights to perform approved ownership transfers.

The correct status for baseline M-01 is therefore **partially improved, not closed**.

## 3. Compatibility with 001–011 and normal creation

### 3.1 Minimal creation path

A raw SQL statement of this form should pass the new metadata guard:

```sql
INSERT INTO public.shopping_lists (owner_id, name)
VALUES (auth.uid(), 'New list');
```

It also needs the existing role/schema/table privileges and the insertion policy. With the intended RLS context:

- owner_id must match the authenticated UID;
- deleted_at must be NULL;
- name must pass the existing nonblank/length constraint;
- the Auth-user FK must be valid.

The metadata trigger is not authorization and does not replace any of those checks. It does not turn an anonymous or wrong-owner insert into an authorized one.

The client may still provide a stable new UUID for id. Leaving id to its default also remains valid at the trigger level. An insertion without RETURNING followed by a separate read can see the now-existing row, subject to the actual grants.

**Do not generalize this to every PostgREST request:** actual minimal-return and representation-return API paths must be tested separately. The RLS issue in section 4 affects representation-return creation.

### 3.2 Existing RPC updates are not blocked by the insertion guard

**Relevant locations:**

- [004_apply_item_change.sql:70–71](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/004_apply_item_change.sql#L70)
- [001_initial_schema.sql:63–67](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/001_initial_schema.sql#L63)
- [009_transfer_ownership.sql:33–42](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/009_transfer_ownership.sql#L33)
- [011_account_deletion_locking.sql:28–44](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/011_account_deletion_locking.sql#L28)

012 fires on INSERT only:

- The item RPC can continue increasing the parent list revision.
- The existing UPDATE timestamp trigger can continue assigning updated_at.
- Voluntary and administrative ownership changes can continue updating existing rows under the trusted execution context.
- No permanent CHECK revision = 0 is introduced, avoiding a constraint that would make all subsequent increments fail.
- Existing membership, pull, and item identity triggers are not replaced.

This is a static compatibility conclusion, not proof that the underlying RPC owners and ACLs work in a real Supabase project.

### 3.3 Existing data and administrative operations

012 does not scan or repair existing rows. A test database containing a previously created maximum-bigint list remains broken until separately handled. Legitimate existing lists may have nonzero revisions; they must not be indiscriminately reset.

Historical imports, seed scripts, or restores that run ordinary INSERT triggers and intentionally provide old dates/nonzero revisions will be rejected. This is a deliberate consequence of applying one invariant to all inserting roles, not a newly demonstrated authorization bug. A production import/restore policy must distinguish trusted historical reconstruction from normal application creation without adding a client-accessible bypass.

The current application is local-only with fixed list identifiers; this review does not claim that it already uses a working cloud-creation flow or that an existing production UI was broken by 012. Future adapters should omit these server-owned list columns. Client-origin timestamps needed for migration should be modeled separately from server timestamps.

## 4. Additional finding: inherited INSERT RETURNING compatibility

### M-012-01 — The list SELECT policy looks up the not-yet-inserted row

**Severity:** Medium.  
**Classification:** Pre-existing code defect in the creation path, identified during this review; not introduced by 012.  
**Reproducibility status:** High-confidence static expectation supported by PostgreSQL source inspection; no target database test was run.

**Exact project locations:**

- [001_initial_schema.sql:38–47](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/001_initial_schema.sql#L38): can_access_list checks existence in shopping_lists.
- [001_initial_schema.sql:75–78](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/001_initial_schema.sql#L75): lists_read uses only that helper, while lists_insert checks the candidate row's owner.
- [012_list_creation_guard.sql:13–29](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/012_list_creation_guard.sql#L13): valid metadata does not change the inherited SELECT policy.

**Failure scenario:**

```sql
INSERT INTO public.shopping_lists (owner_id, name)
VALUES (auth.uid(), 'New list')
RETURNING id, revision, created_at, updated_at;
```

Run it as a normal authenticated user, not the table owner or a BYPASSRLS role, with intended INSERT and SELECT rights.

When INSERT requires SELECT rights, for example to return target columns, PostgreSQL adds the SELECT policy as an insertion WITH CHECK condition. The check is evaluated before physically inserting the new row. can_access_list queries shopping_lists for the candidate id, but that fresh row does not yet exist. It can therefore return false even though the candidate owner_id is the authenticated user.

The expected result is an RLS error, likely SQLSTATE 42501, with no inserted row, after the metadata guard itself has passed. No exact runtime message is claimed.

**Impact:** A normal create-and-return flow, including a Supabase/PostgREST client requesting the inserted representation, can fail. It must not be described as fully compatible merely because now() equals transaction_timestamp().

**Expected behavior:** A new self-owned active row should satisfy the required SELECT check without needing to rediscover itself before insertion. Members should retain the intended read access to existing lists.

**Minimal safe fix:** In a separate reviewed change, make the list read policy accept an active row owned by auth.uid() using row-local columns, while retaining scoped membership authorization for other users. Keep the insert owner/deleted checks. Alternatively use a carefully designed creation RPC with its own authorization and result contract. Do not grant broad SELECT or expose a service-role key to make creation work.

A practical interim client pattern can be a minimal insert with a known client-generated UUID followed by a separate authorized read, but it does not repair the general INSERT RETURNING policy.

**PostgreSQL semantic cross-check, not runtime verification:**

- [PostgreSQL REL_17_STABLE rowsecurity.c:278–301](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/rewrite/rowsecurity.c#L278), retrieved blob 59fd305dd7bed3c57c625a4443118d793d2fb7ca: SELECT policies are added as WITH CHECK options when SELECT rights are required, including RETURNING.
- [PostgreSQL REL_17_STABLE nodeModifyTable.c:995–1020](https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/executor/nodeModifyTable.c#L995), retrieved blob f29cf4c7e6ec84e39212d2c698c58aade37ace23: RLS WITH CHECK options are checked before the actual insertion.

The target Supabase/PostgreSQL version still needs to be recorded and the exact SQL/API forms reproduced. This finding narrows the earlier report's unverified normal-creation expectation; it does not alter that report file.

## 5. Bypass and boundary analysis

| Attempt or execution path | Static result / remaining condition |
|---|---|
| INSERT with revision 1, -1, max bigint, or NULL | Guard rejects, or type conversion rejects first |
| INSERT with forged/NULL/infinite initial timestamps | Guard rejects |
| INSERT with explicit now()/transaction_timestamp() for both dates | Can pass; resulting values satisfy the invariant, but expression provenance is not proved |
| Different timezone spelling of the same instant | Can pass legitimately; timestamptz compares instants |
| Omit metadata columns or use their defaults | Passes metadata guard; authorization/RETURNING checks still apply |
| Multi-row INSERT | Per-row trigger checks every candidate; no partial statement success after an error |
| INSERT ... ON CONFLICT DO NOTHING | BEFORE INSERT checks still run for attempted rows; a conflict clause does not excuse invalid metadata |
| INSERT ... ON CONFLICT DO UPDATE | INSERT branch is checked; any actual UPDATE also needs UPDATE rights/RLS. 012 is not an UPDATE guard |
| COPY FROM / MERGE inserting into this ordinary table | Where permitted and reaching the normal insertion path, row INSERT triggers apply; actual role/version/RLS restrictions require testing |
| Change a custom owner-transfer GUC from 008 | Does not change this guard's checks or grant SQL permissions |
| Normal SECURITY DEFINER insert / service_role RLS bypass | Does not by itself bypass an ordinary INSERT trigger |
| UPDATE existing revision/created_at using leaked rights | Not protected by this insertion trigger; the existing ACL boundary must deny unintended writes |
| Inherited UPDATE(owner_id) or table-level UPDATE grant | Not fully neutralized by revoking the three named column ACLs; inspect effective privileges |
| Disable triggers, set privileged replication mode, or install a later modifying BEFORE trigger | Possible only with sufficient privileges; must be excluded from untrusted roles |
| Insert via a future privileged routine | Still triggers normal checks unless it deliberately bypasses/changes them; audit new routes |
| Existing bad row predating 012 | Unchanged; not a bypass of a future INSERT check, but requires separate data inspection |

The schema currently has no second BEFORE INSERT trigger that modifies these list fields after this guard. Future triggers could change the final tuple after validation. Review effective table TRIGGER privileges and the ability to supply/create executable trigger functions, not only table ownership; an untrusted role must not be able to install an after-guard modifier. Also inspect trigger-disable and parameter SET privileges where supported.

No ordinary DML-only bypass of the guarded insertion values was established under the intended final ACLs and enabled trigger. This is not proof that the actual deployed ACLs meet those assumptions.

## 6. Privileges, execution context, and migration feasibility

- guard_new_list_metadata is a trigger function with the default SECURITY INVOKER behavior, not a new SECURITY DEFINER endpoint.
- Its body assigns no identity, accesses no application table, and performs no dynamic SQL.
- Empty search_path and implicit pg_catalog lookup are appropriate for transaction_timestamp().
- A trigger function being executable by PUBLIC does not let a caller invoke it as a normal RPC to obtain a NEW record or perform arbitrary DML. Normalize routine ACLs as part of the outstanding full review, but do not mistake this function for the administrative deletion RPC.
- Creating the trigger requires suitable migration privileges, including the relevant table TRIGGER privilege and function execution at trigger creation. The guard does not require granting a new public ordinary-call API to every inserting user.
- 012 assumes the table, revision column, prior constraints, and intended roles exist. Apply after 001–011.
- No unconditional syntax error was identified. Actual execution is unverified.
- Re-running this file without a migration ledger will encounter the already-existing trigger. CREATE OR REPLACE FUNCTION does not make CREATE TRIGGER rerunnable. Treat it as a versioned migration.
- Existing unrelated ACL defects can still cause creation/RPC failures. A rejected unauthorized operation is not a regression in the metadata guard.
- The migration makes no changes to prepare_account_deletion EXECUTE grants, account fencing, transaction isolation, invitation safety, or synchronization retention.

## 7. The three previous High findings remain unresolved

The identifiers in this section refer to **CODEX_AUDIT_REPORT_011.md**, not earlier reports with different H-01/H-02/H-03 meanings.

| Baseline High | Why 012 does not fix it | Required direction |
|---|---|---|
| **H-01 — Preparation is not a complete account-deletion lifecycle** | No account deletion state/fence, durable attempt, Auth orchestration, or recovery is added. A still-active account can create another list with valid default metadata after preparation. | Keep deletion unavailable to clients until the authorized, fenced, recoverable lifecycle is implemented. |
| **H-02 — Administrative deletion relies on an incompletely specified EXECUTE boundary** | The new REVOKE concerns UPDATE(owner_id), not EXECUTE on prepare_account_deletion, service-role defaults, inherited grants, or backend target-user authorization. | Enumerate effective administrative execution rights and restrict the backend route and target identity. |
| **H-03 — Cached membership remains usable inside an old REPEATABLE READ snapshot** | The trigger runs only on list INSERT. It does not update an authorization epoch during member removal or restrict isolation in existing RPCs. | Enforce the supported transaction model or implement a revocation/serialization design that handles stale snapshots. |

**Exact baseline references:**

- [CODEX_AUDIT_REPORT_011.md:94–117, H-01](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L94)
- [CODEX_AUDIT_REPORT_011.md:118–140, H-02](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L118)
- [CODEX_AUDIT_REPORT_011.md:141–167, H-03](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/CODEX_AUDIT_REPORT_011.md#L141)
- [011_account_deletion_locking.sql:4–54](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/011_account_deletion_locking.sql#L4)
- [006_membership_safety.sql:24–31](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/006_membership_safety.sql#L24)
- [007_pull_authorization_lock.sql:19–38](https://github.com/MusicMeasurer/shopping-app/blob/ffa9d48af0adaf1620b50f6e76f4c94bd80e25d8/cloud/drafts/007_pull_authorization_lock.sql#L19)

H-02 remains conditional on actual administrative exposure; this review does not newly prove client reachability. H-03 remains conditional on supporting old REPEATABLE READ transactions; a fresh READ COMMITTED request should still consult current membership. The prior severity qualifications remain in force.

Other baseline issues also remain unless directly discussed: snapshots/retention, transfer retry identity, complete lock orchestration, historical identity retention, Siri credentials, item conflict responses, and NULL action validation.

## 8. Required isolated tests — proposed, NOT executed

Use a disposable Supabase database with 001–012, APIs disabled while applying migrations, and real test users A/B/C plus anonymous. Record owners, ACLs, default privileges, inherited roles, trigger definitions/enabled state, RLS policies, and SQLSTATE at the first failure.

Run SQL role simulations and actual Auth/PostgREST requests. SQL that sets request JWT GUCs is a permission simulation, not a JWT-signature test. Do not run all insert tests as postgres or service_role: those roles can conceal the ordinary-user RLS failure.

### 8.1 Guard behavior matrix

| Test | Expected result to verify |
|---|---|
| Authenticated self-owned insert omitting revision/dates, no target-column RETURNING | Metadata defaults accepted; row revision 0 and both dates equal transaction start |
| Explicit revision 0 and both dates now() | Accepted at guard level; documents value/provenance distinction |
| Explicit revision 1/-1/max bigint/NULL | Rejected; no row stored |
| Valid dates except one historical/future/NULL/infinite date | Rejected; no row stored |
| Both dates from a client's millisecond clock | Not a supported input; assert rejection whenever values differ |
| Exact same instant represented in another timezone | Accepted at guard level |
| Later statement in a long transaction using defaults | Dates equal transaction start, not later wall-clock time |
| Multi-row insert with one invalid candidate | Entire statement rolled back |
| ON CONFLICT with invalid candidate metadata | Cannot bypass BEFORE INSERT guard |
| Wrong owner, deleted_at set, anonymous, invalid name | Existing policy/constraint still denies creation |
| Minimal vs representation-return PostgREST creation | Test separately; expose M-012-01 instead of assuming both work |

### 8.2 Direct reproduction of the creation-policy difference

Use an administrative connection solely to switch to the ordinary test role. Supply psql variable actor_a with the UUID of an existing real test Auth user. Capture actual grants before adding any fixture permissions; if those grants are missing, report that separately instead of silently changing the tested system.

**Case A: insert without target-column RETURNING.**

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'actor_a', 'role', 'authenticated')::text,
  true
);

INSERT INTO public.shopping_lists (id, owner_id, name)
VALUES (
  '12000000-0000-4000-8000-000000000001',
  :'actor_a'::uuid,
  '012 minimal insert'
);

SELECT revision = 0 AS revision_ok,
       created_at = transaction_timestamp() AS created_at_ok,
       updated_at = transaction_timestamp() AS updated_at_ok
FROM public.shopping_lists
WHERE id = '12000000-0000-4000-8000-000000000001';
ROLLBACK;
```

Expected with intended grants: one inserted row, then three true values in the separate SELECT.

**Case B: new insert returning the created columns.**

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor_a', true);
SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', :'actor_a', 'role', 'authenticated')::text,
  true
);

INSERT INTO public.shopping_lists (id, owner_id, name)
VALUES (
  '12000000-0000-4000-8000-000000000002',
  :'actor_a'::uuid,
  '012 insert returning'
)
RETURNING id, revision, created_at, updated_at;
ROLLBACK;
```

Expected static counterexample: metadata check passes but the inherited SELECT-policy WITH CHECK rejects the fresh row. Capture SQLSTATE, confirm no row remains, and repeat through the actual Supabase representation-return path.

Both scripts are documentation for a future test. They were not executed in this review.

### 8.3 Subsequent operations and ACL tests

1. Create and commit a valid fixture list using the minimal path.
2. Call apply_item_change and confirm revision can move from 0 to 1 and onward.
3. Confirm the UPDATE timestamp trigger advances updated_at on later transactions while created_at is unchanged through reviewed RPCs.
4. Transfer ownership and run controlled deletion preparation; verify 012 creates no trigger conflict.
5. Attempt direct UPDATE of revision, created_at, and owner_id as A/B/C/anonymous: require intended denial, including table-level and inherited column privileges.
6. In disposable administrative fixtures only, add a direct PUBLIC UPDATE(owner_id) column grant before applying 012; verify that exact grant is removed. Test inherited grants separately.
7. Verify untrusted roles cannot install a modifying trigger, disable the guard, or set privileged trigger-bypassing replication mode.
8. Test service-role/definer ordinary INSERT with forged metadata: RLS bypass alone must not disable the trigger.
9. Inspect pre-existing invalid rows without resetting valid nonzero revisions; determine whether test data repair is needed.
10. Confirm creation does not grant access to another user's list and rejected inserts leave no partial row.

### 8.4 Unchanged High regression gates

- H-01: commit preparation, fail final Auth deletion, and attempt new valid list creation/new relationships. Verify the still-missing lifecycle fence and recovery behavior.
- H-02: inspect effective EXECUTE on prepare_account_deletion for every role, including service_role and inherited roles, and inspect backend authorization. UPDATE(owner_id) revocation is not an administrative EXECUTE test.
- H-03: establish a B REPEATABLE READ snapshot, remove B in another committed transaction, then attempt old-transaction pull/mutation. Also retain the READ COMMITTED positive revocation tests.

None of these High gates can be marked passed because 012 validates insert metadata.

## 9. Final disposition

| Concern | Disposition after 012 |
|---|---|
| Nonzero/NULL initial list revision | Addressed by code for new rows with enabled guard |
| Arbitrary initial server-date values | Addressed by code relative to transaction-start semantics |
| Proof that metadata columns were omitted by the client | Not provided, and not necessary for the value invariant |
| Normal minimal insert | Compatible with the guard; full SQL/API path still requires test |
| INSERT RETURNING / representation-return creation | Inherited Medium RLS defect identified; not fixed by 012 |
| Later RPC revision/date/owner updates | Not blocked by this INSERT-only guard, subject to existing owners/ACLs |
| Specific PUBLIC UPDATE(owner_id) column grant | Revoked by 012 |
| Full ACL/inheritance and privileged bypass model | Still unverified/incomplete |
| Existing invalid rows or trusted historical import | Not remediated/specified by this migration |
| Previous H-01, H-02, H-03 | **All remain unresolved** |
| Production readiness | **NO** |

The change is a reasonable focused hardening step for initial list metadata. Accept its limited static effect, require isolated database/API validation, and retain the production block. Only this English report is saved and committed at the user's request.
