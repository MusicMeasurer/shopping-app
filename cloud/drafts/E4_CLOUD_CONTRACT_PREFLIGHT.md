# E3↔E4 · Cloud contract preflight (2026-11-12)

**Status:** verified read-only audit + implementation plan, NOT an approved cloud migration or completed integration. Scope: PWA, not Siri/E8. No hosted schema changes, production deploy, or account data mutation performed.

## Verified against `shoppingapp-migration-lab` (read-only introspection)

- `public.shopping_lists`: `id uuid`, `owner_id uuid`, `name text`, `revision bigint`, timestamps, `deleted_at`. **No** `kind`, `position`, completion/versioned archive fields.
- `public.shopping_items`: `quantity numeric nullable` and `unit text nullable` **already exist**. Previous claim that cloud *schema* lacks quantity/unit is inaccurate. The **mutation RPC** `apply_item_change(p_operation,p_list,p_action,p_item,p_name,p_purchased,p_expected_version)` cannot accept them, and current `remote-mutation.ts` omits them.
- `item_operations` stores idempotent mutation receipts; `pull_item_changes` has revision pagination. Current E3 code binds local lists by verified UUID and supports offline item queue; no general cloud list-operation queue or archive protocol.
- RLS enabled on `shopping_lists`, `shopping_items`, `list_members`, `item_operations`. Existing policies authorize owner/list access; functions `apply_item_change`, `pull_item_changes`, `can_access_list` are SECURITY DEFINER and require explicit signature/ACL review before changing.
- `fetchOwnedCloudLists` is intentionally read-only and only fetches `id,owner_id,name`. `AuthenticatedApp` and workspace currently retain fixed list assumptions for account-mode operations.

## Required contract (proposed, not yet accepted/implemented)

1. Add additive `kind` and `position` metadata for cloud lists with backfill/defaults; never infer identity from names. Owner-scoped, version-checked mutations for create/rename/change-kind/reorder/soft-delete.
2. Archive **snapshots**, not destructive moves: immutable completion id, list id, completion timestamp, captured item names/quantities/units/purchased, durable order. Keep previous completions of permanent lists. Decide explicitly whether archive remains available after list deletion.
3. Extend item mutation and pull serialization for quantity/unit while retaining old callers. Decide between new versioned RPC and compatible extension after auditing existing SQL bodies and grants; no silent breaking signature replacement.
4. Use stable operation IDs, list revision preconditions, idempotent replay and conflict handling for all cloud list/archive changes. Offline queue must be account-scoped and survive reload/sign-out without leaking or silently applying to another account.
5. RLS/privilege gate: server-verified actor; owner-only metadata/destructive actions; shared-list permissions not broadened by E4. Audit SECURITY DEFINER search_path, EXECUTE grants, cross-account A/B, stale tokens, double replay, out-of-order and concurrent operations.
6. No direct `shopping_lists` update from the UI before a versioned operation contract is tested. A successful client-side edit is not evidence of cloud durability.

## Verification gates before acceptance

- Disposable **isolated** database with reproducible migrations and negative authorization tests (A/B, unauthenticated, stale version, duplicate op, partial failure).
- Offline→restart→online replay and cross-device pull of list metadata, items with quantity/unit, multiple archive completions; account switch/logout isolation; recovery without data loss.
- Full E4 36/36 regression + E3 hosted A/B and independent review. Physical iPhone tests are user acceptance, not substituted by CI.
- Only after explicit release permission: staged migration/rollback, merge/deploy. Existing CI-passed snapshot `snapshot/e4-local-integration-ci-passed-2026-11-11` must remain unchanged.

## Implementation sequence

A. Extract server RPC SQL and compare exact ACL/grants with repository migrations; write new additive, rollback-aware migration drafts and negative SQL tests.
B. Implement versioned cloud list/archive/item contracts and local account queue with unit tests.
C. Wire authenticated UI to verified cloud lists while preserving guest profile E4 unchanged.
D. Run isolated hosted A/B, offline, regression and security checks; report remaining user acceptance gates.

**Stop condition:** do not execute schema-changing SQL against existing `shoppingapp-migration-lab` or `shoppingapp-security-lab` as if either were disposable; they contain historical test state. No production resources or billing changes without separate permission.

## Security advisor checkpoint

Read-only Supabase security advisor reported informational RLS-without-policy notices for internal operation tables and warnings for authenticated-executable SECURITY DEFINER functions (including `apply_item_change`). These are **audit findings**, not proof of exploitable flaws: the current RPC checks `auth.uid()`, locks the target list and calls `can_access_list`. Each function's grants, authorization path and least-privilege role must be reviewed against hosted A/B tests before changing ACL. Advisor reference: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable .

**Additional verified RPC detail:** `apply_item_change` uses a payload hash for replay protection, list-level locking, item version checks, and a `list_changes` snapshot that currently includes name/purchased/version/deleted but **not quantity/unit**. Extending only the SQL columns or the client JSON would be insufficient: mutation hashing, list-change snapshots, remote pull/import and conflict signatures must be extended together.

## Implementation checkpoint · 2026-11-12

- **Implemented in branch, not deployed:** fail-closed guard in cloud-aware store and `resolveVersionedMutation` for both new and **previously queued** quantity/unit edits. These edits are not acknowledged by the legacy RPC; queue remains durable for future compatible replay. Negative tests added.
- **Implemented, not wired into account UI:** `e4-cloud-list-metadata.ts` strictly parses owner-scoped list identity, kind, position and revision and reads them only when the E4 schema exists. It is intentionally unused until migration and hosted A/B gate; querying the current lab would fail because metadata columns do not exist. Parser and negative tests added.
- **Not implemented:** E4 migration, list/archive mutation RPC, archive retention after list deletion, cloud operation queue, end-to-end account UI, cross-device integration.
- **Unresolved product decision from FR-002-03:** fate of archived versions and items after deleting a list. Do not silently choose cascading deletion or retention; this must be reconciled before final destructive-operation contract.
- **Test gate:** CI unit/build and mobile E4 regression are required for branch changes. No server schema changes were applied to existing Supabase labs.

### Schema draft checkpoint

- `cloud/drafts/022_e4_list_metadata_REVIEW_ONLY.sql` is an **unapplied review draft**, not a migration history entry: additive kind/position columns, deterministic backfill for pre-E4 lists, constraints and owner-order index. Does not alter list identity or guess type from display names.
- This draft **does not make E4 cloud writes safe**. Current direct UPDATE RLS must be reviewed and restricted so revision checks cannot be bypassed; a versioned owner-scoped RPC, grants, idempotency and negative hosted A/B tests are prerequisites.
- Draft is intentionally not executed on either historical lab. Archive retention and destructive semantics remain unresolved under FR-002-03. No migration is marked verified.
