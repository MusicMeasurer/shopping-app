# E3 Siri direct add — implementation boundary (2026-11-07)

Status: implementation in progress; NOT deployed, NOT accepted.

## User experience
1. Signed-in user chooses an existing verified cloud list in the PWA.
2. User enrolls an iOS Shortcut, receiving a one-time secret scoped to **add only** to that one list. The PWA must not put this secret in a URL.
3. Siri / Shortcuts captures item name, generates an operation UUID and POSTs JSON over HTTPS.
4. Server returns explicit success or failure. Cloud item becomes visible to the existing account synchronization path. No manual import as a normal step.

## Security contract
- A Shortcut cannot inherit the PWA session. Never copy the Supabase account JWT or a service-role key into a Shortcut.
- Shortcut credential is a high-entropy, revocable, list-bound bearer secret. Store only a hash server-side; show secret once during enrollment. Keep it out of URLs, logs and source control.
- Enrollment and revocation require a verified signed-in account and **list ownership**; revoke on owner/list deletion and on explicit user action.
- Server checks credential validity, expiry, revocation, list ownership and list existence **on every write**. No reading, editing, deleting or list enumeration via Siri token.
- Server-side rate limits and request-size limits are mandatory. Use HTTPS POST body and Authorization header; no token in query parameters.
- Reuse the versioned mutation and operation receipt protocol, with stable operation ID and item ID to deduplicate ambiguous retries. Do not generate a different ID when retrying the same request.
- Server validation must match the existing 120-character item-name database limit.
- Shortcut offline behavior: show explicit failure; do not claim durable offline Siri queue until implemented and tested.

## Delivery gates
- Implement SQL credential lifecycle and server handler in isolated branch, with unit tests and negative authorization tests.
- Test in disposable Supabase only, including stolen/revoked/expired token, cross-list access, repeated operation, rate limiting and owner deletion.
- Verify browser list synchronization after Siri add, not just HTTP 200.
- User approval required before applying migrations, secrets or function deployment to production.
- iPhone lock-screen Shortcut acceptance and offline PWA recovery remain user-performed gates.

## Current progress
- Strict request validation and tests are in `src/data/siri-add-request.ts` and `src/data/siri-add-request.test.ts`.
- Draft server endpoint and review-only enrollment/revocation SQL are now committed. No deployment, live credential issuance, or production change has been made. The SQL and endpoint still require disposable-lab integration and security verification.
