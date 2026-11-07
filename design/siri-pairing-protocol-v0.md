# Siri pairing protocol v0 — review draft, NOT deployed

Date: 2026-11-08. Target: disposable E3 lab only.

## Critical distinction
Apple Import Questions are parameter-substitution prompts at import time, **not** a secure authenticated channel from a PWA. A user-specific bearer token must never be published inside a shared iCloud Shortcut. A URL that contains a bearer token is not acceptable.

## Proposed minimum viable flow
1. Signed-in user chooses a cloud list in the PWA and taps **Подключить Siri**. The PWA requests a **single-use pairing code**, scoped to that user/list, with 5-minute expiry. The PWA displays a short code in human-readable form and offers the neutral iCloud Shortcut template.
2. The user confirms importing the template. The Shortcut's first run asks for that short code **once**; it posts it to a dedicated HTTPS exchange endpoint, which atomically consumes it and issues a **device credential** restricted to the selected list.
3. The Shortcut stores the credential **only in its private action configuration**, not in iCloud template, shared link, logs, or PWA local storage. Subsequent invocations prompt for the shopping item and POST directly to siri-add using the scoped credential.
4. The PWA displays pairing state and permits immediate credential revocation. Renewal must be possible without editing Shortcut actions. If Shortcuts cannot securely persist the exchanged secret with supported native actions, STOP and revise the flow; do not ship a misleading 'one button' claim.

## User-experience honesty
This flow is **not literally one tap**: Apple requires user confirmation for Shortcut import and the first-run code. Product target is one obvious **Подключить Siri** entry point and no HTTP/JSON editing. A genuine zero-code one-tap enrollment is unproven; do not promise it.

## Server-side pairing rules
- Pairing code: generated with cryptographically secure randomness; use >= 80 bits entropy if encoded as a non-human-readable string. If using a short human-typed code, rate-limit guesses, enforce per-user and per-IP throttling, single use, short expiry, and limited outstanding codes. Never return an account or list identifier to unauthenticated clients before successful exchange.
- Store only a keyed hash of pairing code at rest; expire and consume atomically under row lock / single SQL transaction. Verify caller's authenticated account and list access at code creation; bind the resulting credential to the authorized account/list snapshot.
- Exchange endpoint does not accept caller-supplied list IDs as authority. Never use user-editable JWT metadata to authorize access. Do not expose service-role key or database privileged functions to unauthenticated clients.
- Exchange responses: Cache-Control no-store; never log tokens or pairing codes; generic errors; abuse limits. CORS, replay and CSRF posture reviewed for PWA initiation and Shortcut exchange separately.
- Credential: random high-entropy secret, hashed at rest, per-list, revocable, finite expiry. Current lab credential lifetime 90 days. Design renewal before expiry and clear failure messaging.
- Authorization: token for A/list A must be rejected for B/list B, even if user B is signed in elsewhere. A stolen bearer token may still add to list A until revoked: do not claim device binding by mere issuance.
- Retry behavior: current lab siri-add generates random operationId when omitted, so duplicated POSTs may duplicate items. Fix retry idempotency before release.

## Lab acceptance (no production writes)
- A code created by A can be consumed exactly once; expired/invalid code rejected without information leak.
- B cannot initiate pairing for A's list; credential A cannot mutate B's list.
- Concurrent exchange of same code: one succeeds, one fails.
- Revoke/expire credential: future adds rejected.
- Retry same operation ID: one item; verify no double creation.
- iPhone: import neutral template, enter code on first run, invoke Siri, add item, restart iPhone and retry; verify whether credential survives without being exposed on sharing.
- Security review of RLS, function grants and privileged operations, plus lab cleanup.

## Open feasibility blocker
Shortcuts may not be able to persist an exchange-returned credential into a reusable, secret action parameter without additional user editing or a third-party app. This must be proven on a real iPhone before implementation. Alternatives: a native iOS App Intents integration or a consciously less seamless, explicitly described setup. Do not collect or publish user token to test feasibility.
