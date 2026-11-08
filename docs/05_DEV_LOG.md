# ShoppingApp — development log

**Canonical location:** GitHub. Entries distinguish observed evidence, implementation and pending verification. Historical records below are a reconstructed summary from verified commits and CI comments, not a claim of contemporaneous entries.

## 2026-11-01 — invitation migration 017 audit and remediation

**Scope:** draft feature branch `feature/cloud-schema-draft`; PR #1 remains draft. No migration 017 deployment to hosted Supabase or production was authorized.

1. **Read-only hosted preflight:** user supplied disposable Supabase SQL Editor results. PostgreSQL 17.11; pgcrypto in extensions; RLS enabled on shopping_lists/list_members; invitation table and RPCs absent; transfer_list_ownership owned by postgres, SECURITY DEFINER, anon EXECUTE denied and authenticated EXECUTE allowed. Evidence captured in `docs/017_HOSTED_SUPABASE_PREFLIGHT.md` at commit `c8b64f4`. This does not prove actual hosted JWT/RLS row isolation.
2. **Security review:** `docs/017_SECURITY_REVIEW_ROUND2.md` at `8dd645d` documented auth-user deletion FK risk, unbounded invitation issuance, bearer-token exposure risk, timestamp consistency and hosted integration gaps.
3. **Account deletion remediation:** draft 017 invitation creator/acceptor references changed to `ON DELETE CASCADE` (`7c6a1e4`). Disposable regression added (`7cfb032`) and CI wired (`1c7a08f`). First run failed because test attempted to delete a current list owner without transfer. Test corrected (`48ff559`); all six checks succeeded: https://github.com/MusicMeasurer/shopping-app/actions/runs/41278685524 . No hosted account-deletion test performed.
4. **Pending invitations cap:** draft 017 now limits to 10 pending, unexpired links per list while holding a list row lock (`5af881c`). Regression added (`198e46a`), CI wired (`d273a84`). All seven checks succeeded: https://github.com/MusicMeasurer/shopping-app/actions/runs/41278785503 . This is not API request-rate limiting.
5. **Revocation timestamps:** changed to `clock_timestamp()` in draft (`a66db96`). **A successful CI report specifically for this later revision has not yet been verified in this journal.**
6. **Token and API controls:** requirements documented in `docs/017_INVITATION_SECURITY_OPERATIONS.md` (`8682f68`). Token redaction and server-side throttling are requirements, **not implemented or verified**.

7. **Timestamp consistency follow-up:** issuance now records both `created_at` and `expires_at` from the same post-lock wall-clock instant (`a65b68d`). This prevents a long-running transaction from producing a created_at/expiry inversion. CI result for this commit pending verification.

8. **CI confirmation:** the timestamp fix at `a65b68d` passed all seven disposable PostgreSQL checks (run https://github.com/MusicMeasurer/shopping-app/actions/runs/41279184911). The later documentation-only commits do not change SQL test evidence.
9. **Hosted test preparation:** documented a 15-case approval-gated Supabase Auth/JWT/RPC/RLS and app-security test matrix in `docs/017_HOSTED_INTEGRATION_TEST_PLAN.md` (`20ae3e8`). Plan only; not executed; Data API remains OFF.

10. **Pending cap boundary regressions:** extended the disposable test to confirm revoked and expired links free capacity (`39ede11`). CI result not yet verified. The pending cap is still not a request-rate limit.

11. **CI failure and repair:** expanded pending-limit test at `39ede11` failed due to malformed PL/pgSQL dollar quoting in test source (run https://github.com/MusicMeasurer/shopping-app/actions/runs/41279338542), not a demonstrated application defect. Corrected quoting at `8fdb019`; rerun outcome pending verification.

12. **Server-side issuance quota candidate:** draft 017 now limits creation to 20 invitations per list per rolling 24 hours (including revoked/expired), serialized under the list row lock (`f6fe4db`). Regression extended to test repeated revoke/create (`a7f113c`, refined `50f6071`). CI outcome pending verification. This bounds per-list issuance but is **not** a per-user/IP request-rate limiter; acceptance floods still need gateway/edge protection.

13. **Repeated CI failure diagnosed:** runs for `f6fe4db`, `a7f113c`, and `50f6071` failed on the same malformed `DO # ShoppingApp — development log

**Canonical location:** GitHub. Entries distinguish observed evidence, implementation and pending verification. Historical records below are a reconstructed summary from verified commits and CI comments, not a claim of contemporaneous entries.

## 2026-11-01 — invitation migration 017 audit and remediation

**Scope:** draft feature branch `feature/cloud-schema-draft`; PR #1 remains draft. No migration 017 deployment to hosted Supabase or production was authorized.

1. **Read-only hosted preflight:** user supplied disposable Supabase SQL Editor results. PostgreSQL 17.11; pgcrypto in extensions; RLS enabled on shopping_lists/list_members; invitation table and RPCs absent; transfer_list_ownership owned by postgres, SECURITY DEFINER, anon EXECUTE denied and authenticated EXECUTE allowed. Evidence captured in `docs/017_HOSTED_SUPABASE_PREFLIGHT.md` at commit `c8b64f4`. This does not prove actual hosted JWT/RLS row isolation.
2. **Security review:** `docs/017_SECURITY_REVIEW_ROUND2.md` at `8dd645d` documented auth-user deletion FK risk, unbounded invitation issuance, bearer-token exposure risk, timestamp consistency and hosted integration gaps.
3. **Account deletion remediation:** draft 017 invitation creator/acceptor references changed to `ON DELETE CASCADE` (`7c6a1e4`). Disposable regression added (`7cfb032`) and CI wired (`1c7a08f`). First run failed because test attempted to delete a current list owner without transfer. Test corrected (`48ff559`); all six checks succeeded: https://github.com/MusicMeasurer/shopping-app/actions/runs/41278685524 . No hosted account-deletion test performed.
4. **Pending invitations cap:** draft 017 now limits to 10 pending, unexpired links per list while holding a list row lock (`5af881c`). Regression added (`198e46a`), CI wired (`d273a84`). All seven checks succeeded: https://github.com/MusicMeasurer/shopping-app/actions/runs/41278785503 . This is not API request-rate limiting.
5. **Revocation timestamps:** changed to `clock_timestamp()` in draft (`a66db96`). **A successful CI report specifically for this later revision has not yet been verified in this journal.**
6. **Token and API controls:** requirements documented in `docs/017_INVITATION_SECURITY_OPERATIONS.md` (`8682f68`). Token redaction and server-side throttling are requirements, **not implemented or verified**.

7. **Timestamp consistency follow-up:** issuance now records both `created_at` and `expires_at` from the same post-lock wall-clock instant (`a65b68d`). This prevents a long-running transaction from producing a created_at/expiry inversion. CI result for this commit pending verification.

8. **CI confirmation:** the timestamp fix at `a65b68d` passed all seven disposable PostgreSQL checks (run https://github.com/MusicMeasurer/shopping-app/actions/runs/41279184911). The later documentation-only commits do not change SQL test evidence.
9. **Hosted test preparation:** documented a 15-case approval-gated Supabase Auth/JWT/RPC/RLS and app-security test matrix in `docs/017_HOSTED_INTEGRATION_TEST_PLAN.md` (`20ae3e8`). Plan only; not executed; Data API remains OFF.

10. **Pending cap boundary regressions:** extended the disposable test to confirm revoked and expired links free capacity (`39ede11`). CI result not yet verified. The pending cap is still not a request-rate limit.

11. **CI failure and repair:** expanded pending-limit test at `39ede11` failed due to malformed PL/pgSQL dollar quoting in test source (run https://github.com/MusicMeasurer/shopping-app/actions/runs/41279338542), not a demonstrated application defect. Corrected quoting at `8fdb019`; rerun outcome pending verification.

12. **Server-side issuance quota candidate:** draft 017 now limits creation to 20 invitations per list per rolling 24 hours (including revoked/expired), serialized under the list row lock (`f6fe4db`). Regression extended to test repeated revoke/create (`a7f113c`, refined `50f6071`). CI outcome pending verification. This bounds per-list issuance but is **not** a per-user/IP request-rate limiter; acceptance floods still need gateway/edge protection.

 in the test. Earlier JS string replacement interpreted `$` as a replacement metacharacter and did not fix the file. Repaired via function-based replacement in `3f35629`, verified zero malformed delimiters in fetched source. Awaiting CI. No hosted writes.

14. **CI fixture correction:** run https://github.com/MusicMeasurer/shopping-app/actions/runs/41279899947 failed because the simulated expired row violated `expires_at > created_at`; the database correctly rejected it. Adjusted disposable fixture to backdate both timestamps (`fe9cadd`). New CI result pending. No hosted changes.

15. **Role-safe regression:** run https://github.com/MusicMeasurer/shopping-app/actions/runs/41280564663 failed because the new test queried the invitation table under `authenticated`, which correctly lacks direct SELECT. Updated the daily quota test to use only owner-authorized RPC calls and a fixed 8-cycle fixture (`b8ecb1b`). CI pending; no hosted writes.

16. **Rolling-window fixture correction:** run https://github.com/MusicMeasurer/shopping-app/actions/runs/41281042542 failed with `daily cap bypass` because the expiry fixture had also been backdated 25 hours, removing one row from the 24-hour issuance count. Increased the test's revoke/create cycles from 8 to 9 (`d5eef87`). CI pending; SQL candidate unchanged.

17. **CI green:** all seven disposable PostgreSQL checks passed on `d5eef874c72b0fc46698f53223afa897a2fc3a8c`, run https://github.com/MusicMeasurer/shopping-app/actions/runs/41281240482 (audit regressions, expiry, privileges, role execution, concurrency, deletion lifecycle, invitation caps). This does **not** certify hosted Supabase Auth/JWT/PostgREST, gateway throttling, or client token hygiene. User explicitly set a hard gate: finish all planned database/cloud tests before starting Siri. Hosted migration 017 remains unapplied pending separate approval.

18. **Conditional hosted authorization (user, 2026-11-01):** permission granted to apply 017 only to disposable lab `gmrqeubhotjpmtwokfeq`, after a verified schema backup and recovery path; Data API OFF and all other projects untouched. Detailed execution gate recorded in `docs/017_HOSTED_SUPABASE_PREFLIGHT.md` (`e92c023`). No direct Supabase connector available, no verified backup/restore evidence, and no migration execution. Await operator evidence before proceeding.

### Open decisions / release gates

- Keep 017 **REVIEW ONLY** until independent security review, all relevant CI tests and explicitly approved hosted integration tests.
- Implement or formally risk-accept gateway/edge rate limits; validate secret-token handling in the actual iOS/PWA share flow.
- Verify real JWT/RPC and RLS behavior, concurrency and account lifecycle in disposable hosted Supabase with explicit approval before any write.
- Do not merge the whole draft PR or deploy to production without a separate decision.
- Reconcile current-stage/roadmap documentation with verified state. Earlier project documentation prioritizes ACL migration, baseline automated regressions, personal cloud sync and Siri before invitation rollout; work on 017 draft does not supersede those priorities without a documented decision.

### Evidence policy

Commits prove code changes, CI logs prove disposable PostgreSQL test outcomes, and user-supplied hosted SQL output proves only the specific read-only observations. None alone proves production readiness.


## 2026-11-06 · E3: verified cloud list binding and account item queue (working branch)

- Branch `feature/e3-cloud-auth`; published GitHub Pages and production data untouched. E3 is **in progress**, not accepted; Siri direct add and automatic end-to-end sync remain incomplete.
- Existing foundations (do not duplicate): remote snapshot, conservative reconciliation, versioned RPC mutation and idempotent retry, account-scoped durable IndexedDB queue, atomic edit+queue, atomic receipt+version acknowledgement, real Supabase disposable-lab RPC/isolation probes, and local-cloud integration tests. Real-lab probes do not certify the UI workflow or Siri.
- `e236399`: read-only owned-list discovery. `67f0e2c`: explicit ownership-checked binding helper. `e11c7b3`: UI for manual list selection/binding. E2/E3 CI for `e11c7b3` green.
- `7986f03`: documentation-only control write after transient tool-call security blocking; `f1fe7e5`: manual flush button for previously queued versioned account changes. E2/E3 CI for `f1fe7e5` green.
- `db60255`, `9942cdd`, `58348f6`: cloud-aware account item store and UI routing. For a bound list, add/update/delete are persisted with a versioned queued operation; unbound lists remain local-only; unconfirmed existing items fail closed. E2/E3 CI for `58348f6` green.
- `776441d`: five additional unit tests for the new cloud-aware store. E3 CI run 42210390446: 106 passed, 1 failed because an assertion expected different error text; E2 gate passed. `30d7846`: corrected the assertion; CI result pending at journal update.
- Distinction: existing queue/retry/integration tests already covered underlying mechanisms; new tests cover UI-facing store integration, not a newly invented sync architecture. Avoid repeating completed work.
- **Open:** verify latest CI; implement automatic queue flush after user edits with safe account/session lifecycle; server-to-local reconciliation and clear offline/conflict UX; complete Siri add-to-target-list and locked-screen device test. No automatic guest import or list-name mapping. No production deployment without explicit approval.

- Follow-up 2026-11-06: corrected test assertion `30d7846` passed E2 #131 and E3 #210. `4d91667`, `9aee648`, `46d236a` wire best-effort automatic flush after a bound account edit has been durably queued. The flush verifies current account and keeps unconfirmed operations on failure; manual retry remains. New CI pending. Limitations: no background/offline retry scheduler, concurrent edit notifications while a flush is running may await another trigger, no remote-to-local import, no Siri acceptance. Do not mark E3 complete.

- Follow-up: E2 #135 and E3 #218 passed on `46d236a`. `e93fb1c` adds durable-notification regression test; `04239da` coalesces queue notifications received during an active automatic flush and performs another pass. CI for these commits pending. No background network-resume trigger yet.

- Follow-up 2026-11-06: E3 #224 and E2 #138 passed on `04239da`. `5ec808e` registers an account-scoped browser `online` listener to retry durable cloud queue after connectivity returns; `b5b8429` corrects misleading UI text. `online` signals connectivity only, not guaranteed server reachability; failed operations remain queued and manual retry is available. No background service worker sync, no guest upload, no production release. CI pending.

## 2026-11-06 · End-of-day checkpoint

- Verified latest CI: E3 run #232 and E2 run #142 both succeeded on `9801569`; earlier E3 #230 and E2 #141 also succeeded on `b5b8429`.
- E0/E1/E2 complete; E3 in progress, not accepted. Account-bound edits queue atomically, auto-flush on edit, coalesce concurrent notifications and retry on browser `online`. Unbound/guest data remain local. Manual retry retained.
- Attempted read-only reconciliation preview in `AuthenticatedApp.tsx`, but GitHub writes were blocked; **no preview implementation committed**. Existing headless reconciliation logic is read-only and unintegrated in UI.
- Next: read-only remote/local preview, safe explicit reconciliation with conflict/version handling, actual Siri direct add to chosen list and iPhone acceptance, then release gate. No production deployment approved.
- Estimate for next E3-gated release: roughly 70% implementation progress (subjective, not a test metric). Core cloud security/storage/queue done; cross-device read path and Siri end-to-end acceptance remain significant. Roadmap does not explicitly promise a release immediately after E3; release requires separate verification and approval.

## 2026-11-07 · E3 read-only cloud comparison UI

- Verified preceding checkpoint CI E3 #234 and E2 #143 both successful.
- `c9c8281`, `2f426ba`, `9728aef`, `c5f4506`: account-scoped, verified-session read-only comparison button wired to existing `createAccountSync.preview()`. Displays remote-only count, conflict count and pending queue count. Clears preview on account/list change. No automatic merge or local writes.
- CI for latest UI changes pending. Remaining: explicit safe reconciliation/import with version handling, end-to-end cross-device acceptance, Siri direct add and iPhone tests. Production untouched.

- 2026-11-07 follow-up: E3 #242 and E2 #147 passed for read-only comparison UI. `1e71859` adds account-scoped atomic IndexedDB primitive to import only server-only items with confirmed version, rejecting existing items, versions, queued edits, and wrong mappings; `1c098aa` adds two regression tests. This is a guarded persistence primitive, **not yet wired to UI or an automatic merge**. New CI pending. Do not count cross-device reconciliation as accepted.

- 2026-11-07: E3 #248 and E2 #150 green for guarded import primitive. `9a47df4` adds account-sync explicit remote-only import with fresh remote snapshot, conservative conflict gate, version-preserving atomic local writes; `1091e56` and `a64f37e` wire confirmation button and workspace refresh. Import is opt-in; no overwrite or automatic merge. **Limitations:** partial import possible if later item fails; server may change between fetch and local commit; cross-device acceptance and CI for UI integration pending. No production release.

- 2026-11-07 verification: E3 #256 failed TypeScript build (account-sync mock omitted newly required import dependency), while 110 unit tests and E2 #154 passed. Fixed test mock (`fbdc5a5`); replaced per-item import loop with atomic IndexedDB batch (`add5ba0`, `06f1591`, `6b1ac71`), with success/rollback regressions (`b78c8c1`). CI pending. Batch eliminates local partial import on IndexedDB conflict; server snapshot can still change after fetch and before commit, and cross-device acceptance remains pending.

- 2026-11-07: E3 #268 and E2 #160 passed on atomic import tests. `ae35794` re-fetches and compares complete remote item snapshots (including versions) before local batch commit; `ff04e7b`/`6e1bd2b` add changed/stable snapshot tests. Optimistic double-read reduces stale imports but cannot eliminate server changes between final read and IndexedDB commit; no server transaction or live multi-device acceptance yet. CI pending, production untouched.

- 2026-11-07: E3 #276 and E2 #164 passed on snapshot double-read guard. `d4d16e1`/`b74b5fd` add account-invalidation-mid-import and pending-local-conflict regression tests. CI pending. These are tests of existing fail-closed behavior; no production deployment. Remaining: server-side revision handshake/tombstones and actual cross-device iPhone acceptance, Siri direct add.

- 2026-11-07: E3 #282 and E2 #167 green. Added read-only tombstone fetch/validation (`676ea3b`) and conservative local/pending deletion-review planner (`ecdd95b`) with four tests (`c333bda`). No automatic local deletion, no UI integration yet. Need test with RLS and actual server schema, version-aware deletion reconciliation, and CI. Production untouched.

- 2026-11-07: E3 #290 and E2 #171 green. Added version-aware read-only tombstone classification (`e151a33`) with five tests (`816bda1`), account-scoped preview (`b3a5df6`) and UI button (`dc75d64`). Deletions are never applied automatically; known versions are evidence for review, not proof of unchanged local data. CI for new changes pending, no production release.

- 2026-11-07: E3 #302 and E2 #177 green. Added `applyReviewedRemoteDeletions` transactional IndexedDB primitive (`38224ab`) and three regression tests (`2c8bad1`). Checks mapping, exact item snapshot, expected confirmed version and pending queue; all-or-nothing. Not exposed in UI or called by sync yet: needs fresh server tombstone revalidation, explicit user review/confirmation and CI before enabling. No production changes.

- 2026-11-07: E3 #308 and E2 #180 green. Added `applyConfirmedDeletions(reviewedIds)` orchestration (`03d91c3`): requires explicit IDs, classifies with known versions, re-fetches and compares tombstones, then uses atomic local guarded deletion. Two fail-closed tests (`1ab577c`). This API is not wired to the UI; user confirmation and item-level review remain necessary. CI pending; no production changes.

- 2026-11-07: E3 #314 failed during test transform due to a missing parenthesis in tombstone signature; E2 #183 passed. Corrected expression (`959d800`) and supplied tombstone `.not()` mock (`e0d4e2a`). Await CI before enabling reviewed deletions in UI. Production unchanged.

- 2026-11-07: E3 #320 and E2 #186 green. Deletion preview now includes local item names (`f41e625`); UI displays exact candidate names and requires a second explicit confirmation (`9d11302`) before calling guarded coordinator. Fixed equal-version tombstone eligibility (`6859e46`) and added regression assertion (`1eba552`). New CI must pass before any acceptance. No production deployment.

- 2026-11-07: E3 #330 and E2 #191 green. Added three coordinator regression tests (`6223565`) for stable deletion confirmation, changed server tombstone between reads, and account invalidation during recheck. These are simulated two-device/race tests, not physical iPhone tests. Await CI and disposable-lab validation. Production unchanged.

- 2026-11-07: E3 #334: 133 unit tests passed, TypeScript build failed because mocked `readAccountItemVersions` inferred `never[]`; E2 #193 passed. Corrected test mock return type (`daa9b6e`). Await fresh CI. No lab tests or production changes performed.

- 2026-11-07: E3 #338 and E2 #195 green. Added disposable Supabase lab integration scenario (`bdf939f`) for server add → local import → server tombstone → read-only review → explicit local deletion → version persistence. Lab is strictly gated by E3_LAB_URL and a fixed disposable project hostname; ordinary unit CI skips it without credentials. Await build and separate lab execution; no production changes.

- 2026-11-07: E3 #342 and E2 #197 green. Added offline-edit-vs-server-tombstone coordinator regression (`5546cf2`): pending local edits classify as conflicts and block confirmed deletion. Disposable real-cloud integration scenario exists but has not been executed with lab credentials; do not claim end-to-end validation. Production unchanged.

- 2026-11-07: E3 #346 and E2 #199 green. Added IndexedDB regression tests (`9a35509`) for repeated reviewed tombstone confirmation and stale expected version after a newer recorded server version. Await CI. No production deployment.


## 2026-11-07 · E3 consolidated acceptance checkpoint

- Agreed a **fixed 22-case E3 acceptance matrix** in `docs/E3_FINAL_TEST_MATRIX.md`. After this package, new hypothetical scenarios go to post-E3 backlog; exceptions are real defects, security violations and mandatory acceptance blockers.
- Automated suite: **E3 #370 and E2 #211 passed** on commit `89835568310ba552b629b0238be5544d34d302dd`. These validate the automated portion (matrix 1–18), not physical iPhone or Siri.
- Hosted Supabase integration: **manual E3 disposable cloud integration #5 SUCCESS** on `feature/e3-cloud-auth`, commit `7d39d596625bde679ea46a59572a108be57e6e85`, 21 seconds. Covers queued add, idempotent retry, version conflict and explicit tombstone review/deletion (matrix 19–20). Previous attempts exposed a trailing slash in the E3_LAB_URL secret and a genuine lab RLS issue.
- Confirmed root cause of tombstone failure: lab policy `items_read` excluded `deleted_at IS NOT NULL`. With explicit user authorization, modified **only disposable lab** `gmrqeubhotjpmtwokfeq` to `TO authenticated USING (can_access_list(list_id))`; verified policy via read-only query, rerun passed. Reviewed SQL patch stored in `docs/E3_TOMBSTONE_RLS_PATCH.sql`; **not deployed to production**.
- Security advisors in disposable lab reported existing privileged-function warnings; review required before release. Green integration tests are not blanket security certification.
- **E3 remains IN PROGRESS**: matrix 21–22 (iPhone offline/restart and Siri direct add to synchronized list, including lock-screen behavior) unverified; Siri receiver not yet implemented. No published PWA deployment, production schema change, or final E3 acceptance.
- Source-of-truth progress references: `docs/E3_FINAL_TEST_MATRIX.md`, `docs/E3_DISPOSABLE_LAB_RUNBOOK.md`, `docs/E3_TOMBSTONE_RLS_PATCH.sql`. Functional requirements, architecture and roadmap are updated by dated 2026-11-07 supplements, retaining earlier baselines.

## 2026-11-08 · Siri Shortcut import questions: physical iPhone inspection

- User inspected the existing manual Shortcut on Russian-language iOS. Tapping the shortcut name opens rename/icon/duplicate/move/home-screen menu, **not** import setup. Bottom information (ⓘ) opens **«Подробнее»**, which contains **«Вопросы импорта»**.
- «Вопросы импорта» explains that questions are asked when importing this Shortcut on another device and their answers are inserted into the Shortcut. «Добавить новый вопрос…» opens **«Выбор параметра»**: available action parameters include **«Запрос»**, **«Тип данных»**, **«Ответ по умолчанию»**, **«Перенос по строкам»** under input prompt, and **«URL-адрес»**, **«Метод»**, **«Заголовки»**, **«Тело запроса»**, **«Значения JSON»** under «Получить содержимое URL».
- **Confirmed:** Apple Shortcuts import questions can target concrete action parameters without manually editing actions after import. **Not confirmed:** a fully automatic secure account/token pairing, one-tap installation, token rotation, or voice invocation; import questions alone do not obtain credentials from the PWA.
- **Security:** Do not share the existing manual Shortcut; it contains a live personal scoped bearer token. Build a separate secret-free template and verify its import/pairing behavior before publishing any iCloud link. No keys were revealed in shared screenshots.
- **Next:** design and test a secret-free template + safe one-time account pairing in disposable lab, with cross-account isolation, revocation, expiry and replay checks. The user should not have to configure HTTP/JSON/token fields. Real iPhone publication of the safe template requires user participation. Production unchanged.
- Companion design: `design/siri-one-tap-onboarding.md` (commits `5a2f8a8`, `5aa8973`).

## 2026-11-08 · Physical iPhone Shortcuts persistence experiment

- User created separate **«Тест хранения»** Shortcut using only harmless literal `TEST-12345`, no credentials. Native Russian actions: **«Текст»**, **«Сохранить»** (file) and **«Получить файл из папки»**.
- In **«Сохранить»**: disabled **«Спросить о месте сохранения»**, selected `Shortcuts` folder, entered path `test-storage.txt`, enabled **«Перезаписать, если файл существует»**. First execution showed `TEST-12345` with no folder prompt.
- In **«Получить файл из папки»**: explicitly selected `Shortcuts` folder rather than auto-bound **«Сохраненный файл»**, set path `test-storage.txt`. Read returned `TEST-12345`.
- User then **deleted both the «Текст» and «Сохранить» actions** and ran the remaining read-only action again. Screenshot shows `TEST-12345`. **Confirmed: native Shortcuts can read a file persisted across separate executions without manual selection.**
- **Not confirmed:** safe storage of bearer secrets, device-only isolation, iCloud backup/sync behavior, keychain protection, pairing-code exchange, import of a neutral template, and voice invocation. A normal file in the Shortcuts folder is not a secure credential vault; do not put live tokens there without threat review. No production changes.
- Next: evaluate safer credential architecture and whether file-based storage is acceptable for narrowly scoped, short-lived revocable credentials; investigate app-side authorization alternatives. User's test file may be deleted later as part of test cleanup.

## 2026-11-08 · Siri credential and compromise-recovery decision

- User approved **non-expiring, revocable, add-only Siri credentials** instead of 90-day expiration/automatic rotation. Each credential is scoped to one authorized cloud list; enrollment requires a signed-in user. Local-only lists remain usable without an account, but are not eligible for the current cloud Siri integration.
- Siri adds must work independently of an active PWA session; do **not** require account login for every voice command. Changing the account password currently does **not** invalidate a separate Siri bearer credential. Product recovery should offer a clear **«Это добавил не я»** path that revokes Siri access (including all Siri keys when appropriate), without deleting lists, and optionally handles account-session security separately.
- Proposed UI: **«Настройки → Устройства и Siri»**, readable Siri activity (time and device name only if trustworthy), clear disconnect/reconnect, explicit recovery action. No requirement that user understand tokens or know to revoke a key. Consider server-enforced rate limits, quotas, abuse detection and response minimization; do not expose list contents or revisions to bearer callers. No automatic expansion of credential privileges if other Siri functions are introduced.
- **Status:** architecture/product decision only, **not implemented**. Existing disposable lab still uses 90-day credential expiry and returns technical receipt; one-tap pairing and recovery UI are pending. See `design/siri-pairing-protocol-v0.md` commit `5caa1ca`. Production unchanged.
- Next implementation: audit existing lab Siri SQL/RPC and tests, prepare minimal reviewed migration in isolated lab, verify authorization/revocation/quotas with A/B accounts before any UI changes.

## 2026-11-08 · Read-only lab audit before Siri pairing implementation

- Inspected actual disposable Supabase project `gmrqeubhotjpmtwokfeq` RPC definitions; **no schema/data writes**.
- `enroll_siri_shortcut` requires `auth.uid()` and ownership of a nondeleted cloud list, issues a 64-character random hex token, stores SHA-256 hash and **90-day** expiry. `revoke_siri_shortcut` only revokes credentials owned by the authenticated actor. `list_siri_shortcuts` checks owner and list.
- `siri_add_item` checks hashed token, nonrevocation, expiry and exact list ID, then writes an item; uses explicit operation UUID for idempotent retry. **Already has a per-token cap of 60 new operations per rolling hour**; do not claim rate limiting is entirely absent. It currently returns `operation_id`, `list_revision`, `item_version` in receipt; public response minimization remains outstanding. Rate limit is per-token only, not per-list/account/global.
- Edge Function currently auto-generates `operationId` when missing, which permits duplicate adds after retry without stable ID. Credential may be replayed from any device that has its bearer token; no device attestation. No pairing-code flow exists yet.
- Next safe changes: review DDL and migrations for non-expiring credential semantics; plan pairing endpoint and user-facing recovery; write lab-only tests for cross-account, revoke-all, spam limits, receipt minimization and retry. Do not modify production.

## 2026-11-08 · Siri implementation batch 1 (disposable lab only)

**Applied** migration `siri_indefinite_credentials_revoke_all_minimal_receipt` to Supabase lab `gmrqeubhotjpmtwokfeq` (NOT production). Changes:
- `siri_shortcut_credentials.expires_at` now nullable; `enroll_siri_shortcut` issues non-expiring tokens (`expires_at = NULL`) and no longer returns `expires_in_days`. Existing 90-day credentials retain their existing expiry.
- `siri_add_item` accepts NULL expiry while rejecting revoked/expired tokens; preserves per-token 60/hour cap, owner/list checks and item operation idempotency. Success/retry response reduced to `operation_id` only; internally saved operation receipt still includes revision/version for synchronization.
- Added authenticated-only `revoke_all_siri_shortcuts()` RPC that revokes all currently active Siri credentials for the signed-in owner; no account/list deletion. `EXECUTE` revoked from `PUBLIC` and `anon`, granted to `authenticated`.

**Automated DB tests executed:** transaction-subblock rollback test checked A enrollment creates NULL-expiry credential, B cannot enroll for A's list, and A's revoke-all marks credential revoked. All assertions passed; intentionally rolled back all test writes. Postcheck active indefinite credentials = 0. No production changes. Note: this is a database-level test, **not yet** an end-to-end Edge Function/iPhone test.

**Security advisor:** read-only scan run. It reports existing `rls_enabled_no_policy` informational findings for six internal tables and `authenticated_security_definer_function_executable` warnings for intentional RPCs, including Siri. Each must be reviewed for correct privilege and auth checks before release; no blanket dismissal. Remediation: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable .

**Outstanding:** one-time pairing flow, client recovery UI, recent Siri activity, account/list/global quotas, retry stable operation ID in Shortcut, end-to-end tests and review of existing RPC grants. Existing PWA still displays 90-day messaging and must be updated before user-facing test. Do not claim feature complete.

## 2026-11-08 · Siri implementation batch 2: one-time pairing RPCs

**Lab-only DB migrations** on disposable project `gmrqeubhotjpmtwokfeq`:
- `siri_single_use_pairing_requests`: RLS-enabled `public.siri_pairing_requests` with no direct anon/authenticated table access, code SHA-256 hash (never plaintext at rest), owner/list FK, 10-minute expiry and consumed timestamp. Authenticated owner RPC `create_siri_pairing(p_list)` checks ownership/nondeleted list and limits to 5 requests per owner per rolling hour; issues 64-hex-character high-entropy one-time code. Service-role-only `exchange_siri_pairing(p_code)` locks pairing row, validates unconsumed/unexpired state and list ownership, atomically consumes code and creates a separate non-expiring add-only Siri credential. No production changes.
- `siri_pairing_exchange_service_role_grant_fix`: first implementation mistakenly checked `current_user='service_role'` **inside a SECURITY DEFINER function**, where current_user resolves to function owner, so exchange failed. Removed invalid check; retained `REVOKE ALL ... FROM public,anon,authenticated` and `GRANT EXECUTE ... TO service_role`. Must verify effective grants and service-role-only RPC access before release.

**Tests:** transactional rollback test created pairing as user A, exchanged as service_role, asserted 64-char credential, attempted replay and asserted rejection; **passed**. Earlier failure was diagnosed and corrected, not counted as passing. All test writes rolled back. Not yet tested: concurrent double redemption, expiry, cross-account denial for pairing, issuance cap, full HTTP endpoint, UI, Siri on iPhone. No user secrets printed or shared.

**Important UX limitation:** 64-character code is deliberately strong but unsuitable for manual entry. Pairing UI/Shortcut transfer must be designed and verified before user-facing release; never present this as one-tap setup. Storing redeemed bearer key in plain Shortcuts/iCloud file is still an unresolved security tradeoff. Do not use real credential in file until review.

## 2026-11-08 · Siri pairing test batch 3 and strict one-button UX

**Reaffirmed mandatory acceptance:** the user performs only the clear **«Подключить Siri»** action (plus unavoidable native Apple confirmation if required). No typing/copying pairing codes, no manual editing Shortcuts HTTP/JSON/headers, no token handling. The 64-hex pairing code is internal server material, not a user step. The current code-based RPC **does not yet fulfill this UX**. Need validate an Apple-supported secure handoff before claiming the feature complete; if PWA + Shortcuts cannot accomplish it, stop and propose a native App Intents approach rather than degrade acceptance silently.

**Lab verification:** effective routine privileges checked: `create_siri_pairing` and `revoke_all_siri_shortcuts` executable by `authenticated` (and postgres); `exchange_siri_pairing` only by `service_role` (and postgres), not anon/authenticated. In a rolled-back transaction, A created pairing; B attempted to create for A's list and was denied; expired pairing was denied on exchange. **Passed.** First test attempt to force expiry violated table CHECK `expires_at > created_at`; corrected test fixture to backdate both timestamps and reran successfully. No permanent test writes.

**Remaining gates:** simultaneous redemption race, pairing issuance cap, HTTP pairing endpoint with abuse limits, iPhone one-button feasibility, safe secret persistence, Siri voice and lock screen, UI incident recovery. No production changes.

## 2026-11-08 · Siri implementation batch 4: pairing HTTP adapter

- Added `supabase/functions/siri-pair/index.ts` to feature branch commit `4e60f32`. This lab-only POST JSON adapter accepts only a 64-hex `pairingCode`, rejects malformed/oversized requests, invokes the service-role-only atomic `exchange_siri_pairing` RPC, returns only `token` and `listId` with `Cache-Control: no-store`, and uses generic failure responses. No plaintext code/token logging in the function.
- Deployed `siri-pair` v1 **ACTIVE** in disposable Supabase lab `gmrqeubhotjpmtwokfeq` with `verify_jwt=false`: pairing code is the high-entropy one-time exchange authorization, not a user JWT. **Not deployed to production.**
- Deployment status verified by Supabase connector. HTTP runtime smoke test **not yet executed**: local container has no DNS resolution to the lab host; do not mark endpoint end-to-end tested. Database exchange/replay tests from previous batch remain passing.
- The server endpoint is a building block only: **one-button Apple Shortcuts onboarding is NOT solved**, and safe bearer storage in Shortcuts is not validated. Do not expose the code as a user step. Remaining: actual HTTP tests, concurrent exchange, per-IP abuse control, secure automatic handoff, revocation UX, Siri voice/iPhone verification.

## 2026-11-08 · HTTP lab limitation resolved and live smoke test

- Direct HTTP from local execution container failed **DNS resolution** of `gmrqeubhotjpmtwokfeq.supabase.co` (not evidence of an Edge Function fault). Instead used the lab's existing `pg_net` `net.http_post` to reach the same deployed endpoint from Supabase infrastructure; no third-party browser or paid TinyFish run.
- **Negative HTTP test:** POST JSON `{\"pairingCode\":\"invalid\"}` to `/functions/v1/siri-pair` returned HTTP **400** and generic `Invalid request` response (request id 2).
- **Positive HTTP test:** generated a genuine 10-minute one-use code for test account A and its test list entirely within lab SQL (no plaintext code printed); POST to deployed `siri-pair` returned HTTP **200**. Validated response contains 64-character `token` and `listId` without printing token (request id 3).
- **Cleanup:** revoked the newly issued test credential by its token hash (1 row) and deleted the `pg_net` HTTP response row containing the temporary bearer token. The test pairing request/consumed record remains as a harmless lab fixture. No production changes.
- **What is verified:** real HTTP connectivity, JSON validation, service-role RPC exchange and issuance through deployed Edge Function. **Not yet verified:** concurrent redemption, repeated HTTP exchange with same code, expiration through HTTP, Apple Shortcut installation/secure storage/voice. One-button UX remains required.

## 2026-11-08 · Russian iOS Shortcuts documentation quality gate

Following user feedback about incorrect Russian action labels and incomplete instructions, **paused iPhone testing** and created `docs/06_IOS_SHORTCUTS_RU_REFERENCE.md` (commit `34a2c97`). Checked official Apple Russian iOS 26 Shortcuts guide (creation, action search, Ask for Input, URL contents/API, import questions, URL schemes), separated Apple-confirmed names from names observed on the user's phone and unverified guesses, documented known discrepancies and complete-instruction checklist. **Mandatory**: consult reference before future Shortcuts instructions, do not invent translated action names, do not instruct use of unavailable controls, and never modify the working manual Siri Shortcut for experiments. This is a project-focused verified reference, **not an exhaustive catalog of all actions**.

## 2026-11-08 · Siri pairing automated HTTP replay and rate-limit tests

- **Rate limit:** transactional SQL test accounts for existing lab pairing requests, creates enough to reach 5/hour, confirms next attempt is rejected; **PASS**, writes rolled back. Initial test incorrectly assumed an empty hourly window; corrected test fixture rather than changing production logic.
- **Real HTTP replay:** created one fresh test pairing code without printing it, submitted **two** POSTs to deployed `/functions/v1/siri-pair` via lab `pg_net` (request IDs 4 and 5). Results: one HTTP **200** with token, one HTTP **403** without token. **PASS:** only one exchange succeeded. This verifies replay rejection under two near-simultaneous HTTP requests, but does not prove all possible concurrency interleavings.
- **Cleanup:** revoked the single issued test credential by hash; deleted both HTTP response rows including the one that held a bearer token. No production changes.
- **Remaining critical gate:** secure, genuinely one-button iOS Shortcut installation + pairing remains unproven; do not ask user to build manual commands or pretend that URL-run of an already installed Shortcut solves installation. Need either verified native iOS handoff or native App Intents fallback.

## 2026-11-08 · Apple Siri one-button platform decision gate

Researched official Apple Shortcuts iCloud sharing, import questions, URL schemes, App Intents, App Shortcuts and testing docs. Documented verified vs unproven mechanisms and architecture comparison in `design/siri-onboarding-platform-decision.md` (commit `f77a601`). **Finding:** PWA+iCloud Shortcut automatic secure one-button credential handoff is unproven; native App Intents has documented immediate Siri availability after native app install, but requires native build/signing/distribution and real-device tests. No claim that native companion is implemented or that PWA is impossible. Await user architecture/distribution decision; no production changes.

## 2026-11-08 · Product strategy confirmed by user

No Mac/Xcode; first release is a maximally functional, well-tested PWA. Native iOS (and paid tooling) only after evaluating PWA, no commitment now. Siri one-button UX remains non-negotiable: include only if technically verified on PWA, otherwise explicitly defer to native phase without blocking PWA release. Preserve Siri lab work, stop speculative native implementation. Architecture decision documented in `design/siri-onboarding-platform-decision.md` (commit `970783f`). Production untouched.
