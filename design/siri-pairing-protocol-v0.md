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

## 2026-11-08 decision checkpoint: security architecture

**Selected for lab prototyping:** single-use short-lived pairing authorization -> server-issued independent per-list, revocable credential -> Shortcuts add endpoint. This credential is *not* the user's Supabase session or password. Never include it in the published template, import questions, QR code, or web URL.

**Credential storage not yet approved:** native Shortcuts file read/write is proven across executions, but an iCloud Drive/Shortcuts file can be accessible to other apps or synced devices depending on OS settings. No claim of Keychain-grade secrecy. Avoid putting live tokens in file until explicit security acceptance; lab test with harmless fixture only. If file is ultimately accepted, require short credential lifetime, list scope, revocation, minimal permissions, clear device-loss guidance, and explicit user disclosure. Do not claim binding to a physical device without cryptographic device attestation.

**Pairing-code UX:** prefer an opaque high-entropy code displayed by PWA and entered once in the imported Shortcut, with explicit pairing approval in the signed-in PWA if code length must be human-friendly. Atomic single-use redemption, expiry, abuse throttling, generic failures, and server audit without secret logging are mandatory. A 6-digit code alone is insufficient without strict rate limits and account confirmation.

**Remaining feasibility gates:** whether the Shortcut can conditionally read an absent credential file, redeem pairing code, save returned token and then use it on later runs; whether Siri voice and lock-screen permissions permit the flow; whether iCloud import carries only neutral actions; how credential renewal works without manually rebuilding the Shortcut. These must be tested before calling the experience one-button.

**Implementation boundary:** draft/prototype only in isolated E3 lab. No production writes, no changes to existing working manual Siri Shortcut, no real secret entered into test Shortcuts until security review.

## 2026-11-08 product decision: non-expiring revocable Siri credentials (supersedes finite-lifetime proposal)

User selected **non-expiring**, per-list, add-only Siri credentials with explicit revocation, rate limiting and quotas. Current lab has 90-day expiry; **decision is not implemented**. Existing draft references to expiry/rotation above are historical proposals, not the selected target.

### Account and recovery UX
- Siri cloud integration requires a signed-in account at enrollment and an authorized cloud list. Local-only lists are **not** supported by this cloud endpoint; never silently expose a local list or imply it is synchronized.
- A Shortcut request authenticates with its own scoped credential, not an active app login session. Requiring login on every voice add would defeat hands-free use and is not selected.
- UI must use plain-language **«Устройства и Siri»** and **«Отключить добавление через Siri»**, not require users to know about tokens. Suspicious items: prominent **«Это добавил не я»** recovery flow: revoke all Siri credentials for affected list/account, preserve legitimate items, explain which device connections will stop, offer safe reconnection. Add transparent recent Siri-add activity metadata (time, device label if reliable, no secrets), and notify about anomalous bursts if feasible.
- Changing/resetting account password **does not automatically revoke separate Siri credentials** in current architecture. Proposal: offer **«Выйти на всех устройствах и отключить Siri»** during suspected compromise; consider optional automatic revoke on password reset only if a reliable server-side event exists. Do not claim it is already implemented or rely on client-only detection. Password changes alone are not a sufficient response to compromised Siri credential.
- Maintain scoped read-only responses: do not expose list contents or internal list revision in Shortcut response; use generic success/denial. Rate limit per credential, per list, per account, and globally; cap list growth to prevent abuse and billing spikes. Detect bulk anomalies.
- Credentials are revocable even if non-expiring. They do not gain new privileges when the app adds read/delete/checkout actions. No purchase execution via Siri credential.

### Tests before release
- Only signed-in list owner can enroll; local-only user gets clear explanation, no silent account creation.
- Revoke-all immediately blocks all Siri credentials but leaves account and list accessible; unauthorized attempts cannot revoke others.
- Password change alone does not falsely indicate Siri access is removed; account-security recovery explicitly includes Siri revoke.
- Abusive writes blocked by quotas; response cannot disclose list contents or revisions; existing items cannot be modified/deleted by Siri token.
- Verify implementation of user-friendly recovery UI and activity visibility in disposable lab. Production untouched.

## 2026-11-08 · Apple Shortcuts one-button feasibility research

Official Apple documentation confirms (a) a shared iCloud Shortcut link opens a review/add flow requiring native user confirmation, and (b) `shortcuts://run-shortcut?name=...&input=text&text=...` can pass text to **an already installed** Shortcut. References: https://support.apple.com/en-az/guide/shortcuts/apdf01f8c054/10.0/ios/27 and https://support.apple.com/en-euro/guide/shortcuts/apd624386f42/ios . Apple's documented `shortcuts://create-shortcut` opens an editor; it is **not** automatic installation: https://support.apple.com/en-gb/guide/shortcuts/apda283236d7/9.0/ios/26 .

**Research conclusion (not yet tested on device):** installation and account pairing are separate steps. iCloud import cannot be assumed to auto-populate private account tokens. Proposed path: one PWA button opens a neutral, prebuilt shared Shortcut; Apple's native confirmation installs it; Shortcut's first run obtains a short-lived single-use pairing capability without user typing. But bridging authenticated PWA state to newly imported Shortcut without exposed bearer secret, manual setup, or a second user action is **not yet proven**. Do not claim one-button acceptance. Investigate Apple-supported handoff (e.g. safe app-associated links, clipboard with consent, or native App Intents); test on real iPhone. A 64-hex pairing code in a URL may leak via history/logs/referrers and is **not approved**. The user's explicit one-button requirement remains a release blocker, not a flexible preference.
