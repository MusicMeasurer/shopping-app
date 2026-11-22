# Invitation links 017 — application and API security requirements

**Status:** design requirements, not implemented. SQL candidate 017 remains REVIEW ONLY; no hosted deployment authorization.

## Token handling

- Invitation bearer token is a secret: 32 random bytes encoded as 64 lowercase hex characters. Whoever has the link can claim it first while valid, after authenticating and explicitly accepting.
- Generate the share link only in response to the owner's explicit action. Never place the raw token or full URL in application analytics, structured logs, error reports, crash telemetry, support tickets, or debugging output.
- Never include token in push notifications, email subjects, referral metadata or third-party link-preview endpoints. Avoid third-party URL shorteners and tracking redirects.
- Prefer universal links with a dedicated path, no third-party redirect; prevent automatic acceptance on link open. The user must sign in and confirm acceptance.
- In the app, remove the token from navigation state once accepted, revoked, expired, or dismissed; avoid persistent plaintext storage. Do not copy to clipboard automatically.
- Never transmit the token to an unrelated service. TLS required. No token echoed in errors. Use a generic invalid/expired/revoked message to avoid disclosing state.
- Ensure the iOS share sheet is invoked only on explicit user request; sharing is intentional exposure to chosen recipients.

## Abuse prevention and monitoring

- SQL candidate enforces maximum 10 pending, unexpired invitations per list under the shopping-list row lock. This is a resource bound, **not** request-rate limiting.
- Before enabling public RPC traffic, implement and verify authenticated per-user and per-list issuance throttling at the API gateway/Edge layer (proposed policy: 5 create attempts per user per hour; 20 per list per day). Specify enforcement key, trusted identity, 429 behavior, and behavior across multiple edge instances.
- For acceptance, apply per-account and per-IP throttling at the gateway, with careful treatment of shared networks; proposed initial ceiling 30 failed attempts per account per hour, subject to monitoring and false-positive review.
- Alert on spikes of rejected creates and accepts, without logging tokens or token hashes. Retain only aggregate counters and safe request metadata.
- Do not rely on client-only throttling. Directly exposed SECURITY DEFINER RPCs must be protected server-side; do not claim Supabase PostgREST natively enforces the proposed policy without verifying the deployment mechanism.

## Release gates

1. Confirm deep-link and share UI redaction by tests or manual review.
2. Implement server-side rate limits, or deliberately accept and document residual abuse risk with a bounded rollout.
3. Verify actual hosted JWT/RPC role permissions and RLS behavior with multiple real accounts.
4. Verify invitation creation, accept, expiry, replay, revoke, ownership transfer, account deletion, and concurrency.
5. Require explicit approval before applying migration 017 to disposable hosted Supabase; production requires a separate approval.
