# 017 · Shared-list invitations — REVIEW ONLY
Status: design proposal, NOT SQL migration, NOT deployed or tested. FR-010 follows local MVP.

## Existing product requirements
Recipient must accept invitation before gaining access; outsiders cannot access shared lists. Invitations are recipient-bound. Ownership transfer must atomically revoke pending invitations.

## Proposed server protocol
- Owner-only issuance to a specific authenticated recipient ID, without public account enumeration.
- Invitation record: id, list_id, recipient_id, inviter_id, expires_at, accepted_at, revoked_at; no plaintext bearer secrets.
- Owner creates invitation via controlled RPC; server locks active list before owner and duplicate checks.
- Recipient accepts via controlled RPC; lock list first, then invitation; verify recipient, current owner, expiration and non-revocation; create membership and mark accepted atomically.
- Owner cancels invitation via RPC; acceptance after cancellation must fail.
- Transfer ownership locks list and revokes pending invitations in same transaction. Update existing transfer RPC only after tests.
- Member removal and invitation acceptance must share list-row lock ordering; accepted invitation cannot regrant membership after removal.
- Deny direct client writes to invitation and membership tables; audit EXECUTE privileges and SECURITY DEFINER search paths.
- Ensure concurrent acceptance cannot duplicate membership; negative tests verify DB state as well as error response.

## Open product decisions
1. DECIDED: shareable invitation link. Link acceptance requires sign-in and must be bound to the intended recipient account; define how recipient identity is established without account enumeration before SQL implementation.
2. Proposed expiration 7 days (not yet approved).
3. Owner-only invitations versus delegation.
4. Notification and invitation discovery UX.

## Acceptance gates
Static security review; rollback-only SQL tests including races; real Auth A/B/C HTTP tests in disposable lab after explicit temporary API enablement; verify cleanup; close API. No production deployment.

## Repository cross-check
Existing 009 transfer function has no pending-invite revocation. PR #1 file inventory contained no executable 017 migration. This document does not replace or claim to review missing SQL.

## Decision 2026-11-01
User selected invitation by link, not email. Link is a delivery mechanism, not proof of authorization: authentication and recipient binding remain mandatory. Never accept a token alone as sufficient for membership. Token must be high-entropy, expire, be revocable and single-use, and be stored as a hash. Exact recipient binding and onboarding UX need design review.

## Approved product decision 2026-11-01 — first authenticated claimant
- Invite link is not bound to an email address or preselected account. Any signed-in user may claim it, including someone who registers after receiving it.
- Opening or previewing the link MUST NOT consume it. Only an explicit authenticated Accept action claims it.
- First successfully committed acceptance wins. Acceptance atomically creates membership and consumes the token, with concurrency-safe locking and uniqueness.
- Link is a bearer capability: a forwarded/stolen link can be claimed by an unintended person. UI must explain this; owner can revoke before acceptance and remove member after acceptance.
- Use cryptographically random high-entropy token, store only its hash, short expiry (7 days proposed, not yet confirmed), never log token or include it in analytics/referrer URLs.
- Supersedes prior recipient-bound proposal; recipient account/email matching is NOT required.
