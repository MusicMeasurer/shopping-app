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

### Open decisions / release gates

- Keep 017 **REVIEW ONLY** until independent security review, all relevant CI tests and explicitly approved hosted integration tests.
- Implement or formally risk-accept gateway/edge rate limits; validate secret-token handling in the actual iOS/PWA share flow.
- Verify real JWT/RPC and RLS behavior, concurrency and account lifecycle in disposable hosted Supabase with explicit approval before any write.
- Do not merge the whole draft PR or deploy to production without a separate decision.
- Reconcile current-stage/roadmap documentation with verified state. Earlier project documentation prioritizes ACL migration, baseline automated regressions, personal cloud sync and Siri before invitation rollout; work on 017 draft does not supersede those priorities without a documented decision.

### Evidence policy

Commits prove code changes, CI logs prove disposable PostgreSQL test outcomes, and user-supplied hosted SQL output proves only the specific read-only observations. None alone proves production readiness.
