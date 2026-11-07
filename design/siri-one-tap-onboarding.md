# Siri onboarding — installation without manual action editing

Status: design / not implemented. Scope: disposable E3 preview only; production unchanged.

## User-facing acceptance
1. Signed-in user selects a cloud list and taps **Подключить Siri**.
2. iOS opens a prebuilt, vetted Shortcut and the user confirms installation. No manual editing of URL, JSON, HTTP headers, list UUID, or token.
3. The installed Shortcut asks for an item and adds it to the selected list. Verify on physical iPhone, including lock-screen behavior.
4. Setup/renewal/revocation is understandable and does not expose a bearer secret in a publicly shared template.
5. Second account/device cannot use another account's credential; repeated network requests do not create duplicate items.

## Platform constraint
A PWA cannot silently create or install Apple Shortcuts or register App Intents. An iCloud-shared Shortcut can be opened for user-confirmed import, but its creation/publication requires Apple Shortcuts on an Apple device and an actual iCloud sharing URL. Do not invent such a URL or claim automatic installation.

## Security design gate (unresolved)
Never embed a user's token in the shared Shortcut, URL query string, analytics, or logs. Do not ask users to manually paste bearer tokens in the target flow. Consider a one-time, short-lived pairing code with server-side exchange, binding a per-device credential to the authenticated account and selected list; review Shortcuts import/setup-question limitations and the exact UX before implementing. Token expiry/rotation must not require rebuilding the Shortcut. Review credential theft and replay threats. Preserve explicit operation IDs for idempotent retries or implement a sound equivalent.

## Implementation sequence
- Obtain and validate a neutral iCloud Shortcut template using an Apple device (user action required).
- Prototype secure pairing in isolated Supabase lab, including expiry, single-use, cross-account negative tests.
- Build a PWA **Подключить Siri** entry point and clear confirmation/status; do not enable an inert button before template and pairing are ready.
- Run end-to-end tests on real iPhone, including repeat, revoked token, expired token, lock screen, offline/online.
- Update canonical requirements/architecture/roadmap **only in main/docs** through controlled documentation workflow; no production release without approval.

## Current proof
Manual iPhone Shortcut POST to lab `siri-add` returned a receipt and test item appeared in the test cloud list. This does not validate onboarding, Siri voice invocation, or automatic token renewal.
