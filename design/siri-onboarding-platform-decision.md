# Siri onboarding platform feasibility — decision gate

Date: 2026-11-08. Status: **research conclusion / decision pending**. No production deployment.

## Non-negotiable acceptance
A signed-in user presses **«Подключить Siri»** once, with only unavoidable iOS system confirmations. No editing Shortcut actions, no entering codes, no copy/paste, no HTTP header/JSON setup. Siri must add to the selected cloud list with least-privilege, revocable credentials. The user already has a PWA preview and manually working test Shortcut; neither proves one-button onboarding.

## Official Apple findings

1. Apple Shortcuts iCloud sharing distributes a ready-made Shortcut, but recipient reviews and adds it; import questions require recipient answers. Neither documents automatic authenticated account-specific credential injection into a newly imported Shortcut.
   - https://support.apple.com/en-lk/guide/shortcuts/-apdf01f8c054/ios
   - https://support.apple.com/en-mide/guide/shortcuts/apdf330fd3a0/ios
2. `shortcuts://run-shortcut?name=...&input=text&text=...` supplies input to a Shortcut **already in the user's collection**, not an install operation.
   - https://support.apple.com/en-au/guide/shortcuts/apd624386f42/9.0/ios/26
3. `shortcuts://create-shortcut` opens an editor. It does not install a preconfigured Shortcut.
   - https://support.apple.com/en-ie/guide/shortcuts/apda283236d7/ios
4. Native **App Intents / App Shortcuts** expose app functionality to Siri and Shortcuts; Apple says App Shortcuts become available when the native app is installed, without separate registration or Shortcut import.
   - https://developer.apple.com/documentation/appintents
   - https://developer.apple.com/design/human-interface-guidelines/app-shortcuts
   - https://developer.apple.com/videos/play/wwdc2024/10210/
5. Apple documents native App Intents testing and Shortcuts verification:
   - https://developer.apple.com/documentation/appintents/verifying-your-app-intents-implementation

## Options

| Route | What is verified | What is unproven / cost | Acceptance |
|---|---|---|---|
| PWA + iCloud Shortcut | Shared Shortcut install confirmation; URL launch with text for already installed Shortcut; lab server pairing endpoint works | Secure *automatic* authenticated handoff to newly installed Shortcut, persistence, and zero manual steps are **not demonstrated** | **Blocked** until actual iPhone proof |
| Native iOS companion + App Intents | Apple officially supports Siri exposure immediately on app installation; app can implement own authentication and credential lifecycle | Requires Swift/iOS build, code signing, device installation, release/distribution plan, native security and lock-screen tests. May entail Apple developer account cost for distribution | **Technically stronger candidate**, but not yet built or device-tested |

## Recommendation / engineering gate

Do **not** ship a fake «Подключить Siri» button in PWA or imply that copying a token or import question satisfies acceptance. Keep PWA cloud backend and tests intact. Before committing to native implementation, verify availability of macOS/Xcode build+signing and distribution route, plus user's willingness to install a native companion. If unavailable, a no-secret harmless iPhone experiment may test Shortcut handoff, but only with a complete Russian-language instruction validated against `docs/06_IOS_SHORTCUTS_RU_REFERENCE.md`; it cannot establish security of real bearer tokens.

A possible native design: iOS app signs in to same Supabase cloud account, exposes `AddShoppingItemIntent` with a text parameter, selects authorized list from app settings, invokes backend using an app-held authenticated session or scoped device credential, and supports Siri/lock-screen. No assumption that PWA can register App Intents. **This is a proposed design, not implemented functionality.**

## Release gates

- User approves architecture and distribution constraints before shifting product architecture.
- Native intent discovered in Siri/Shortcuts on real iPhone, with Russian locale and correct phrase behavior.
- End-to-end add, cross-account denial, revoked access, offline handling, duplicate retries, lock screen, no secrets in logs or shared URLs.
- Verify cloud/list permissions, session recovery, and removal of credentials when user signs out or reports compromise.
- Production remains untouched until explicit approval.
