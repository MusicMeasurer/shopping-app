# E3/E4 recovery continuation · 2026-11-12

## Evidence and scope

The user provided a screenshot of GitHub Actions workflow `E4 isolated PostgreSQL recovery rehearsal` run #1, branch `feature/e4-accepted-reintegration`, commit `f5ead6b`, green Success, 22 seconds. This validates the baseline PostgreSQL CI rehearsal at that revision, not the later migration chain or real Supabase Auth/Edge.

The live Supabase lab lists eight registered migrations after the baseline:
1. 20261101111851 lab_invitation_017_validation
2. 20261105124432 e2_internal_function_acl_lab_hardening
3. 20261107031025 e3_siri_lab_credential_and_add
4. 20261107034039 lab_enable_pg_net_for_siri_http_e2e
5. 20261107034437 e3_siri_credential_metadata_listing_lab
6. 20261107231550 siri_indefinite_credentials_revoke_all_minimal_receipt
7. 20261107231801 siri_single_use_pairing_requests
8. 20261107231823 siri_pairing_exchange_service_role_grant_fix

These registered names are **not** proof that matching migration SQL exists in the repository or that a fresh deployment is reproducible.

## Function-source reconciliation

Read-only live inventory: 23 public SQL functions. Function-name comparison with `TEST_MIGRATIONS_ATOMIC_001_016.sql`, `017_invitation_links_REVIEW_ONLY.sql`, `018_acl_normalization_REVIEW_ONLY.sql`, `020_siri_add_REVIEW_ONLY.sql`, `022_e4_list_metadata_REVIEW_ONLY.sql`, `023_e4_list_metadata_rpc_REVIEW_ONLY.sql` finds 17 names. Six additional live definitions have been preserved **verbatim** in `E3_LAB_ONLY_FUNCTIONS_RECOVERY_REFERENCE_DO_NOT_APPLY.sql`:

- `create_siri_pairing`
- `exchange_siri_pairing`
- `list_pending_invitation_links`
- `list_siri_shortcuts`
- `revoke_all_siri_shortcuts`
- `rls_auto_enable`

**Critical qualification:** preserved function definitions are not a deployment migration; no replay order, dependencies, privileges, semantic equivalence, trigger ownership or function-level ACL parity has been established. `rls_auto_enable` is a potentially environment-specific helper. Its necessity must be checked separately.

`tests/recovery/check_live_function_coverage.py` is a deterministic guard on the known six-function gap and prints its details. It is wired into the recovery workflow, but this **new workflow revision has no independently verified green run**.

## Remaining verification gates

1. Determine exact lab-only table/column additions and dependency order for Siri pairing and invitation metadata; distinguish applied 017 from review-only draft.
2. Reconstruct reviewed, ordered, repeatable SQL from the applied migration intent without modifying historical migrations; do not blindly execute captured `SECURITY DEFINER` code.
3. Extend isolated PostgreSQL CI beyond baseline to the actual required E3 objects, RLS/ACL and failure cases; inspect green job results after the changes.
4. Confirm effective `EXECUTE` permissions on privileged functions, including default PUBLIC grants and `service_role` grants; verify with A/B/anon and negative tests.
5. Real Supabase Auth, PostgREST, Edge HTTP and pg_net require separate integration proof. No E4 archive migration has been deployed.
