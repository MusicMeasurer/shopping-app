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
