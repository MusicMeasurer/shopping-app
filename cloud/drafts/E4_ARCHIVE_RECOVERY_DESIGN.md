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
