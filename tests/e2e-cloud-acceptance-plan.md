# E3/E4 authenticated browser acceptance — preparation (not yet executed)

Scope: browser UI + authenticated cloud account + isolated Supabase-compatible test backend. Never run against accepted/production projects. Keep account A/B isolation and crash/replay cases in their separate existing suites; they are outside the requested eight-case browser matrix.

## Environment prerequisites
- Disposable, isolated test backend with E3 list binding, E4 list metadata, archive snapshot and atomic completion RPC migrations installed and validated.
- Two temporary authenticated users (A and B) with isolated test data; do not use real credentials.
- Browser test fixture capable of signing in user A and seeding owned remote lists, local IndexedDB mappings and reconciled remote/local items with matching versions.
- Cleanup of test users, lists, receipts and archives after each run; assert no residual user data.
- Mobile WebKit and mobile Chromium, screenshots/traces on failure.

## Cases (browser-driven, authenticated A)
1. **Cancel confirmation**: add two synced items, click marked-only, dismiss native confirm, verify no RPC call, no local/remote/archive mutation.
2. **Marked only**: mark one of two synced items, complete, verify archive contains only purchased item, active list empty, no duplicate archive after reload.
3. **All purchased**: complete synced list containing unmarked items, verify all archived, active list empty.
4. **None purchased**: complete synced list, verify active list empty and no archive snapshot.
5. **Permanent**: verify completed permanent list remains available and empty after reload and new items can be added.
6. **Oneoff**: verify completed oneoff disappears from active list navigation and remains in cloud archive after reload.
7. **Restart**: close and reopen a fresh browser page/context with preserved storage state, verify durable archive and list state.
8. **Offline**: disconnect before completion; verify no false success or lost local data, reconnect and verify safe completion/reconciliation.

## Required evidence
- Every case reports browser project, pass/fail, test run URL and trace on failure.
- Assert UI state AND remote database state, not just button visibility or RPC mock calls.
- Explicitly report unsupported functionality (quantity/unit preflight, dynamic account lists) as failures or blockers, never silently skip.
- Do not count local guest E4 tests as authenticated E3/E4 acceptance.
- No main, production or accepted-cloud changes without explicit permission.
