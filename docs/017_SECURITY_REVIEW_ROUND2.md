# Migration 017 — security review, round 2 (2026-11-01)

**Scope:** static review of `017_invitation_links_AUDIT_FIX_REVIEW_ONLY.sql` and the invitation audit regression/permission tests. This is an internal review, **not** an independent external security assessment or hosted execution. **Do not deploy.**

## Findings

### F1 — HIGH operational: user deletion can be blocked by invitation foreign keys

`list_invitation_links.created_by` and `accepted_by` reference `auth.users(id)` without an `ON DELETE` action (default RESTRICT/NO ACTION). Historical accepted invitations remain after a user leaves a list. An owner transfer revokes outstanding links but does not delete them. Deleting such an auth user may fail due to the invitation history. This is inconsistent with the cascade semantics on shopping_lists/list_members and needs an explicit retention/deletion policy.

**Fix proposal:** choose and document a lifecycle policy: e.g. `created_by` / `accepted_by` nullable with `ON DELETE SET NULL` and revised integrity constraints, or deliberate deletion of invitation records during account deletion. Do not change blindly: consider audit retention, privacy and whether the owner deletion already cascades the list.

**Regression:** create invite, transfer ownership, delete original owner; separately accept invite, leave list, delete accepting user; assert the chosen lifecycle semantics.

### F2 — MEDIUM abuse resistance: no issuance quotas or rate limits

An owner may create unbounded invitation records. A token is 256-bit random, so online guessing is not practically viable, but create/accept RPC traffic can still exhaust resources or generate unwanted records. The draft does not implement per-list outstanding-link limits, creation throttling, or API-side request controls.

**Fix proposal:** add a bounded outstanding-link policy and a separately verified API/edge rate-limit strategy before exposing the RPCs publicly. Do not assume RLS protects SECURITY DEFINER from request floods.

### F3 — MEDIUM privacy: bearer token handling remains outside SQL scope

The create RPC returns the raw token. SQL stores only a digest, but application deep links, logs, crash reports, analytics, link previews, clipboard history, and support tooling can expose the bearer token. The SQL cannot verify these paths.

**Fix proposal:** document token transport and redaction requirements; ensure no token in analytics or server logs; verify deep-link handling, previews, and explicit acceptance UI before release.

### F4 — LOW correctness: timestamp consistency and UI expiry semantics

Creation/acceptance uses `clock_timestamp()`, while revocation/transfer use `now()`. This does not directly bypass revocation (revoked_at is checked for null), but timestamps can look earlier than an actual action after lock waits. Align timestamps for forensic accuracy, with regression tests.

### F5 — REVIEW: hosted RLS/API and ownership trust boundary not yet exercised

Hosted read-only preflight confirmed RLS flags, crypto functions and grants on existing tables, but not real JWT/PostgREST behavior. SQL tests simulate `request.jwt.claim.sub`; they cannot certify the complete hosted auth boundary. The `SECURITY DEFINER` function owner is privileged, so hosted role execution must be tested with distinct real authenticated accounts.

## Positive controls verified in draft / disposable CI

- High-entropy token; only SHA-256 hash persisted.
- No direct table privileges for anon/authenticated; explicit RPC grants.
- Locked list before invitation row; wall-clock expiry rechecked after lock.
- Single-use, revocation, owner transfer invalidation, existing-member rejection.
- Five disposable CI checks reported success for commit `a98405b`; published to PR #1. This is not a hosted security certification.

## Decision

**BLOCKED:** resolve F1 and specify F2/F3 controls; add lifecycle tests and rerun disposable CI. Hosted 017 execution still requires explicit user approval and independent review. No production changes.
