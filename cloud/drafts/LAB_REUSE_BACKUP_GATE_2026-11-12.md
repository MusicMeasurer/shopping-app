# Lab reuse decision gate — 2026-11-12

Status: **NOT YET CLEARED FOR RESET OR DELETION**. No hosted changes made. Agreed scope is a low-cost, best-effort preservation of development structure and rerunnable tests, **not a full backup**.

## Verified
- Two existing free Supabase projects are active and healthy: `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`) and `shoppingapp-security-lab` (`tdcrtwpewbngoermckmx`), both PostgreSQL 17, eu-west-3.
- Migration lab has 8 registered applied migration entries and 2 active Edge Functions: `siri-add` v2 and `siri-pair` v1, both `verify_jwt=false`. Those are **not** an export of deployable configuration.
- Security lab lists no deployed Edge Functions. Its migration/SQL inventory was not obtained in this pass (database connection timed out).
- Read-only schema/function/policy/trigger/grant/extension inventories for migration lab already saved in `cloud/drafts/E4_LAB_RECOVERY_INVENTORY_2026-11-12.md` and `E4_LAB_SCHEMA_METADATA_2026-11-12.md`; 5 Siri app functions were restored in isolated PostgreSQL CI.
- User confirmed expanded CI green, but no verified full Supabase restore.
- Historical test records need not be preserved per agreed scope.

## Agreed best-effort preservation coverage and limitations
| Component | Evidence | Status |
|---|---|---|
| Public schema metadata, SQL function definitions, RLS, grants, triggers | GitHub inventory snapshots | Captured, not proven exact reproducible |
| Baseline and E3 SQL | Repo drafts and CI restore | Partial isolated PostgreSQL proof |
| Siri Edge source/config | Captured inventory | Source captured, redeployment not proven |
| Migration history | Eight registered version/name pairs | Captured; not full applied SQL |
| Auth schema/settings/users | No full dump; Auth shim in CI | Not recoverable from current evidence |
| Secrets and service configuration | Intentionally excluded from repo | Must be reconfigured; never store secrets in Git |
| Storage objects and settings | Not inventoried in this checkpoint | Unknown |
| Existing test data | Explicitly not required | Can be regenerated |

## Decision and minimum remaining work
1. Inventory `shoppingapp-security-lab` read-only (tables, functions, migration history, roles, RLS, and test dependencies) and compare both candidates.
2. Select the lower-cost-to-reconstruct lab based on evidence, not on name alone.
3. Preserve only the development-critical structure, functions, ACL/RLS, deployment instructions and repeatable tests available through existing free tools. Do **not** require or pursue a full database backup, full schema/roles dump, historical data export, or a new paid environment.
4. Prove that the **specific app dependencies being discarded** can be redeployed and exercised in an isolated environment, or explicitly accept residual loss. PostgreSQL-only CI does not verify Supabase Auth, PostgREST, Edge, or dashboard configuration.
5. Only after a documented gate and explicit user authorization perform any reset, deletion, or destructive migration. Do not provision a paid third project.

This is a preparation checkpoint, **not** a claim of full backup or permission to reset. Evaluate sufficient reproducibility for the agreed development scope, not full infrastructure parity.
