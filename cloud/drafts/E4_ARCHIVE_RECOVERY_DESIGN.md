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

## Recovery checkpoint before any lab schema mutation

**Not done.** A SQL schema inspection, Git snapshot or migration draft is not a database backup.

1. Inventory PostgreSQL schema, roles, data, migration history, extensions, functions, RLS/GRANT, Auth configuration, Storage object bytes and service settings. Exclude credentials/secrets from repository and logs.
2. Export roles, schema and data using documented Supabase CLI `db dump`; preserve migration history separately if used. Record checksums, timestamp, tool versions, project ref and coverage/gaps. Storage objects and dashboard configuration need separate handling.
3. Validate restore to an **isolated non-production environment**, with table counts, functions, ACL/RLS, auth and representative tests. Never overwrite either historical lab as a restore test. Do not provision paid services without approval.
4. Only after a verified restore gate: draft additive SQL migrations and rollback/forward-recovery plan; perform isolated A/B security and idempotency tests, then consider controlled lab execution.

Supabase reference: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Open implementation gates

- Confirm compatibility with existing local E4 archive data structures and historic records before designing a migration; do not silently discard pre-existing archive entries.
- Define versioned completion RPC, durable receipt and list reset semantics, account-scoped offline queue and cross-device conflict handling; extend item quantity/unit mutation and pull consistently.
- Test list deletion after completion, duplicate replay, stale version, A/B isolation, offline/restart/online, no-purchase and partial-purchase dialogs, all 36 accepted E4 local regression cases and physical iPhone acceptance.
- Existing `022/023` drafts omit completion/archive; do not execute them as an integrated solution.
- Do not claim a completed backup, verified recovery, SQL migration or E3/E4 cloud acceptance.
