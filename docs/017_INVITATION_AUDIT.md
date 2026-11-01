# Invitation 017 — initial security audit

Status: REVIEW ONLY; not deployed. Date: 2026-11-01.

## Findings

- HIGH: Acceptance uses PostgreSQL transaction-start time for expiration. A transaction waiting on a lock may accept after the 24-hour deadline. Recheck with wall-clock time after locks.
- MEDIUM: Existing list member can consume a one-use link without creating new membership. Reject existing members before consuming.
- MEDIUM: Owner cannot readily revoke an invitation: creation returns a token, revocation requires invitation UUID, and direct table access is denied. Provide a safe owner-only way to identify pending invitations.
- REVIEW: Verify direct table permissions, function execution grants, owner role, hosted extension availability, and bearer-link leakage controls.

## Evidence

Disposable GitHub Actions run 6 passed invitation, race and expiry_revoke jobs. These do not cover all findings. No Supabase changes were made.

## Release decision

Deployment blocked pending fixes, adversarial tests and independent security review.

## Audit progress — 2026-11-01

- User screenshot confirms disposable audit workflow #4 succeeded (21 seconds), including static role privilege checks, owner/outsider scenarios and transaction-delay expiry regression.
- Additional SQL role-execution and concurrent list-lock expiry tests are committed to the feature branch but their run results are not verified.
- Automatic GitHub Actions push trigger was added on the feature branch; the available GitHub connector does not list push-triggered runs, so auto-execution is still unverified. No claims of passing CI should be made without run evidence.
- Still required: confirm automated CI execution, fix any failing tests, inspect hosted Supabase ACL/extension configuration, and obtain independent security review before deployment.
