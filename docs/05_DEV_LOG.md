# 05 · Журнал разработки ShoppingApp

**Основное хранилище:** GitHub. **Начало переноса:** 2026-11-01.

## 2026-10-27—29 · Исторический контекст
- Уточнены требования и этапы; опубликована PWA v0.0.1, на iPhone проверены списки, локальное сохранение и офлайн.
- Siri Shortcut диктует и открывает URL, но не добавляет товар в приложение.
- Историческая полная редакция журнала от 29.10 сохранена в переданных документах проекта; перенос этого краткого резюме **не заменяет** исходные записи.

## 2026-10-30—31 · Облачная модель и безопасность
- Подготовлены миграции 001–016; в существующем TEST-проекте проведены ручные проверки RLS, изоляции пользователей A/B, RPC, идемпотентности, конфликтов и soft-delete.
- Создана миграция 017 приглашений со статусом REVIEW_ONLY; атомарный отзыв незавершённых приглашений при передаче владения согласован, но миграция ещё не применена и не прошла интеграционные испытания.
- На отдельном одноразовом Supabase-проекте успешно выполнены 001–016; подтверждены RLS на 7 таблицах, проверены и скорректированы табличные ACL. Итоговая проверка: authenticated SELECT для shopping_lists, shopping_items, list_members, user_notifications; INSERT только shopping_lists; EXECUTE для четырёх рабочих RPC; prepare_account_deletion недоступна клиентским ролям.
- **Открыто:** проверить эффективные привилегии, роли и реальный HTTP-доступ; согласовать корректирующую миграцию ACL, поскольку ручные изменения тестового стенда ещё не закреплены отдельным SQL-патчем.

## 2026-11-01 · Решение о процессе
- Безопасность данных поставлена выше скорости, особенно с учётом будущего финансового модуля.
- Принято: GitHub — основной журнал; четыре документа проекта выдаются в MD/PDF; создан отдельный короткий реестр принципов.
- Следующий цикл: согласование фактического состояния, минимальный автоматический тестовый контур, проверка обнаружения нарушений, затем безопасная синхронизация личного списка и Siri.
- Не начинать полноценный семейный режим до завершения необходимых зависимостей; 017 остаётся REVIEW_ONLY.

## Правило новых записей
Для значимого изменения фиксировать дату, задачу, ссылку на commit/PR, затронутые миграции, тесты и их фактические результаты, замечания аудита, открытые риски и следующий шаг. Не писать «проверено», если тест не запускался. Обновление — при активной работе и наличии доступа к GitHub; не обещать самостоятельные фоновые изменения без настроенной автоматизации.

## 2026-11-01 · Начат минимальный воспроизводимый контроль безопасности
- На ветке `feature/cloud-schema-draft` создан **черновик** `cloud/drafts/018_acl_normalization_REVIEW_ONLY.sql` (commit `849cb413`) для воспроизведения ручных ACL-изменений лаборатории. Номер 018 — рабочее имя; порядок относительно неприменённой 017 ещё не утверждён.
- Добавлен **неиспытанный** read-only preflight `cloud/drafts/SECURITY_PREFLIGHT_READ_ONLY.sql` (commit `ccf2bab4`): RLS, прямые и эффективные табличные права, запрет `prepare_account_deletion`.
- Ничего не применялось к Supabase; автоматический запуск и A/B HTTP-тесты ещё не настроены. До этого нельзя считать контрольный контур готовым.
- Следующее: статическая проверка SQL, локальный/CI прогон на изолированной PostgreSQL/Supabase базе, фиксация результатов; затем A/B и RPC-регрессия.

## 2026-11-01 · CI-каркас статических SQL-проверок
- В ветке `feature/cloud-schema-draft` добавлены `tests/sql/test_static_guardrails.py` (commit `7b603ac9`) и `.github/workflows/sql-static-guardrails.yml` (commit `9831759a`).
- CI использует Python unittest без секретов и подключения к Supabase. Проверяет наличие SQL-файлов, границы транзакции, наличие критических функций и revoke, ограниченные grant в ACL-черновике и наличие проверок эффективных прав в preflight.
- **Статус: создано, не подтверждено запуском GitHub Actions.** Это только статический барьер; компиляция SQL, проверка реальных прав A/B, RLS и RPC остаются открытыми.

## 2026-11-01 · Уточнение контроля эффективных прав
- Дополнен `cloud/drafts/SECURITY_PREFLIGHT_READ_ONLY.sql` (commit `83c9ac37`): выявление эффективного EXECUTE анонимной роли на привилегированных RPC.
- Создан `tests/sql/README.md` (commit `5b001427`): четыре уровня доказательств, ограничения и запрет применения к действующим базам.
- **Статус:** SQL и описание сохранены в GitHub; реальный прогон PostgreSQL и GitHub Actions ещё не подтверждены. Следующий этап — изолированная среда выполнения и поведенческие A/B-тесты.

## 2026-11-01 · Создан одноразовый PostgreSQL CI-стенд
- В `feature/cloud-schema-draft` добавлен GitHub Actions workflow `.github/workflows/sql-postgres-lab.yml` (commit `260d0e63`): сервис PostgreSQL 16, применение 001–016, ACL-черновика, read-only preflight и теста A/B/anon.
- `tests/sql/bootstrap_pg.sql` (commit `0e35118a`) создаёт только внутри CI минимальную имитацию `auth.users`, `auth.uid()` и клиентских ролей. Это **не Supabase** и не доказательство поведения PostgREST/JWT.
- `tests/sql/test_acl_rls.sql` (commit `b5a13981`) проверяет чтение собственного списка, изоляцию A/B, отсутствие прямой записи товаров/участников и анонимных привилегий. Тестовые записи откатываются.
- **Статус:** workflow и тесты опубликованы в ветке, но результат выполнения GitHub Actions ещё не получен; не считать пройденными. Секреты и внешние базы не используются.

## 2026-11-01 · Первый успешный автоматический прогон
- Открыт Draft PR #1: https://github.com/MusicMeasurer/shopping-app/pull/1. PR большой (47 коммитов, 45 файлов), **не сливать** без разделения/ревью.
- GitHub Actions на head `260d0e63`: `SQL static guardrails` run `41258650635` — **success**.
- `SQL PostgreSQL disposable lab` run `41258650706`, job `124707117433` — **success**: Auth shim, 001–016, ACL draft, effective ACL preflight, A/B/anon RLS SQL tests.
- Граница доказательств: это PostgreSQL 16 с Auth shim, не настоящий Supabase/PostgREST/JWT; реальная HTTP A/B регрессия и проверка намеренного нарушения остаются открытыми.
- Действующие Supabase базы не менялись.

## 2026-11-01 · Mutation test
- GitHub Actions run 41259000235: success. The test detected a temporary anonymous SELECT privilege and confirmed rollback.
- PostgreSQL test only; Supabase API/JWT verification remains pending.

## 2026-11-01 · Real Supabase HTTP A/B probe prepared
- Added tests/http/test_supabase_readonly.py on feature/cloud-schema-draft (commit b8b4ef0f). Read-only GET checks for owner A, nonmember B and anonymous role.
- Added tests/http/README.md (commit 8d4ab779). Requires isolated Supabase, real distinct test users, credentials and Data API enabled.
- Status: NOT EXECUTED. No real Supabase HTTP validation or JWT provisioning completed. Existing databases untouched.

## 2026-11-01 · Auth HTTP probe wiring
- User reports six repository Actions secrets configured (not inspected or read).
- Feature branch HTTP runner now discovers an existing list owned by A via Auth user endpoint; seventh list-ID secret not needed. Read-only, no seed/cleanup.
- Manual workflow entrypoint added on main; it checks out feature/cloud-schema-draft. No schema migrations or database writes performed.
- Status: NOT RUN. Requires A-owned seeded list and temporary Data API enablement in disposable lab. No real API result yet.

## 2026-11-01 · Real Supabase HTTP A/B read isolation PASS
- User supplied GitHub Actions run #1 screenshot: Success, 11 seconds, job auth-http-ab successful.
- User supplied job output: `PASS: real Supabase Auth login and HTTP list isolation A/B/anon`.
- Verified scope: Supabase Auth password login for A/B; owner A can read an A-owned seeded shopping list; nonmember B and anonymous cannot read it through Data API.
- Scope limits: one list; read-only. No write, membership, concurrency, or cleanup testing. No claims of full security audit.
- Disposable project shoppingapp-migration-lab; temporary Data API enablement reported by user. Recommended disabling Data API after test; user confirmation pending.

## 2026-11-01 · HTTP negative write probe prepared
- User reports Data API disabled after successful read-isolation test.
- Added feature branch tests/http/test_write_denials.py: real HTTP negative direct INSERT attempts for items and membership under A/B/anon, expecting 401/403. No successful writes expected; unexpected success is a failure requiring inspection.
- Added manual workflow on main: .github/workflows/supabase-http-write-denials.yml, checks out feature branch and uses existing six secrets.
- Status: PREPARED, NOT RUN. Requires review and temporary disposable-lab Data API enablement. No new migrations, no changes to original security lab.

## 2026-11-01 · Real HTTP direct-write denial PASS
- User supplied GitHub Actions step output: `PASS: direct item/member INSERT denied for A/B/anon` from `python3 tests/http/test_write_denials.py`.
- Scope: real HTTP direct item and membership INSERT attempts were rejected for A/B/anon in disposable migration lab. This does not verify legitimate RPC writes, UPDATE/DELETE, invitations, or concurrency.
- Data API was enabled by user for this test; disable after completing any immediate checks. No database cleanup was independently verified.

## 2026-11-01 · RPC item lifecycle HTTP scenario prepared, NOT RUN
- User confirmed Data API disabled.
- Added tests/http/test_rpc_item_lifecycle.py on feature/cloud-schema-draft and manual workflow .github/workflows/supabase-http-rpc-lifecycle.yml on main.
- Expected real HTTP checks: B add denied; A add, idempotent replay, purchased update, soft-delete with version increments. Writes restricted to exact disposable Supabase project and pre-seeded list named SHOPPINGAPP_HTTP_TEST_A; random item IDs; best-effort soft-delete on failure.
- Status PREPARED / NOT RUN. On failed cleanup, inspect synthetic item manually. Audit operation and change rows remain even on success. Does not test membership sharing or concurrent writes.

## 2026-11-01 · Real HTTP RPC item lifecycle PASS
- User supplied GitHub Actions output: `PASS: A RPC add/update/delete, idempotent replay and B unauthorized add denied`.
- Test note: `item is soft-deleted; operation/change audit rows remain in disposable lab`.
- Verified scope: owner A can add/update/soft-delete item via RPC; replay same operation yields same result; nonmember B add attempt denied. Real Supabase Auth and HTTP, disposable lab only.
- Limits: no independent post-run SQL inspection of item/history, no membership sharing, concurrent writes, stale versions, or cleanup of audit rows verified. Data API was enabled for this run; user asked to disable after test (confirmation pending).

- 2026-11-01: User confirmed disposable-lab Data API disabled after successful HTTP RPC lifecycle test. Next: prepare shared-access integration test without enabling API during development.

## 2026-11-01 · Shared membership revocation SQL test drafted (NOT RUN)
- User confirmed Data API disabled after RPC test.
- Reviewed migrations 001-016: no completed invitation issuance/acceptance flow exists; remove_list_member RPC exists. Do not claim invitations tested.
- Added tests/sql/test_membership_lifecycle.sql on feature/cloud-schema-draft. Uses trusted fixture membership on ephemeral PostgreSQL, verifies member access and RPC add, owner revocation, post-revocation read and write denial, then ROLLBACK.
- Status: PREPARED, NOT RUN. Requires wiring into disposable PostgreSQL CI and actual execution; does not test invitation UX, concurrency, or real HTTP membership lifecycle.

## 2026-11-01 · Membership SQL CI run #1 failed during bootstrap
- User provided screenshots: workflow `Disposable PostgreSQL membership lifecycle #1` failed at `Apply disposable draft migrations 001-016`, SQL line 746: `ERROR: role "service_role" does not exist`.
- No membership behavioral test executed; this is a missing Supabase-like role in ephemeral PostgreSQL, not a demonstrated app security defect.
- Updated main workflow bootstrap to create `service_role` (commit 5113669a022fdcb6f71f6619cfe328c06c7c6f05). Next rerun required; status NOT VERIFIED.
- Data API must remain disabled; GitHub service PostgreSQL does not require Supabase API.

## 2026-11-01 · Disposable PostgreSQL membership lifecycle PASS
- User supplied screenshot of GitHub Actions `Disposable PostgreSQL membership lifecycle #2`, job `membership` succeeded in 18 seconds. Steps `Apply disposable draft migrations 001-016` and `Verify shared membership and revocation with rollback` both green.
- Evidence supports successful completion of SQL scenario: trusted fixture member B can read and add via RPC; owner A revokes B; post-revocation read and RPC add are denied; test transaction ends with ROLLBACK by script. Exact terminal ROLLBACK line not shown in screenshot.
- Scope: ephemeral PostgreSQL role simulation, NOT real Supabase HTTP or invitation issuance/acceptance; no concurrency claims. User reports Supabase Data API remains disabled.

## 2026-11-01 · Invitation 017 cross-check: source not located
- Compared invitation security test plan with available `cloud/drafts/009_transfer_ownership.sql`, `cloud/drafts/OWNERSHIP_TRANSFER_RULES.md`, project requirements/architecture, and PR #1 changed filenames.
- No 017 SQL file appears in PR #1 changed filenames; its exact content/path has not been located, so no 017 implementation review is claimed.
- Existing 009 ownership transfer has no pending-invitation invalidation; this is an integration requirement for future invitation implementation.
- Updated invitation security plan on feature branch. Status: REVIEW ONLY; no migrations or Supabase changes; Data API remains disabled.

## 2026-11-01 · Invitation protocol design 017 drafted (review only)
- Created `cloud/drafts/017_INVITATIONS_DESIGN_REVIEW_ONLY.md` on feature/cloud-schema-draft.
- Proposed owner-only, recipient-bound invitation acceptance; list-row lock ordering; atomic membership creation and revocation on ownership transfer; explicit test gates and open product decisions.
- No executable 017 SQL migration created or applied. No tests run. Supabase Data API remains disabled.

## 2026-11-01 · Draft 017 invitation-link SQL created
- Created `cloud/drafts/017_invitation_links_REVIEW_ONLY.sql` on feature branch. First authenticated explicit claimant; hashed single-use random token; owner issuance/revocation; atomic acceptance; transfer revokes pending links.
- Status: UNTESTED REVIEW_ONLY. Must verify pgcrypto extension schema, function privileges, information disclosure, invitation listing/revocation UX, concurrency, and account deletion integration before applying.
- No database migration or live API test performed. Data API remains disabled.

## 2026-11-01 · Invitation 017 disposable CI prepared
- Created `tests/sql/test_invitation_links.sql` on feature branch and manual `.github/workflows/supabase-invitation-sql.yml` on main.
- Tests cover 24-hour TTL bound, first acceptance, replay rejection, outsider denial, and ownership-transfer invalidation.
- NOT RUN; concurrency race, expired/revoked invite and full permission checks remain to be implemented. No Supabase change; Data API off.

## 2026-11-01 · Invitation 017 SQL workflow: user reports PASS
- User confirmed third run of `Disposable PostgreSQL invitation links 017` succeeded after fixture-role and dollar-quote fixes (`d15c9b8`).
- Scope: disposable PostgreSQL, migration 001–016 plus review-only 017, baseline acceptance/replay/outsider/transfer assertions. This is user-reported success; no independent run-log inspection performed.
- Still outstanding: concurrent claimants, expiry boundary, explicit revocation, permission auditing, static SQL syntax gate, and real Auth HTTP testing. Supabase Data API remains disabled.

## 2026-11-01 · Concurrent invitation claim test prepared
- Added committed fixture `tests/sql/invitation_race_setup.sql`, concurrent psql harness `tests/sql/run_invitation_race.sh` to feature branch.
- Added independent `race` job to `.github/workflows/supabase-invitation-sql.yml` on main; each job has its own disposable PostgreSQL service.
- Two authenticated claimants race while list row is locked; expected exactly one successful acceptance, one membership, one consumed invitation.
- Status: NOT RUN; must inspect GitHub Actions result. No Supabase changes.

## 2026-11-01 · Invitation SQL workflow #5: PASS (screenshot)
- User supplied screenshot: `Disposable PostgreSQL invitation links 017 #5`, Success, 23s; `invitation` PASS (15s), `race` PASS (18s).
- Race test exercises two authenticated claimants against one single-use token and verifies exactly one committed membership/accepted invitation.
- Scope is disposable PostgreSQL only. Expiry boundary, explicit cancellation, grant review and real Auth HTTP are still outstanding. Supabase Data API remains disabled.

## 2026-11-01 · Invitation 017 CI run #6: all three jobs PASS (screenshot)
- Screenshot shows `Disposable PostgreSQL invitation links 017 #6` Success in 25s, commit `4ac5ad3` on main.
- `expiry_revoke` PASS (18s), `invitation` PASS (20s), `race` PASS (22s).
- Scope: isolated PostgreSQL CI only; expiry fixture simulates past creation and expiration, no wall-clock 24-hour wait.
- 017 remains REVIEW_ONLY and not deployed; real Auth/HTTP tests, detailed permission audit and independent security review remain outstanding. Supabase Data API stays off.

## 2026-11-01 · Сверка журнала и документов (новый чат)
- Проверены текущий GitHub-журнал, обязательные принципы, копии 01–04 в проекте и последние коммиты репозитория. Последний найденный коммит main: `738f10ef` (CI-отчёт для Draft PR); также `8f937b4d` (автоматический запуск аудита), `1d1321ce` (аудит разрешений), `04c65656` (проверка истечения после задержки транзакции), `0b98d832` (одноразовый CI-контур).
- В main обнаружен workflow `.github/workflows/supabase-invitation-audit.yml`; в feature-ветке обнаружены `cloud/drafts/017_invitation_links_AUDIT_FIX_REVIEW_ONLY.sql` и `tests/sql/test_invitation_permissions.sql`. Это **подтверждение наличия кода и конфигурации**, а не подтверждение успешного выполнения последнего CI.
- Последний независимо доступный журналом подтверждённый результат 017: пользовательские скриншоты успешного disposable PostgreSQL run #6 (invitation, race, expiry_revoke). Для нового audit workflow успешный запуск/логи в этой сверке **не подтверждены**.
- 017 и audit-fix остаются REVIEW_ONLY; не применены к действующей Supabase. Реальная Auth/HTTP проверка приглашений и независимый аудит остаются открытыми. Не считать подготовку CI завершением E8.
- Документы проекта 01–04 требуют обновления статуса испытаний, а ссылки на прежние FR-001…FR-016 в дорожной карте следует согласовать с действующими FR-001…FR-010. Основные принципы 00 остаются актуальны. GitHub хранит журнал и принципы; файлы 01–04 в GitHub main по ожидаемым путям пока отсутствуют, поэтому копии проекта нельзя считать автоматически синхронизированными.
- Следующее: проверить фактические результаты нового audit CI и замечания, затем завершить ACL/базовую облачную интеграцию и Siri согласно зависимостям. Не изменять рабочую базу в ходе документальной сверки.

## 2026-11-01 · Invitation 017 audit automation verified after workflow alignment
- Fixed exact-SHA checkout in feature workflow (`19b883aa920086679f99bf9b33df25c868380b1f`) and synchronized complete seven-check workflow to main (`342f7a0fc45598f971859afbea6188ce614ae58a`). Both workflow files were read back with identical blob SHA `a657db74917ba6e46d2c79eae030ffd6fe27ccdc`.
- Independently retrieved GitHub Actions bot comment on Draft PR #1: run `41298773915` for feature commit `19b883aa920086679f99bf9b33df25c868380b1f`, **success**. All seven reported outcomes success: audit regressions, wall-clock expiry, privileges, SQL role execution, concurrent lock expiry, account deletion lifecycle, pending invitation limit. Source: https://github.com/MusicMeasurer/shopping-app/pull/1#issuecomment-6556885336 . Earlier run `41281240482` for `d5eef874` also reported all seven success.
- Scope: disposable PostgreSQL 16 with Auth shim only. No real Supabase Auth/HTTP invitation integration or production deployment. Audit-fix 017 remains REVIEW_ONLY; independent security review and upgrade-path testing still open. Bot comments offer automated readback, no user screenshots required for this CI result.

## 2026-11-01 · Invitation transfer revocation CI gate
- Added disposable SQL regression `tests/sql/test_invitation_transfer_revocation.sql` on feature branch (`35ad998bbe18b80a1556b9f2b6203216ea23dfa2`) and wired into feature audit workflow (`a98d44d9682aa03d45c5b0590afd3ec56feb7d85`). Test checks that transfer to a current member revokes a pending link, rejects redemption by outsider, preserves new ownership and denies outsider membership.
- Independently read GitHub Actions bot report for exact commit `a98d44d`: **success, eight of eight checks success**, run https://github.com/MusicMeasurer/shopping-app/actions/runs/41299125168 ; PR comment https://github.com/MusicMeasurer/shopping-app/pull/1#issuecomment-6556932695 .
- `tests/http/README.md` updated on feature branch (`655412ea8c854cc4dd937a22ec54517b7e48fba3`) to distinguish prior partial real HTTP tests from invitation 017 HTTP tests not yet executed.
- All new evidence remains disposable PostgreSQL only. Invitation 017 is REVIEW_ONLY. Do not merge draft PR #1 or deploy to Supabase without independent review and real HTTP/upgrade verification.

## 2026-11-01 · Nine-check invitation 017 CI green
- Added pre-017 existing-data fixture and post-upgrade verification on feature branch (`fe754c0`, `0945518`), wired into workflow (`dee0b0c`). The first nine-check run failed from fixture UUID collision with wall-clock expiry test; no product defect was established by that failure.
- Isolated fixture UUIDs in seed and verification (`a222ac6`, `3a9bdce`). Independently retrieved the GitHub Actions bot report for exact latest commit `3a9bdce854122f9d0934842667f3d1f25566ed86`: **success, all nine checks success**. Run: https://github.com/MusicMeasurer/shopping-app/actions/runs/41300642982 ; PR comment https://github.com/MusicMeasurer/shopping-app/pull/1#issuecomment-6557138166 .
- Verified scope: disposable PostgreSQL 16 with Auth shim, including upgrade of existing list/member/item fixtures. NOT a real Supabase Auth/HTTP invitation test or production upgrade proof. Migration 017 remains REVIEW_ONLY; no live DB changes, PR merge or paid service actions.

## 2026-11-01 · Hosted migration lab 017 installed (not production)
- Supabase connector confirmed two existing labs. Selected `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`) explicitly, leaving `shoppingapp-security-lab` unchanged.
- Applied unchanged feature-branch draft `cloud/drafts/017_invitation_links_AUDIT_FIX_REVIEW_ONLY.sql` using Supabase migration operation as **lab-only** `lab_invitation_017_validation` (version `20261101111851`), successful. Readback: four invitation RPC functions exist and migration is registered.
- Read-only verification: anon cannot execute issue/accept, authenticated can execute issue, authenticated cannot directly SELECT invitation table; pre-existing 1 list, 1 item, 2 auth users remain present. Security advisor reports `rls_enabled_no_policy` informational for intentionally RPC-only tables (including invitations) and `auth_leaked_password_protection` warning for lab; not waived for production.
- Real JWT/HTTP invitation acceptance tests **not yet executed**. No credential extraction, no new project or branch, no changes to main/prod. Draft remains REVIEW_ONLY in repository despite lab deployment.

## 2026-11-01 · Migration 017 hosted-lab read-only closeout and audit-process finding
- After successful lab-only application, verified 7 validated constraints on `list_invitation_links` (3 FK, 2 CHECK, PK, UNIQUE), RLS enabled on invitations/lists/items/members, expected five RPC signatures present and SECURITY DEFINER flags true. No orphan items, list owners or memberships; 1 list, 1 soft-deleted item, 0 members, 2 auth users, 0 invitation links.
- Permission checks: anon issue/accept denied by grants, authenticated issue granted, direct authenticated invitation SELECT denied. Existing counts before and after deployment matched (1 list, 1 item, 2 users), but **no pre-migration field-level snapshot** exists; cannot assert full data equality or behavior preservation solely from counts. SQL CI 9/9 remains separate proof in disposable PostgreSQL.
- Supabase security advisor reported `rls_enabled_no_policy` INFO for four RPC-only tables and `auth_leaked_password_protection` WARN (Auth setting). Neither is newly demonstrated exploitable flaw in 017; Auth warning is a distinct configuration hardening item. Do not classify all advisor findings as new vulnerabilities. No HTTP/JWT invitation execution yet.
- **Process corrective action:** adopt a fixed audit matrix before further migrations: migration pre/post snapshots of all relevant fields and schema objects, existing-function behavioral regressions, explicit grant/RLS checks, advisors baseline-versus-delta classification (new regression vs inherited warning vs intentional deny-by-default), real Auth HTTP checks only as separate acceptance gate. Freeze scope and track findings with severity, evidence, owner, disposition; avoid claiming 'complete security audit' from SQL-only CI.
- Migration 017 lab verification is closed **within this bounded scope**. Production readiness/security certification is NOT claimed; draft stays REVIEW_ONLY, no prod DB changes.

## 2026-11-01 · Explicit decision: audit governance becomes mandatory development principle
- Илья согласовал включение процесса проверок и аудита в обязательные принципы разработки.
- `docs/00_DEVELOPMENT_PRINCIPLES.md` updated in commit `6f34e94f19a7f9d5bc15d1f769882b54b9659000`: fixed audit scope and acceptance criteria, unified findings classification/registry, evidence-based closeout with explicit coverage limits, pre/post migration snapshots and regressions. Extended pre-change checklist.
- This is a process improvement, not evidence of a newly discovered vulnerability or a production release approval.

## 2026-11-01 · Historical audit review completed
- Created `docs/06_AUDIT_REVIEW_2026-11-01.md` (commit `b3ddb923c9c37e9f2f8cc6aeb3045f73cf32ead6`) with eight classified observations A01–A08, evidence, statuses and a reproducible migration-audit gate.
- Root cause hypothesis: absent fixed scope, findings deduplication, environment advisor baseline and distinction between SQL CI, hosted migration, HTTP acceptance and release readiness. This is a process finding, not proof of an exploitable new vulnerability.
- Next phase: evaluate production migration readiness against the fixed gates; no production migration authorized by this review.

## 2026-11-04 · E1 — публикация с обязательными тестами
- PR #2 (`feature/e1-release-gate`) объединён в `main`, squash commit `7e84d15b233ddc903baa64b16d93bb11709e3058`: в `.github/workflows/deploy.yml` добавлен `npm test` перед `npm run build`; deploy зависит от успешного build.
- Пользователь подтвердил статус **Success** последнего запуска workflow `Deploy ShoppingApp to GitHub Pages` после объединения PR #2. Это пользовательское подтверждение; независимое чтение шагов run не выполнялось.
- E1 принят как завершённый по критерию дорожной карты: изменение → автоматическая проверка → публикация, без ручной сборки. Не утверждается, что протестированы все возможные ошибки деплоя.
- Далее E2: закрыть только обязательные зависимости базовой облачной интеграции E3; миграция 017 относится к E8 и остаётся вне текущего объёма.

## 2026-11-04 · E2 — фиксация границы завершения
- В `02_ARCHITECTURE.md` добавлен раздел 8: подтверждённое наличие облачной схемы/RPC в изолированной лаборатории, открытые решения об авторизации Siri и локально-облачной границе, требование воспроизводимости базовых миграций/ACL и проверки бесплатных ограничений. Не считать наличие SQL-функций доказательством работоспособности E3.
- В `03_ROADMAP.md` E1 отмечен завершённым на основании пользовательского подтверждения Success GitHub Pages после PR #2; E2 ограничен необходимыми зависимостями E3.
- Изменены только документы GitHub. Supabase и пользовательские данные не изменялись. E2 пока **не закрыт**; 017 остаётся задачей E8.

## 2026-11-05 · E2 — поиск исходников и проверка ACL лаборатории
- Исходники 001–016 найдены в `feature/cloud-schema-draft:cloud/drafts/`, включая `TEST_MIGRATIONS_ATOMIC_001_016.sql`, `018_acl_normalization_REVIEW_ONLY.sql`, `tests/sql/` и workflow `.github/workflows/sql-postgres-lab.yml`. Предыдущий поиск по `supabase/migrations` был слишком узким; файлы не потеряны.
- Read-only запрос в `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`): все 8 таблиц `public` с RLS=true; у роли `anon` нет эффективного SELECT; `authenticated` имеет SELECT на `shopping_lists`, `shopping_items`, `list_members`, `user_notifications`, INSERT только на `shopping_lists`; UPDATE/DELETE на таблицах отсутствуют. Проверка охватывает только указанные табличные привилегии, не RPC, RLS-поведение и HTTP.
- Workflow для одноразового PostgreSQL содержит bootstrap Auth shim, atomic 001–016, REVIEW_ONLY ACL и негативную проверку небезопасного anon SELECT. Результат **текущего** запуска workflow в этом сеансе не получен; воспроизводимость на чистой базе пока не подтверждена независимо.
- Ни SQL-схема, ни тестовые данные не менялись. Следующее действие — проверить фактический успешный прогон isolated-postgres для точного коммита и закрепить воспроизводимую базовую последовательность без REVIEW_ONLY статуса. Не включать 017 в обязательный E2.

## 2026-11-05 · E2 — сверка полного комплекта миграций
- По GitHub API прочитаны все 16 отдельных файлов `feature/cloud-schema-draft:cloud/drafts/001_*.sql` … `016_*.sql`. Все доступны.
- Прочитан `TEST_MIGRATIONS_ATOMIC_001_016.sql`: присутствуют секции Migration 001–016, и нормализованное полное содержимое каждого отдельного SQL-файла найдено в объединённом сценарии (16/16). Это **текстовая сверка**, а не исполнение SQL и не проверка правильного порядка зависимостей при установке.
- Результат конкретного GitHub Actions прогона `sql-postgres-lab.yml` пока не получен: доступный интерфейс получения запусков ограничен PR-associated runs и не вернул запуск для имени ветки. Не писать, что CI прошёл, без фактического результата.
- Следующий gate: фактический успешный disposable PostgreSQL/Supabase прогон и HTTP/RLS проверки; статус E2 воспроизводимости остаётся **частично подтверждён**.

## 2026-11-05 · E2 — найден архив фактических CI-отчётов
- В `feature/cloud-schema-draft:.github/workflows/supabase-invitation-audit.yml` найден ранее настроенный механизм: push в ветку запускает disposable PostgreSQL audit; job `report` публикует `GITHUB_STEP_SUMMARY` и комментарий в PR #1 с исходом тестов и URL запуска. Механизм **не означает** возможность вручную dispatch через текущий GitHub-коннектор.
- Через GitHub API прочитаны комментарии PR #1; найдено 28 отчётов `Invitation 017 — disposable CI report`. Последний найденный успешный отчёт: commit `4696aac94e9804425edcb160df2b0df3193707a0`, run `41302559910`, URL https://github.com/MusicMeasurer/shopping-app/actions/runs/41302559910 ; все перечисленные в отчёте проверки success, включая upgrade preserves existing data и pre/post snapshot rehearsal.
- Этот workflow включает `Apply baseline 001-016` перед 017; успешный результат job `audit` доказывает выполнение этого шага **для указанного коммита на disposable PostgreSQL с Auth shim**. Это не доказывает самостоятельное выполнение `sql-postgres-lab.yml` для текущего HEAD и не является hosted Supabase HTTP/JWT проверкой.
- Вывод: повторный ручной запуск ради подтверждения существования работоспособной базовой установки 001–016 **не требуется**. Остаток E2 — зафиксировать проверенную ревизию и проверить воспроизводимость/ACL в целевой Supabase-конфигурации до E3.

## 2026-11-05 · E2 — итоговый ACL/RLS аудит и закрытие этапа
- В Supabase lab `shoppingapp-migration-lab` включён Data API для hosted HTTP испытаний. PostgreSQL/Auth работали; до включения Data API REST возвращал HTTP 503. После включения HTTP GET вернул 200.
- Реальные JWT двух разных тестовых пользователей A/B: владелец читает свой список и товары, посторонний B и анонимный клиент не читают. RPC `can_access_list` и `is_list_owner` корректно разделяют роли A/B; анонимный вызов `can_access_list` запрещён.
- SQL-инвентаризация: RLS включён на 8/8 public-таблицах; `anon` не имеет прямых прав на таблицы, `authenticated` имеет SELECT для `shopping_lists`, `shopping_items`, `list_members`, `user_notifications` и INSERT для `shopping_lists`; прямых UPDATE/DELETE нет.
- Обнаружены пять внутренних функций с лишним EXECUTE для `anon`/`authenticated`: `guard_item_identity`, `guard_new_list_metadata`, `reject_item_list_change`, `set_updated_at`, `rls_auto_enable`. Миграция `019_internal_function_acl_REVIEW_ONLY.sql` применена **только в лаборатории**; повторный SQL-запрос подтвердил EXECUTE=false для обеих ролей на всех пяти функциях.
- Коммит `4b9ca6012e339cb0cf68a0d6d722fb15e5487329`: четыре GitHub Actions success — SQL static guardrails, disposable PostgreSQL lab, internal function ACL gate, hosted JWT A/B HTTP gate. Hosted run: https://github.com/MusicMeasurer/shopping-app/actions/runs/42029761288 .
- PR #3 https://github.com/MusicMeasurer/shopping-app/pull/3 оформлен с результатами аудита, переведён в Ready for review и **по явному разрешению пользователя** squash-merged в `feature/cloud-schema-draft`, merge SHA `e56a2108be19c84ee7c14dae3d4d31f4b2f949b6`.
- **Решение:** E2 закрыт в согласованном объёме безопасности и архитектуры; следующий этап E3 (облачная основа + Siri). Не проверены end-to-end записи через RPC, приглашения E8, конфликтная синхронизация и Siri. `main` приложения и production Supabase не развёртывались; Data API lab оставлен включённым.


## 2026-11-07 · Единая документация и E3 checkpoint

- По явному решению пользователя пять основных документов хранятся и обновляются только в `main/docs/` как `.md`; PDF — производные копии для проекта ChatGPT. Рабочие ветки и временные дополнения не являются источниками истины.
- E3 CI #370 и E2 CI #211 успешно прошли на `89835568310ba552b629b0238be5544d34d302dd`; автоматическая часть матрицы 1–18 закрыта на уровне CI.
- Реальный hosted disposable Supabase E3 integration #5 успешно завершился (21 сек., ветка `feature/e3-cloud-auth`): очередь, повтор после потери подтверждения, конфликт версий, серверный tombstone и подтверждённое локальное удаление. Матрица 19–20 закрыта на уровне лаборатории, не физического iPhone.
- Исправление `items_read` в disposable lab `gmrqeubhotjpmtwokfeq` с `deleted_at IS NULL` на `USING (can_access_list(list_id))` применено по разрешению пользователя, прочитано обратно, затем интеграция прошла. SQL для контролируемого будущего переноса: `E3_TOMBSTONE_RLS_PATCH.sql` в рабочей ветке. Production не затронут.
- Открыты E3 21–22: iPhone offline/restart/online и Siri direct add при блокировке. Предупреждения security advisors по privileged functions требуют анализа перед выпуском. Никаких новых необязательных тестовых сценариев до E3 acceptance.
- Согласованная каноническая документация в `main` обновлена с сохранением прежних требований и этапов; PDF создаются как снимки этой редакции.


## 2026-11-07 · Инвентаризация средств разработки и доказательств E3 (по запросу пользователя)

**Цель записи:** не повторять уже выполненные проверки и не путать доступность инструмента с подтверждённым результатом. Основа: полный настоящий журнал выше, текущие workflow и результаты GitHub Actions. Исторические записи остаются неизменными.

**Доступные средства и где их искать:**
- GitHub repository `MusicMeasurer/shopping-app`: feature-ветки для кода, `main/docs/` для пяти канонических документов; GitHub Actions для CI, проверки журналов запусков через GitHub API, Draft PR для CI без merge. `main` и production не менять без отдельного разрешения.
- Уже настроенная GitHub Actions environment `e3-lab` с секретами `E3_LAB_URL`, `E3_LAB_PUBLISHABLE_KEY`, `E3_USER_A_EMAIL`, `E3_USER_A_PASSWORD`, `E3_USER_B_EMAIL`, `E3_USER_B_PASSWORD`. Имеются также старые `SHOPPINGAPP_TEST_*` secrets для HTTP A/B. Значения секретов не читать, не печатать и не коммитить. **До попыток создать пользователя проверять существующие workflows и secrets.**
- Disposable hosted Supabase `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`) для реальных Auth/JWT, RLS, RPC, Data API, Edge Functions, SQL и миграций. Отдельный `shoppingapp-security-lab` не затрагивать. Supabase connector умеет SQL, миграции, функции и публичные ключи, но не административное создание Auth-пользователя. SQL-симуляция JWT не равна реальному браузерному входу.
- Локальный/CI PostgreSQL 16 с Auth shim для воспроизводимых SQL/RLS/ACL и гонок, `ROLLBACK` для тестовых записей. Python unittest — статические SQL guardrails. Vitest + fake-indexeddb — JS/TS логика, синхронизация и локальное сохранение. Playwright Chromium/WebKit с мобильными профилями — поведение UI. curl/GitHub Actions — реальный HTTP endpoint. Supabase SQL `pg_net` использовался для положительного HTTP Siri-теста в disposable lab без выдачи секретного токена наружу.
- Для запуска/наблюдения: push в `feature/e3-cloud-auth` запускает `.github/workflows/e3-verify.yml`; другие существующие workflow — `e3-real-session-gate.yml`, `e3-disposable-cloud-lab.yml`, `e3-rpc-write-probe.yml`, `e2-hosted-jwt-gate.yml`, `sql-postgres-lab.yml`, `sql-static-guardrails.yml`, `e2-function-acl-gate.yml`. Проверять их конфигурацию и результат **конкретного run**, не предполагать успешность по наличию файла.

**Подтверждённые типы проверок и границы:**
- E0: пользовательская iPhone-проверка PWA/офлайн/локального сохранения (29.10); Siri Shortcut ранее открывал URL, но не добавлял товар.
- E2: статический SQL, PostgreSQL/Auth shim ACL/RLS/A/B, mutation-test, hosted Supabase JWT A/B HTTP чтение и запрет прямой записи, RPC add/update/delete/idempotency, отдельные invitation 017 SQL/race/expiry/upgrade испытания; 017 остаётся вне готового семейного режима. E2 security gate принят 05.11.
- E3: hosted disposable Supabase очередь, повтор операции, конфликт версий, tombstone и локальная квитанция; тесты Vitest/fake-indexeddb на импорт Siri-элемента, идемпотентность, конфликт и смену аккаунта; SQL transactional Siri add (права, expiry, revoke, лимит, idempotency); настоящий Siri Edge Function HTTP 200 с временным scoped token и подтверждённой записью в `shopping_items`; негативные HTTP 400/401/403/405/415; RLS A/B чтение и блокировка чужих INSERT/UPDATE/DELETE; мобильный Playwright guest smoke. Эти доказательства не заменяют физическую проверку Siri на iPhone.
- **Новый существенный результат:** GitHub Actions `E3 Typecheck, build and unit tests` run `42349194228` (commit `40695f2b6e96f4904964bd91623f6aff884f4dda`) — все четыре jobs SUCCESS, включая `real-auth-existing-user-lab` (Playwright реальный браузерный вход пользователя A с уже имеющимися secrets `e3-lab`, загрузка облачных списков, перезагрузка, выход), `verify`, `mobile-browser-smoke`, `siri-http-lab`. URL: https://github.com/MusicMeasurer/shopping-app/actions/runs/42349194228 . Успех теста не раскрывает пароль и не доказывает, что A — конкретный `auth.users.id` без отдельного безопасного сопоставления.
- Отдельные ранее выполненные SQL/HTTP и симулированные Auth-тесты **не выдавать** за проверку сквозного поведения iPhone Siri. E3 остаётся открытым до подтверждения товара в целевом списке, iPhone offline/restart/online и Siri при блокировке; production не затронут.

**Ошибки процесса и профилактика:**
1. Перед блокирующим шагом искать уже созданные учётные данные, fixtures, workflow, журнальные доказательства; не создавать новых пользователей/сценарии по инерции. В этом цикле из-за пропуска `E3_USER_A_*` были безуспешные попытки регистрации случайного email (invalid address / email rate limit); signup-job удалён из E3 CI, заменён существующими secrets.
2. Сначала формулировать конкретный следующий приёмочный результат и недостающую проверку, а не накапливать вспомогательные тесты. Одна проверка — одно чёткое доказательство с границами. Не повторять успешные тесты без причины.
3. Если препятствие не решено, сообщать прямо; не выдавать дополнительную активность за прогресс. Внутри активной сессии проводить согласованные проверки без уведомления о каждом успехе, докладывать на значимых контрольных точках.
4. Не путать guest browser smoke, mock Auth, SQL JWT simulation, реальный hosted HTTP JWT, реальный Playwright Auth и физический Siri/iPhone acceptance.
5. Следующая практическая цель E3: показать через автоматизированный интеграционный сценарий, что добавленный Siri endpoint товар появляется после облачного обновления в UI пользователя A, затем провести недоступную CI физическую проверку на iPhone с согласованием публикации. Не менять `main` приложение или production без разрешения.


## 2026-11-07 · E3 — реальный мобильный Auth/Siri fixture: сквозной браузерный gate

- В disposable Supabase lab реальный Auth API подтвердил, что существующий тестовый пользователь A владеет ранее созданным Siri HTTP fixture-списком; браузерный Playwright-тест использует секреты GitHub Actions environment `e3-lab`, не печатает JWT/пароль и не создаёт новых товаров.
- Добавлен сквозной сценарий: вход A → загрузка облачного списка `SHOPPINGAPP_HTTP_TEST_A` → явная привязка к локальному `Продукты` → отображение товара `E3 HTTP verified fixture`, ранее добавленного реальным Siri HTTP endpoint → перезагрузка → подтверждение входа и наличия товара. Проверяется в мобильных Chromium и WebKit.
- Первые прогоны были нестабильны: падения на облачном списке и восстановлении UI после reload менялись между Chromium и WebKit. Диагностика в run `42359080722` показала наличие persisted auth key в обоих браузерах сразу после reload и промежуточный UI `Проверяем аккаунт…`; это **не** доказывает успешную серверную верификацию сессии. Run завершился 3/4 тестами из-за отсутствия option облачного списка в Chromium.
- Выявлено, что два live-сценария параллельно используют одного hosted Auth-пользователя A. Для устранения конкурирующей тестовой нагрузки в `.github/workflows/e3-verify.yml` включён `--workers=1` (commit `8ea3484c94c860e8b29974d548c25acb412f9e68`). GitHub Actions run `42359235928` завершился **SUCCESS по всем четырём jobs**: verify, siri-http-lab, mobile-browser-smoke, real-auth-existing-user-lab; отдельно успешны SQL static, PostgreSQL disposable и E2 ACL. https://github.com/MusicMeasurer/shopping-app/actions/runs/42359235928 .
- **Граница доказательства:** один успешный последовательный прогон подтверждает сквозной браузерный сценарий в тестовой среде, но не доказывает причину предыдущих сбоев или отсутствие флаки без повторов. Физический iPhone, Siri Shortcut, голос при заблокированном экране и offline/restart/online ещё не проверены.
- Следующий gate: подготовить точную инструкцию для физической Siri Shortcut-проверки и отдельно согласовать безопасную публикацию тестовой сборки. `main` приложения и production Supabase не изменялись.


## 2026-11-07 · E3 — физический iPhone: первый успешный вход и импорт облачного списка

- Отдельный публичный репозиторий `MusicMeasurer/shopping-app-preview` создан и подключён к GitHub App. GitHub Pages workflow собирает `feature/e3-cloud-auth` из исходного репозитория, подменяет base/PWA scope на `/shopping-app-preview/`, использует **только disposable Supabase lab** `gmrqeubhotjpmtwokfeq`. Workflow run `42363286809` завершился успешно (build + deploy). Основной сайт `shopping-app` не изменялся.
- Пользователь подтвердил с **физического iPhone в Safari** успешный вход в существующий лабораторный Auth-аккаунт A (UI «Вы вошли в аккаунт»), затем загрузку облачного списка и отображение удалённых товаров. Это ручная проверка устройства, отличная от Playwright-симуляции. Полная Siri Shortcut voice chain ещё не проверена.
- SQL-проверка лабораторной базы подтвердила сохранность `E3 HTTP verified fixture` в `SHOPPINGAPP_HTTP_TEST_A`; всего в тестовом списке на момент проверки **146 записей**, преимущественно от автоматических тестов.
- **ОБЯЗАТЕЛЬНО ПОСЛЕ ЗАВЕРШЕНИЯ ЭТАПА:** согласовать с пользователем очистку накопленных автоматическими испытаниями записей из лабораторного списка, сохранив специально нужные фикстуры до завершения Siri-проверок. До согласования ничего не удалять. В дальнейшем изменить тесты так, чтобы они убирали собственные записи или использовали изолированные одноразовые списки; не допускать бесконтрольного накопления тестовых товаров. Не затрагивать production.

## 2026-11-08 · Утверждена стратегия первого релиза PWA и перенос Siri

**Решение пользователя:** доступа к Mac/Xcode нет; сначала выпускаем PWA с максимальной согласованной функциональностью и проверяем продукт на практике. Возможность нативной версии высока, но её разработка, платные инструменты и расходы сейчас не утверждены. **Siri не блокирует первый релиз PWA.** Критерий Siri остаётся прежним: подключение одной кнопкой, без ручного редактирования команды, копирования кодов, токенов и заголовков; допустимо системное подтверждение iOS. Проверенного механизма для PWA не найдено; это не доказательство абсолютной невозможности. При отсутствии подтверждённого решения Siri переносится в нативный этап.

**Подтверждённые результаты:** вручную созданный Shortcut успешно добавил товар в облачный список лаборатории; отдельный HTTP-тест одноразового кода вернул один успех (200) и отказ повтору (403), тестовый ключ отозван, секретные ответы очищены; лимит 5 кодов/час проверен. Эти испытания **не доказывают** one-button onboarding, Siri при блокировке или готовность к выпуску. Лабораторные артефакты сохранены; рабочая PWA не менялась этим документальным решением.

**Изменение управления:** E3 ограничен безопасной облачной основой PWA, E4/E6/E7 продолжаются, E5/Siri отложен; историческая матрица E3 и её открытые пункты не переписываются. Источник утверждённых решений — эти пять документов в `main/docs/`. Исследовательские материалы `design/siri-onboarding-platform-decision.md` и `docs/06_IOS_SHORTCUTS_RU_REFERENCE.md` в рабочей ветке остаются вспомогательными, не заменяют канонические документы. Публикация приложения/production по-прежнему требует отдельного согласия.

**Разработка E4:** в `feature/e3-cloud-auth` реализован, но **не принят** редактор названия товара (FR-003-03), написаны тесты; сборка, автоматические тесты и iPhone-приёмка пока не подтверждены. Не менять статус FR-003-03 на «Проверено».


## 2026-11-09 · E4 — интерфейс списков, архив и мобильная приёмка предпросмотра

**Объём и репозитории.** E4 разрабатывается в отдельных ветках `MusicMeasurer/shopping-app`, актуальная ветка `feature/e4-accessibility-archive-fixes` (commit `ac7359c100e437d7719f22f948f3f0be9a288788`); в `main` исходный код приложения не объединён. Изолированный тестовый сайт E4 публикуется через `MusicMeasurer/shopping-app-preview` по адресу https://musicmeasurer.github.io/shopping-app-preview/e4/ . Последний коммит настройки публикации: `73c4aaa40806ab74e5ba4ee9fa12b9e19296be57`. Пользователь подтвердил, что обновлённый предпросмотр открылся на iPhone и интерфейс ему понравился; отдельный успешный workflow run для именно этого коммита публикации в текущей проверке не установлен. Не считать тестовый preview выпуском production.

**Реализовано в E4:** пользовательские постоянные и разовые списки; создание через плитку «+», переименование и изменение типа; управление позициями и их количеством; завершение списков и просмотр архива; перетаскивание карточек для изменения порядка; компактные карточки в 2/3 столбца; переключение основного раздела и архива точками и свайпами; быстрые действия в панели текущего списка (переименовать, изменить тип, завершить, удалить); независимые настройки размера карточек и содержимого списка с локальным сохранением выбора. Последняя правка разворачивает направление свайпов, центрирует название в текстовой области под пиктограммой, меняет значок удаления на контурную корзину и запрещает создавать пустые архивные записи на уровне UI и операций. Ранее созданные пустые архивы автоматически не удаляются.

**Испытания:** финальный GitHub Actions `E4 checks (no deployment)` run `42556445300` для `ac7359c` завершился SUCCESS: `build-and-unit` и `browser-e2e` успешны (мобильные WebKit и Chromium). https://github.com/MusicMeasurer/shopping-app/actions/runs/42556445300 . В ходе тестирования устранены неоднозначные локаторы радио-переключателей двух независимых размеров; зелёный CI подтверждает только покрытые сценарии. Пользователь отдельно подтвердил на физическом iPhone работоспособность свайпов в предыдущей версии E4, затем после обновления сообщил, что интерфейс его устраивает, и предложил закончить его доработку на текущем этапе. Не утверждать, что все новые функции и граничные случаи вручную приняты на физическом устройстве.

**Состояние:** интерфейсный пакет E4 на текущем этапе согласован пользователем; функциональный этап E4 **не закрыт целиком**. До формального закрытия нужны сверка всех обязательных FR-001…FR-006 с реализованными сценариями, приёмка сохранности данных, архивов и миграций, проверка физических iPhone-сценариев и интеграции с E3/облаком. Отдельно проверить UX увеличенного текста, работу после перезапуска и офлайн. E3 и production не изменялись; публикация основной версии и слияние веток требуют отдельного согласования.

**Документы:** по решению пользователя от 09.11 обновлён только канонический `main/docs/05_DEV_LOG.md`. `00_DEVELOPMENT_PRINCIPLES.md`, `01_REQUIREMENTS.md`, `02_ARCHITECTURE.md`, `03_ROADMAP.md` пока не менять. При следующей согласованной актуализации отразить фактический E4-прогресс и пересмотреть прежние статусы «Запланировано» без автоматического присвоения «Проверено» непроверенным сценариям.


## 2026-11-09 · Контрольная точка согласованного интерфейса E4

По прямому решению пользователя создана отдельная ветка-снимок `snapshot/e4-ui-v1.0` в `MusicMeasurer/shopping-app`, указывающая на проверенный коммит `ac7359c100e437d7719f22f948f3f0be9a288788`. Это **ветка, не Git tag**: не перемещать и не удалять без отдельного согласования. GitHub Actions E4 run `42556445300` успешен; пользователь одобрил текущий интерфейс на физическом iPhone. Снимок фиксирует эталон исходников, но не означает завершения всей функциональной приёмки E4. `main` приложения по-прежнему не содержит слияния E4. Требования, архитектуру и дорожную карту пользователь решил актуализировать **после закрытия E4**, до тех пор не менять.


## 2026-11-09 · Физическая приёмка E4, блок 1

Пользователь проверил на iPhone изолированный E4 preview в приватной вкладке Safari (в обычной вкладке ранее открывалась закешированная E3). Блок 1 пройден успешно: создание постоянного списка, добавление двух товаров, отметка покупки, переименование позиции, завершение списка, сохранение завершённой версии в архиве и сохранение архива после удаления активного списка. Пользователь сообщил: «Тест успех🎉».

**UX-замечание (не блокирует E4):** форму редактирования товара в будущем вынести в отдельное модальное окно, вместо расширения и смещения содержимого списка вниз. Зафиксировано как улучшение после закрытия E4; не менять согласованный UI-снимок `snapshot/e4-ui-v1.0` в рамках текущей приёмки.

**Автотесты:** CI run `42578291070` на коммите `c4aed01efb5f3d184ebb73a03b836c391e858235` завершён успешно, `browser-e2e` и `build-and-unit` зелёные. Блоки физической приёмки 2–3 и интеграционные зависимости ещё открыты.


## 2026-11-09 · Физическая приёмка E4, блок 2

Пользователь сообщил об успешной проверке на iPhone: создан тестовый список с количеством и единицами товаров, отмечена покупка, данные сохранились после обновления страницы; приложение и локальные данные также доступны после обновления без интернета (авиарежим, Wi-Fi отключён). Блок 2 принят пользователем. Проверка выполнялась в приватной вкладке Safari; устойчивость данных после полного закрытия приватного сеанса этим тестом не подтверждена. Блок 3 и отдельные интеграционные проверки ещё предстоят.
