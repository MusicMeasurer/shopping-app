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
