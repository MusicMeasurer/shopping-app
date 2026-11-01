# Migration 017 — release readiness gate (2026-11-01)

**Status: HOLD — production deployment NOT authorized.** Scope: invitation-link migration `cloud/drafts/017_invitation_links_AUDIT_FIX_REVIEW_ONLY.sql` on `feature/cloud-schema-draft`. No branch merge or production schema change performed.

| Gate | Evidence | Status |
|---|---|---|
| Exact SQL reviewed and version identified | feature branch draft 017, hosted lab applied unchanged | PASS for tested revision; freeze exact commit SHA before release |
| Disposable SQL regressions incl. upgrade fixture and rollback-only row snapshot | **10/10 green**, [run 41302559910](https://github.com/MusicMeasurer/shopping-app/actions/runs/41302559910), commit `4696aac94e9804425edcb160df2b0df3193707a0` | PASS (PostgreSQL Auth shim) |
| Hosted Supabase installation | isolated `shoppingapp-migration-lab` migration `20261101111851`, 4 invitation RPCs and validated constraints | PASS (lab) |
| RLS/grants and referential integrity | anon issue/accept denied, authenticated issue allowed, invitation direct SELECT denied; no orphan rows | PASS for sampled permissions |
| Pre/post field-level data snapshot | New disposable PostgreSQL rollback-only rehearsal compares existing public row multisets, PASS in 10/10 CI. Historical hosted lab had counts only | PASS in disposable CI; **NOT PROVEN in hosted lab** |
| Existing RPC behavior after 017 | signatures confirmed; no post-upgrade behavioral regression against real Auth | OPEN |
| Real Auth/JWT HTTP invitation acceptance | prepared `tests/http/test_invitation_rpc.py`; not run | OPEN; separate integration gate |
| Baseline-vs-delta security advisors | hosted lab advisor: four RLS-no-policy informational findings, Auth leaked-password protection warning; no pre-017 advisor baseline | OPEN (classification recorded, delta not provable) |
| Backup, recovery, rollout and rollback | no target production project confirmed, no tested recovery plan | OPEN |
| Independent security review and release approval | not demonstrated for exact release candidate | OPEN |
| Invitation acceptance product rule | User explicitly confirmed: first authenticated claimant, **only if not already a member of the list**; no recipient binding. SQL 017 checks membership and rejects existing members | DECIDED; behavior verified in SQL logic, real HTTP gate still open |

## Release order

1. Confirm which database is production; do not infer from project name. Obtain explicit approval before any production operation.
2. Freeze migration file and exact commit; preserve approved invitation contract: first authenticated non-member may claim a valid single-use link; existing members and the owner cannot claim it. Add/retain negative tests for both cases.
3. Disposable CI row snapshot rehearsal is PASS. If a new hosted rehearsal is required, capture pre/post data, functions, policies, grants and advisor baseline; existing hosted lab cannot retrospectively supply pre-migration snapshots.
4. Run real Auth HTTP checks on a lab with disposable fixtures and cleanup. Data API may require explicit temporary enablement; do not enable without checking current state and agreeing on the test window. No secrets in GitHub.
5. Independent security review of release candidate and evidence-based closeout.
6. Verify backup/restore capability appropriate to target plan; stage migration, validate, then request separate production go/no-go.

**No new confirmed exploit in 017 is established by this gate.** OPEN means unverified, not necessarily vulnerable. The separate Auth password-protection advisor warning is not an 017 SQL regression. Do not repeatedly re-audit passed checks absent code changes or new evidence.

Reference: [Supabase Production Checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
