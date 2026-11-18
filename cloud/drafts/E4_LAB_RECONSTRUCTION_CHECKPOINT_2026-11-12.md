# E3/E4 laboratory reconstruction · implementation checkpoint (2026-11-12)

**Working branch:** `feature/e4-accepted-reintegration`. **Mode:** read-only live inspection and static CI design. No hosted schema mutation, no new Supabase project, no chargeable resources. **This is not a tested database restore.**

## Captured from the existing lab

- `E4_LAB_RECOVERY_INVENTORY_2026-11-12.md`: 23 public SQL function definitions, 10 RLS policies, 5 triggers, 38 table grant records, and the source/configuration of two Siri Edge Functions.
- `E4_LAB_SCHEMA_METADATA_2026-11-12.md`: 71 public columns, 41 constraints, 22 indexes, 6 installed extensions.
- Existing repository baseline: `TEST_MIGRATIONS_ATOMIC_001_016.sql`, `018_acl_normalization_REVIEW_ONLY.sql`, `020_siri_add_REVIEW_ONLY.sql`; additional migrations/drafts must be inventoried before claiming parity.
- Captured metadata and definitions do not cover all cluster/global roles, auth schema, storage setup, secrets, platform settings or historical data. User explicitly approved recreating test data instead of preserving it.

## Initial comparison (limited to 001–016, 018, 020)

14 of 23 live public function **names** occur in these three source files. The other 9 are: `accept_list_invitation_link`, `create_list_invitation_link`, `create_siri_pairing`, `exchange_siri_pairing`, `list_pending_invitation_links`, `list_siri_shortcuts`, `revoke_all_siri_shortcuts`, `revoke_list_invitation_link`, `rls_auto_enable`. **This does not mean they are absent from the repository**: additional draft SQL and lab-only applied migrations may contain them. Compare exact signatures and bodies next, not names alone.

## Automated verification

- `tests/recovery/test_inventory.py`: parse both snapshots, check uniqueness/presence of SQL functions, policy/trigger/grant coverage, captured Siri Edge sources, schema metadata and known-secret patterns, and print name-level SQL draft coverage.
- `.github/workflows/e4-recovery-inventory.yml`: run the unittest suite on the working branch (push or manual dispatch).
- An independent connector-side parse confirmed both snapshot JSON payloads and structural counts. **GitHub Actions result and PostgreSQL restore have not yet been confirmed.** Passing static checks would not validate executable SQL, RLS, Auth or E3/E4 cloud functionality.

## Reconstruction sequence (not yet executed)

1. Audit all existing SQL migration/draft files and the eight lab-applied migration versions; reconcile each live function signature, policy, trigger, grant, constraint and extension. Never overwrite an applied migration. Put required lab-only deltas in reviewed additive reconstruction SQL, not in the original baseline.
2. Build a deterministic bootstrap order: Supabase Auth/extension prerequisites → 001–016 → reviewed lab patches → Siri SQL/Edge source → metadata/ACL reconciliation. Respect dependency order and never blindly replay the live definitions over an unprepared schema.
3. Run the bootstrap and negative A/B/RLS/role tests on an isolated disposable environment. Use an existing CI PostgreSQL service when its Auth shim is sufficient; for JWT/PostgREST/Edge integration, use a separate real Supabase environment with explicit cost approval if required.
4. Verify fresh schema metadata, function bodies/signatures, policy/grant semantics, extension availability and test rerun. Do not treat recreated test users or test data as restored originals.
5. Only after the restore gate passes, consider E4 archive SQL drafts and migration testing.

## Stop gates

- No changes to `shoppingapp-migration-lab` or `shoppingapp-security-lab` until recovery has been demonstrated independently.
- Do not declare the lab recoverable solely because definitions were saved or static checks pass.
- No paid Supabase branch/project, production change, main merge, or secret export without separate authorization.
