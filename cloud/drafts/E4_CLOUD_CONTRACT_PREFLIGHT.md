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
