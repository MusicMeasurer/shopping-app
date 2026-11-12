# E3↔E4 · Archive persistence and recovery gate (design draft, 2026-11-12)

**Base:** `feature/e4-accepted-reintegration`, after CI-passed snapshot `b3780253dec8cd5478848edf125da01a43e12aa8` (14 commits ahead when inspected). This is a **design-only** checkpoint; no SQL has been executed. Canonical product decisions: `main/docs/01_REQUIREMENTS.md`, `02_ARCHITECTURE.md` (2026-11-12). Existing `022/023` SQL files remain REVIEW ONLY.

## Verified current laboratory state (read-only)

- `shoppingapp-migration-lab` has `shopping_lists`, `shopping_items`, `list_changes`, `item_operations` and no cloud completion/archive tables in the inspected public schema.
- `shopping_items.list_id`, `list_changes.list_id` and `item_operations.list_id` reference `shopping_lists(id) ON DELETE CASCADE`. Do not use these live item/change rows as the durable archive.
- Existing cloud `shopping_items.quantity/unit` columns are present, but the existing mutation RPC and pull snapshots do not yet support them.
- Account list metadata and archive operations are not integrated. The historic lab contains test records and is **not disposable**.

## Accepted semantic contract

1. `purchased` in an active list is provisional. Toggling it never writes an archive.
2. **Complete list** is one explicit, version-checked, atomic operation. Completion modes: `marked_only` (archive marked), `all_purchased` (archive all), `none_purchased` (no archive record). Empty lists cannot be completed. Completion must be idempotent by stable operation UUID.
3. Archive records are immutable completion snapshots, **only confirmed purchased items**, owned by the user's account/profile. Snapshot list name, completion time, item name/quantity/unit and stable completion ID; retain durable item order if present. Do not rely on mutable list name or on a mandatory FK to a deletable active list. If retaining origin list UUID for traceability, it must not cascade-delete the snapshot.
4. After completion permanent lists remain active for next cycle; one-off lists leave active workspace. Non-purchased positions do not enter archive. For `none_purchased`, do not create an empty archive version.
5. **Delete active list** never writes an archive; warn and offer completion only when there is at least one provisional purchased mark. Existing archive is unaffected.
6. Future purchase history is a query/view over these archive records, not a second duplicated purchase table.

## Proposed storage shape (NOT executable migration)

- `archive_completions`: `id UUID PK`, `owner_id UUID NOT NULL`, `source_list_id UUID` **without cascading delete**, `source_list_name TEXT NOT NULL`, `completed_at TIMESTAMPTZ NOT NULL`, `operation_id UUID NOT NULL`, unique owner+operation ID. Retention/authorization must be independent of active list existence.
- `archive_items`: `completion_id UUID FK` to archive completion (archive-only delete rules), `source_item_id UUID` optional snapshot field, `name TEXT`, `quantity NUMERIC`, `unit TEXT`, `position BIGINT`; archive rows immutable through normal client paths.
- Local guest/profile archives must remain profile-scoped; migration to account/cloud requires verified ownership and no duplication. Never infer identity from list name.
- No archive table should expose rows across accounts. For public-schema tables: RLS on, owner-scoped SELECT and no arbitrary client INSERT/UPDATE/DELETE; reviewed transactional RPC must validate `auth.uid()`, authorization, expected revision, replay payload and atomicity. Audit SECURITY DEFINER and EXECUTE grants.
- Account deletion and explicit archive deletion are separate future retention decisions; do not implement implicit destruction by dropping a list.

## Updated environment decision (approved 2026-11-12)

The previous full-backup/restore gate below was superseded by the user's explicit decision: continue additive E3→E4 migrations in the **existing** `shoppingapp-migration-lab` without clearing it. Do not require a complete database backup, third Supabase project, or paid tooling. Preserve reproducible SQL/code/security rules in GitHub; historical test records need not be retained. The `shoppingapp-security-lab` is reserved as the future main environment **after** E3↔E4 integration acceptance; do not modify it now.

Current first increment: `024_e4_archive_snapshot_SCHEMA_CI_ONLY.sql` + `test_e4_archive_schema.sql` establish durable owner-scoped read-only snapshot tables in isolated PostgreSQL CI. This is not a completion RPC or hosted deployment. Continue with atomic, version-checked, idempotent completion/reset and client integration before declaring cloud archive ready.

## Open implementation gates

- Confirm compatibility with existing local E4 archive data structures and historic records before designing a migration; do not silently discard pre-existing archive entries.
- Define versioned completion RPC, durable receipt and list reset semantics, account-scoped offline queue and cross-device conflict handling; extend item quantity/unit mutation and pull consistently.
- Test list deletion after completion, duplicate replay, stale version, A/B isolation, offline/restart/online, no-purchase and partial-purchase dialogs, all 36 accepted E4 local regression cases and physical iPhone acceptance.
- Existing `022/023` drafts omit completion/archive; do not execute them as an integrated solution.
- Do not claim a completed backup, verified recovery, SQL migration or E3/E4 cloud acceptance.


## Completion RPC CI checkpoint · 2026-11-12

- Added `025_e4_completion_RPC_CI_ONLY.sql`: owner-scoped transactional `complete_e4_list`, operation UUID receipts, revision gate, archive snapshots, soft-deletion tombstones and permanent/oneoff branch (oneoff depends on E4 metadata schema).
- Added `tests/recovery/test_e4_completion_rpc.sql`: marked-only, none-purchased, no-marks, replay, payload mismatch, stale revision, foreign owner, archived item count, revision/tombstones.
- [GitHub Actions run #23](https://github.com/MusicMeasurer/shopping-app/actions/runs/43207740279) **success** at commit `c38cc725660e0fd1d6bc31c7ca2c28e3c754f010`; temporary PostgreSQL only.
- **Not yet done:** end-to-end oneoff flow with metadata 022, all-purchased snapshot assertion, empty-list negative test, race/concurrency test, hosted A/B tests, browser offline queue, archive UI wiring and physical iPhone acceptance. Existing lab was not changed. Do not deploy these CI-only drafts as-is; review auth/permissions, compatibility with E3 pull cursors and list deletion semantics first.


## E4 metadata + completion CI checkpoint · 2026-11-12

- CI now installs additive E4 list metadata draft `022` before completion RPC `025`. RPC reads the explicit permanent/oneoff kind rather than silently assuming permanent for all lists.
- Fixed archive insert verification to query archive items by their completion UUID.
- Added isolated PostgreSQL tests for oneoff soft-removal, `all_purchased` with quantity/unit snapshot, empty-list rejection, alongside prior marked-only, no-purchase, replay, stale revision and foreign owner.
- [GitHub Actions run](https://github.com/MusicMeasurer/shopping-app/actions/runs/43208871411) completed **success** for commit `4f6df36f58c579b095cb78aa06ec6e4af4228917`.
- **Still open:** hosted lab deployment and A/B tests, full concurrency stress, cross-device synchronization and browser integration/offline queue, physical iPhone acceptance. This is not E3+E4 acceptance and the main Supabase environment remains unchanged.


## Archive deletion and replay regression · 2026-11-12

- Extended `tests/recovery/test_e4_completion_rpc.sql` with actual deletion of the original active lists after completion, archive count preservation, receipt persistence and replay after deletion, foreign-account read denial and negative table privilege checks.
- First CI run [#43209369420](https://github.com/MusicMeasurer/shopping-app/actions/runs/43209369420) failed because new test used invalid `DO $` delimiter; job logs identified syntax error at test line 73. Corrected delimiters to `$test$` without changing application SQL.
- Re-run [#43209626592](https://github.com/MusicMeasurer/shopping-app/actions/runs/43209626592) **success**, commit `c58ad218dd207db71ab29c0dcd1fcf6fb7054fc9`. This verifies isolated PostgreSQL behavior only; hosted Supabase deployment, browser integration and real iPhone acceptance remain open.


## Parallel completion regression · 2026-11-12

- Added `tests/recovery/test_e4_completion_concurrency.py` using two genuinely parallel PostgreSQL sessions, distinct operation UUIDs and the same expected list revision. Asserted exactly one success, one conflict, one archive completion/item/receipt, and a single list revision/change entry.
- Wired test into `e4-postgres-recovery.yml`. [GitHub Actions run](https://github.com/MusicMeasurer/shopping-app/actions/runs/43210101078) **success**, commit `98d769003baf6a7ef8a31ed29e811facddf14604`.
- Coverage remains limited to ephemeral PostgreSQL, not hosted Supabase Auth, two-device offline synchronization or UI. The existing migration polygon and main environment were not changed.


## Client archive read integration checkpoint · 2026-11-12

- Added `src/data/cloud-archive.ts`: read-only authenticated Supabase archive adapter, RLS-scoped by current JWT, snapshot/item grouping, no user-supplied owner filter and fail-closed errors.
- Added `src/data/cloud-archive.test.ts`: grouped snapshots, empty archive, denied completion query, denied item query.
- Added an explicit account-only cloud archive viewer in `src/AuthenticatedApp.tsx`, including identity verification before and after fetch, account-change state clearing, and error handling. No client archive writes are enabled. It is not yet an E4 parity replacement for the local archive UI.
- E4 workflow now runs frontend unit tests and TypeScript/Vite build alongside isolated PostgreSQL regression; triggers on archive client/UI changes.
- **Deployment gate:** archive tables/RPC are CI-only and not installed on hosted Supabase. Until additive hosted migration and A/B verification, the cloud archive viewer will report an unavailable-query error; do not claim end-to-end readiness. Cloud completion action, offline queue, account archive migration, and physical device acceptance remain open.


## Hosted migration and rollback-only functional probe · 2026-11-12

- **Applied to existing `shoppingapp-migration-lab` only** through Supabase migrations, sequentially: `e4_list_metadata` (022), `e4_archive_snapshot` (024), `e4_atomic_completion` (025). No wipe, no third lab, no deployment to `shoppingapp-security-lab`.
- Hosted read-back: zero invalid kind/position metadata; `authenticated` has no direct `shopping_lists UPDATE`; authenticated can EXECUTE `complete_e4_list` and SELECT archive, cannot INSERT archive; both owner-scoped archive RLS policies exist; existing active permanent list remains.
- Executed hosted **transactional rollback-only** functional test using an existing account ID, newly generated temporary list/item/operation UUIDs, `SET LOCAL ROLE authenticated` and the owner's JWT claim. Tested `oneoff`, `marked_only`, quantity/unit snapshot and idempotent replay. First probe incorrectly checked the soft-deleted list through authenticated RLS (which intentionally hides deleted rows); fixed probe to reset role before asserting tombstone. Corrected probe passed; explicit `ROLLBACK` returned zero temporary list rows and zero archive rows. No persistent test records.
- **Not yet done:** independent hosted A/B negative tests, hosted API HTTP auth tests, UI cloud completion, offline queue, profile migration and iPhone acceptance. Do not promote to main.


## Hosted A/B authorization probe · 2026-11-12

- Executed rollback-only two-account negative/positive probe on `shoppingapp-migration-lab` with two existing Auth IDs, temporary generated list/item/operation UUIDs and real `authenticated` PostgreSQL role with distinct `request.jwt.claim.sub` values.
- B could not SELECT A's active list, invoke `complete_e4_list` on it, or read A's completion or archive items. A could complete and read the resulting archive. The transaction was explicitly rolled back; zero temporary lists persisted.
- This verifies PostgreSQL role/JWT-claim simulation, **not** a real HTTP/PostgREST request with independently issued signed access tokens. HTTP A/B remains open.
- **Integration hazard:** account client currently maintains durable item operations and explicit versioned remote-deletion review. Direct completion of a cloud-bound list before pending operations drain and tombstones are reconciled can cause stale local items to reappear or pending edits to conflict. Do not expose an unguarded 'complete cloud list' button until the client has a safe completion queue/reconciliation protocol. Local guest E4 remains unchanged.


## Hosted E3 tombstone compatibility and CI A/B gate · 2026-11-12

- Hosted rollback-only `none_purchased` completion on temporary permanent list produced **no archive**, a deleted item with incremented version, a corresponding `list_changes` delete event and monotonic list revision; zero probe rows remained after rollback.
- Probe was corrected to use the existing item version default (minimum 1), and to inspect `list_changes` after resetting from `authenticated` to the migration/admin role; direct client SELECT on `list_changes` is intentionally not granted. These were probe errors, not server migration failures.
- Added reproducible two-account owner/foreign RLS test `tests/recovery/test_e4_hosted_ab_rls.sql` and wired it into isolated PostgreSQL CI. [Run 43214437566](https://github.com/MusicMeasurer/shopping-app/actions/runs/43214437566) **success** (including frontend tests/build and SQL regressions).
- Still pending: real signed-token HTTP A/B, offline-to-online completion and safe E3 client queue/tombstone reconciliation, hosted browser/device acceptance. Do not expose unguarded cloud completion or promote to accepted environment.


## E4 completion preflight · 2026-11-12

- Implemented `src/data/cloud-completion-preflight.ts`: read-only, fail-closed check for verified account mapping, outstanding legacy/cloud operations, empty/divergent server list, purchase/name mismatch, server list revision stability and account switching. This is **not** a completion authorization; the server RPC still owns revision checks.
- Added `src/data/cloud-completion-preflight.test.ts` for positive, unverified mapping, queued writes, divergence, empty list and account-change cases. Corrected initial test syntax and mock Supabase field naming after CI failures; run [43215684483](https://github.com/MusicMeasurer/shopping-app/actions/runs/43215684483) passed.
- Added a **read-only** 'Проверить готовность облачного списка к завершению' action to account UI. It never calls `complete_e4_list` or deletes local data, and explicitly states completion is unavailable until safe durable reconciliation is implemented.
- **Unresolved:** preflight cannot alone make completion safe against concurrent local edits, offline restarts, or crash between RPC commit and local tombstone application. Need a durable completion intent/receipt state machine and recovery tests before enabling actual cloud completion. No accepted behavior changed.


## Strict cloud completion RPC client adapter · 2026-11-12

- Added `src/data/cloud-completion-rpc.ts` and tests: validates UUIDs, expected revision, mode, server operation/list identity, revision advancement, item count and archive UUID; propagates server errors without inventing a success receipt.
- The adapter is **intentionally not connected to the UI**. A verified read-only preflight cannot replace a durable completion-intent/receipt queue, local tombstone reconciliation or crash/restart recovery. Cloud completion remains disabled until that coordinator is implemented and regression-tested.
- Frontend UI now exposes only a read-only readiness check; E4 guest/local completion and accepted E3 sync are unchanged. No further hosted schema changes.


## Durable completion intents · 2026-11-12

- IndexedDB schema upgraded additively from v10 to v11 with account-scoped `accountCompletions` store. An intent persists operation UUID, owner, list mapping, expected server revision, completion mode, and the exact local item IDs. No existing stores are deleted.
- `beginAccountCompletion` atomically validates mapping, blocks unresolved queued writes and divergent item IDs, and records the intent. `saveAccountEdit` fences cloud mutations on a list with an in-flight completion. `commitAccountCompletion` atomically verifies unchanged intent/mapping/items, removes only intended account items and clears the intent. Failure retains the intent for replay.
- `createCloudCompletionCoordinator` records intent **before** calling `complete_e4_list`, replays the **same UUID** after failed local commit/restart, and propagates server errors without acknowledging or erasing the intent. Unit tests simulate local crash, server failure, missing/foreign intent; real fake-indexeddb tests verify persistence across close/reopen, edit fence, rollback on invalid receipt and queued-write rejection.
- CI [43216924198](https://github.com/MusicMeasurer/shopping-app/actions/runs/43216924198) **success**: frontend unit regression, TypeScript/Vite build and isolated SQL tests.
- **Release gate remains open:** coordinator is deliberately not connected to a completion button. Existing direct account-item save/remove/import methods and cross-tab writes must be fenced/reconciled consistently; server-receipt item versions and oneoff mapping lifecycle, signed-token HTTP tests, and real offline/restart/device acceptance remain to be verified. An intent left after a revision conflict requires explicit conflict resolution; never discard it blindly. This is a tested durable protocol foundation, **not** accepted end-to-end cloud completion.


## Completion safety hardening · 2026-11-12

- Closed account completion mutation bypasses: direct `saveAccountItem` and `removeAccountItem`, `importRemoteOnlyBatch`, `applyReviewedRemoteDeletions` and `enqueueAccountPending` now check the account-scoped completion intent in the same IndexedDB readwrite transaction as their write. Unknown ownership of a legacy delete fails closed while any completion is pending. Tests cover these routes and durability across DB reopen.
- After the idempotent completion RPC, the coordinator reads server tombstones for the exact completed item IDs. `commitAccountCompletion` validates the full set and atomically persists **server-confirmed deleted versions** with item removal and intent acknowledgement. A missing tombstone keeps the intent for retry; versions are never fabricated. Recovery tests exercise this path.
- Completion preflight rejects local quantity/unit values that the current E3 remote snapshot cannot verify. This prevents falsely promising a matching immutable archive but intentionally restricts cloud completion until E3 quantity/unit sync is integrated.
- Added explicit error classification for revision conflicts vs ambiguous transport failures; this is a foundation, not yet a persistent conflict-resolution UI/state machine.
- [GitHub Actions 43219039672](https://github.com/MusicMeasurer/shopping-app/actions/runs/43219039672) **success** including frontend tests/build and PostgreSQL regressions. Working branch only; no hosted or accepted-environment schema changes in this cycle.
- **Still open:** full oneoff/permanent local profile and mapping lifecycle, persistent conflict resolution and safe recovery UX, quantity/unit E3 sync, real HTTP signed-token A/B, cross-tab/restart/offline device testing, final UI completion integration. Do not mark E3+E4 integration complete or enable destructive completion yet.
