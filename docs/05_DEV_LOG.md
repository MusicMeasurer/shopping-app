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


## 2026-11-09 · Физическая приёмка E4, блок 3 — завершение локальной приёмки

Пользователь подтвердил успешное прохождение блока 3 на iPhone: разовый список с товарами после завершения исчезает из активных и сохраняется в архиве; пустой список нельзя завершить; ранее завершённые записи остаются в архиве. **Все три блока локальной физической приёмки E4 пройдены**, вместе с успешным CI run `42578291070`. Локальная функциональность E4 принята пользователем; это **не означает полной приёмки интеграции E3/облака**. Перед формальным закрытием E4 отдельно сверить интеграционные зависимости и критерии требований. Эталон интерфейса `snapshot/e4-ui-v1.0` не менять. UX-улучшение «редактирование товара в модальном окне» остаётся отложенным.


## 2026-11-09 · Начальный аудит интеграции E3 ↔ E4 (read-only код)

Сверены рабочие ветки `feature/e3-cloud-auth` и `feature/e4-accessibility-archive-fixes` (GitHub compare: ветки разошлись, 176 коммитов E4 против 480 коммитов E3 относительно сравнения). **Прямое слияние или подмена сборки небезопасны.** В E3 `src/data/storage.ts` открывает IndexedDB `shopping-app` версии **6** с `accountItems`, `accountOperations`, `accountListMappings`, `accountItemVersions` и локальной очередью; E4 открывает ту же базу версии **3** с `items`, `lists`, `archives`. Открытие старой версии поверх новой может завершиться `VersionError`, а без продуманной миграции модель данных несовместима. E3 `src/App.tsx` принимает `accountId`, `onQueued`, `refreshRevision` и использует `cloudAwareItemStore`; E4 `App` принимает только `storage` и работает с локальными списками/архивами, без облачного слоя. Следовательно, E4 preview не подтверждает облачную интеграцию. E4 локальная приёмка пройдена, но интеграционный gate открыт.

**Рекомендованное продолжение:** новая изолированная интеграционная ветка на актуальной базе E3 с переносом E4 UI и доменной модели, единая монотонная версия IndexedDB (>6), явная миграция старых записей и тесты обновления/отката, разграничение гостя/аккаунта и проверка синхронизации списков, архивов, товаров и очереди. До этого не менять `main`, frozen snapshot или production; не заявлять полную готовность E4.


## 2026-11-09 · Разбор организационной ошибки E4 и обязательный независимый аудит

**Решение пользователя:** разработка E4 должна была начинаться в отдельной ветке **от последней проверенной E3**, сохраняя архитектуру и уже реализованные функции. Фактически E4 развивалась параллельно на несовместимой основе. Это признано **недоработкой организации разработки**, а не просто внешним техническим риском. Цель исправления — единая согласованная архитектура без механического «сшивания» и дублирования логики («Франкенштейн»).

**Новое обязательное правило перед каждым этапом:** проверить актуальность исходной ветки, архитектуру, зависимости, совместимость с реализованными функциями и регрессионные последствия; сознательное отступление обосновать заранее. **При интеграции:** сохранять существующие контракты, планировать безопасные миграции и регрессионные проверки, избегать временных обходов и дублирования логики. Позднее дополнить `docs/00_DEVELOPMENT_PRINCIPLES.md`; **сейчас этот документ не изменять**.

**Новый gate перед слиянием интеграционной ветки:** после завершения E3↔E4 интеграции, всех автоматических тестов и успешной пользовательской приёмки провести **независимый аудит Codex**, включая корректность, безопасность, целостность архитектуры, сопровождаемость, производительность, выявление дублирования и оптимизацию кода. Зафиксировать находки, устранить существенные замечания и повторно проверить исправления. Аудит ещё **не проводился**; его результат нельзя предполагать заранее. До успешного прохождения gate не сливать интеграцию в `main` и не менять production без отдельного решения пользователя.

## 2026-11-10 · Аудит документации и запуск инструкции 2

**Источники:** канонические документы `main/docs/`, история коммитов `main`, ветка `feature/e3-e4-integration`, PR #13, доступная история согласований. Не подтверждённые независимой проверкой пользовательские испытания не добавлялись.

- После последней записи журнала от 09.11 интеграционная ветка продвинулась до `a03e9403668325e02043cd9ac48175d19d75effe` (09.11 13:01 UTC). В рабочей ветке: объединённая IndexedDB v7, миграционные регрессии, гостевые пользовательские списки, переименование/смена типа, архив и завершение, многострочное добавление с количеством и единицей; сохранены E3 account stores и облачная очередь. PR #13 **открыт**, в `main` код приложения не сливался. Успешные CI-прогоны интеграционной ветки `42621836183` и `42621826743` относятся к автоматическим тестам/сборке, **не** к полному E4 parity, облачной и iPhone-приёмке.
- **Критическое расхождение:** в `02_ARCHITECTURE.md` исторические строки разделов 5 и 8 называли первый вход/выход «открытыми», хотя ниже в этом же документе с 05.11 уже записано согласованное поведение: автоматическая подготовка гостевых списков к переносу при первом входе **без отдельного согласия**; при выходе списки остаются локально доступны, синхронизация при повторном входе возобновляется, передача в другой аккаунт запрещена. Разделы приведены в соответствие. Временная гостевая/аккаунтная изоляция интеграционного кода не должна закрепляться как окончательная семантика.
- **Организационное расхождение:** принципы перечисляли пять документов после утверждения шестого `04_WORK_INSTRUCTIONS.md` (commit `95f087b483b40dce8db679e32728bf5501ce5b27`). Перечень обновлён; добавлены обязательные проверка исходной ветки и зависимостей, документирование значимых решений и ранее согласованный gate независимого Codex-аудита.
- **Документы:** изменены `00_DEVELOPMENT_PRINCIPLES.md`, `02_ARCHITECTURE.md`, `05_DEV_LOG.md`; `04_WORK_INSTRUCTIONS.md` создан ранее в этот день. `01_REQUIREMENTS.md` и `03_ROADMAP.md` проверены, но их продуктовые статусы **не переписаны** до полного закрытия/интеграции E4 по прежнему решению пользователя. Отмечено, что их статусы «Запланировано» и E4 «Запланировано» не описывают прогресс изолированной ветки; при следующей согласованной редакции отделить «реализовано в ветке», «принято локально» и «интегрировано».
- **Открытые вопросы:** облачная миграция гостевых списков по согласованной семантике, безопасный выход и смена аккаунта, конфликты, архивы/списки в облаке, полнота E4 UI в E3, реальные iPhone-испытания интеграции, независимый Codex-аудит. Не считать их закрытыми.
- **Следующий шаг:** продолжить интеграцию с сохранением согласованной семантики и эталонного E4, затем провести инструкцию 3 на готовой интеграции и инструкцию 4 для неподтверждённых пользовательских сценариев; без разрешения не сливать код в `main` и не публиковать production.

## 2026-11-10 · Отмена отсрочки актуализации требований и дорожной карты

- Пользователь **отменил прежнее ограничение** «обновлять `01_REQUIREMENTS.md` и `03_ROADMAP.md` только после закрытия E4»: горизонт завершения E4 неочевиден; документация должна поддерживаться актуальной по фактам согласно инструкции 2.
- `01_REQUIREMENTS.md` актуализирован: локально проверенные на физическом iPhone E4-сценарии отделены от реализованных без подтверждённой приёмки и от непроверенной E3↔E4 интеграции; критерии и приоритеты сохранены. Не утверждается, что E4 принят в облаке.
- `03_ROADMAP.md` актуализирован: локальная приёмка E4 пройдена, E3 проверен частично на iPhone, PR #13 остаётся открытым, интеграционный gate и независимый Codex-аудит не пройдены; сроки закрытия E4 не утверждены.
- Подтверждающие коммиты: требования `473832b77996ee6b9efbe66a4bb7114d67b95df1`, дорожная карта `2261f86a7c23d54ba170555004707a4fe7935687`. Изменён только `main/docs/`; приложение, рабочие ветки и production не затронуты.
- Следующая проверка: после развития интеграции повторно сверить FR-002…FR-005 с фактическими сценариями и проверить открытые облачные/гостевые границы. Неподтверждённые сценарии не переводить в «Проверено».

## 2026-11-10 · Согласованная модель локальных профилей (E3↔E4)

**Решение пользователя, принято до реализации:** локальный профиль получает собственный `localProfileId` при первом запуске, даже без регистрации. Необязательная привязка `cloudAccountId` устанавливается только к подтверждённой учётной записи и не заменяет локальный идентификатор. Списки, товары, архивы и локальная очередь должны быть изолированы по профилю.

- При первом входе в облако текущий **непривязанный** локальный профиль привязывается к подтверждённому аккаунту; согласован автоматический перенос без дополнительного согласия. При входе в другой аккаунт существующий привязанный профиль **не перепривязывается**: открывается соответствующий сохранённый профиль либо создаётся новый.
- При отсутствии сети, истечении сессии и после выхода локальные данные профиля остаются доступными и редактируемыми. Синхронизация допускается только после подтверждения соответствующей учётной записи; данные разных аккаунтов не смешиваются.
- После выхода по умолчанию открыт **последний использованный локальный профиль**. При нескольких профилях пользователь может переключаться между ними без регистрации и без требования новой авторизации; это не даёт облачного доступа к чужому аккаунту.
- Отдельное действие «удалить локальный профиль» удаляет только данные выбранного профиля на устройстве, **не** облачные данные; необходимо подтверждение и предупреждение о несинхронизированных изменениях. Выход из аккаунта не удаляет профиль. Защита Face ID сейчас не требуется; приватность при доступе к разблокированному устройству признана приемлемым компромиссом.
- **Критический сценарий:** пользователь без учётной записи работает в исходном локальном профиле; друг временно входит в свой аккаунт, выходит и удаляет свой локальный профиль; исходные списки пользователя сохраняются без изменений. Этот сценарий обязателен для негативных/регрессионных тестов.
- Архитектурный статус: **решение согласовано, реализация и приёмка открыты**. Не смешивать с прежней E3-моделью `accountItems`/общего гостевого хранилища. Перед изменением хранилища проверить миграцию IndexedDB v7, безопасное восстановление/откат и существующие контракты; не выполнять разрушительную миграцию. Следовать инструкции 1, независимый Codex gate остаётся обязательным перед слиянием.

### 2026-11-10 · Инструкция 1: первый изолированный инкремент профилей

- Проверены текущие `main/docs/`, исходная ветка `feature/e3-e4-integration` (`a03e9403668325e02043cd9ac48175d19d75effe`), существующие `auth-controller`, `account-sync`, `storage` v7 и ручная привязка `verified-list-binding`. Выявлено: облачная синхронизация работает с аккаунтными записями, а гостевые данные в общем namespace; прямое подключение новой модели без миграции опасно.
- Создана **отдельная** рабочая ветка `feature/local-profiles-foundation` от интеграционной ветки, draft PR [#14](https://github.com/MusicMeasurer/shopping-app/pull/14). Коммиты [`0e69fb3`](https://github.com/MusicMeasurer/shopping-app/commit/0e69fb397ec9353a49a74b386de8c0aeb9daac73) (чистая модель метаданных профиля) и [`1be699b`](https://github.com/MusicMeasurer/shopping-app/commit/1be699bd616fee325b986992413da862b537d06e) (пять модульных сценариев, включая сохранение профиля незарегистрированного владельца после удаления профиля друга и запрет перепривязки).
- **Граница реализации:** модель метаданных и тесты добавлены, но не подключены к IndexedDB, Auth, UI или облаку; удаление метаданных намеренно **не** удаляет данные и не является готовой пользовательской операцией. Реальная миграция v7, профильно-изолированные товары/списки/архивы/очереди, жизненный цикл входа/выхода, синхронизация и пользовательская приёмка **не выполнены**. Нельзя объявлять задачу закрытой.
- GitHub Actions: на момент проверки для head `1be699bd616fee325b986992413da862b537d06e` workflow run **не обнаружен**; тесты не считаются пройденными. PR оставлен draft, слияние запрещено до проверок.

### 2026-11-10 · Восстановлен CI для первого инкремента локальных профилей

- В ветке `feature/local-profiles-foundation` добавлен workflow `.github/workflows/local-profiles-verify.yml` (commit `b8f11807cfa573234aff3f94d815c60cbd965ab4`) и расширен триггер существующего `.github/workflows/e3-e4-integration-verify.yml` (commit `eb3a7322047912e57ddcb6de9f70c2fabae30744`). Это не изменяло production или `main` app.
- **Подтверждённый GitHub Actions run:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42820111427, head `eb3a7322047912e57ddcb6de9f70c2fabae30744`, заключение `success`; шаги `npm ci`, `npm test`, `npm run build` завершились `success`. Другие параллельные запуски не требуются как доказательство этого результата.
- Проверка подтверждает лишь текущий изолированный инкремент и существующий набор автоматических тестов. Реальная миграция IndexedDB, подключение локальных профилей к интерфейсу/авторизации, удаление данных, облачная синхронизация и пользовательская приёмка остаются открытыми.

### 2026-11-10 · Подтверждён CI миграционного инкремента IndexedDB v8

- В `feature/local-profiles-foundation` коммит `e66669e7339a06ce75bd8ea806c0b0d346a9a129` добавил аддитивный объектный store метаданных профиля и `ensureLocalProfiles()`; коммит `a654e005fcd906d1e630cfda66c6fb072af80d85` добавил регрессионные тесты сохранения legacy-данных и повторной/конкурентной инициализации идентификатора.
- **Подтверждён CI именно для head `a654e005fcd906d1e630cfda66c6fb072af80d85`:** GitHub Actions https://github.com/MusicMeasurer/shopping-app/actions/runs/42820345069 — `completed/success`; параллельные runs `42820345290`, `42820357411`, `42820357453` также `completed/success`.
- Процедурное замечание: первоначальный отчёт был выдан до завершения CI. По инструкции 1 для завершённого инкремента необходимо дождаться терминального результата, а при ошибке исправить и перепроверить. Нельзя считать статус `queued`/`in_progress` успешной проверкой.
- **Открыто:** идентификатор профиля пока не подключён к UI и не обеспечивает изоляцию списков/архивов/очередей; не проведены реальная миграция всех данных по профилям, удаление профиля и пользовательская приёмка. CI не заменяет их.

### 2026-11-10 · Инкремент миграции гостевых данных в профильно-изолированные stores

- В рабочей ветке `feature/local-profiles-foundation` добавлены `profileLists`, `profileItems`, `profileArchives`, `profilePendingOperations`, `profileMigrations` и транзакционная `migrateLegacyGuestToProfile()`; legacy stores не удаляются и не перезаписываются. Коммиты `6525784e9139360411e26b0da381301179b861d6`, `1414f88c96c3f48fb28f9ccc06e2cdce3cc58809`, исправление типов `2e68d2dcc43c5279ab80e53e13709244a5b77bcf`.
- Первый CI выявил ошибки TypeScript в обобщённом цикле переноса; исправлено отдельными типобезопасными циклами. **Подтверждён повторный CI** https://github.com/MusicMeasurer/shopping-app/actions/runs/42821236865 (`completed/success`, `npm ci`, `npm test`, `npm run build` успешны).
- **Не считать изоляцию готовой:** миграция пока вызывается явно, UI и обычные операции записи продолжают работать с legacy stores. Транзакционная миграция представляет одноразовую копию; после неё новые legacy-изменения не переносятся автоматически. Нельзя активировать переключение профилей, пока не реализованы профильно-изолированные записи, атомарный cutover, проверки защиты данных и интеграция авторизации.

### 2026-11-10 · Профильно-изолированные операции: первый проверенный инкремент

- В `feature/local-profiles-foundation` добавлены проверяемые операции `saveProfileItem`, `removeProfileItem`, `createLocalProfile` с транзакционной проверкой зарегистрированного локального профиля и завершения legacy-снимка. Коммиты `8dc49573ddbcee5c43478110440ac29acc5c84ee`, `60c0ba233e758f29fa16e6976c43b7cf832071f1`.
- Регрессионный тест двух локальных профилей, отказа в записи неизвестному профилю и сохранности legacy guest copy: коммиты `c939d4668c8a918911b77a19bcb51d9da081fc52`, `e7c5c2ff6605a6a9f46d43d87a9ea770cfbbd2d3`.
- **CI:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42822039414 для `e7c5c2ff6605a6a9f46d43d87a9ea770cfbbd2d3`: `completed/success`, `npm ci`, `npm test`, `npm run build` успешны.
- **Задача не закрыта:** пока реализованы только отдельные методы для товаров и регистрация второго профиля. UI, списки/архивы/очереди и cutover с предотвращением потери записей ещё не переведены на профильно-изолированное хранилище. Сценарий с другом проверен лишь частично на уровне данных, не end-to-end вход/выход/удаление. Никаких изменений production или приложения в `main`.

### 2026-11-10 · Безопасность cutover: проверка расхождений и scoped списки/архивы/очередь

- Рабочая ветка `feature/local-profiles-foundation`, коммиты `b9eb7b0c308801338a3728c85252f3973cd12b89` (код) и `e3cc5d1788ab91fa16928c690e9bb19af2a11f5f` (тесты).
- Добавлены `verifyLegacyProfileCutover()` (сверка legacy и исходного профиля с отказом при расхождении), `saveProfileList`, `renameProfileList`, `changeProfileListKind`, `completeProfileList` (транзакционно), `enqueueProfilePending` (идемпотентная очередь с проверкой коллизий). Регрессионные проверки: изменение legacy после снимка не теряется молча, архив второго профиля не затрагивает первый, очереди разделены.
- **CI последнего коммита:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42822584892 — `completed/success`; `npm ci`, `npm test`, `npm run build` успешны.
- **Не завершено:** UI и обычные guest-операции не переключены на scoped stores; проверка расхождений является fail-closed проверкой, не автоматическим reconciler. Требуется безопасное атомарное переключение без окна для записи в legacy, полный набор операций и end-to-end сценарии аккаунтов, выхода и удаления. Нельзя считать профили готовыми или публиковать без дополнительной работы и приёмки.

### 2026-11-10 · Scoped удаление списка и подтверждение очереди

- В `feature/local-profiles-foundation` добавлены `acknowledgeProfilePending` и `deleteProfileList` (транзакционное удаление списка и только его товаров в выбранном профиле), коммит `186416a0b596c11463c5ca1abc611e88715cf424`.
- Тесты на независимость двух профилей при удалении списка и подтверждении операции: коммит `ac12385996193896c33674c2a40e0aa839fe9bee`.
- **CI подтверждён для последнего коммита:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42823032650 (`completed/success`, `npm ci`, `npm test`, `npm run build` успешны).
- **Важное ограничение:** задача «непрерывная запись при cutover + подключение интерфейса + полный сценарий двух пользователей» ещё НЕ выполнена. Профильные операции пока не подключены к UI; атомарный cutover и безопасная синхронизация legacy-записей не реализованы. Промежуточная попытка метода refreshLegacyGuestSnapshot (`6fd97ee3`) была заменена до финального тестового коммита, поскольку не обеспечивала действительную сверку изменений. Не считать эту попытку работающим reconciler.

### 2026-11-11 · Атомарная проверка готовности guest cutover (не активация)

- В `feature/local-profiles-foundation` добавлен store `profileCutover` в IndexedDB v9 и метод `markGuestCutoverReady()`, который в одной транзакции сверяет legacy и профильные списки, товары, архивы и очередь, после чего сохраняет маркер только при совпадении. При расхождении — отказ без изменения данных. Коммит реализации `86c6e52d95c9860d9a21211a4d2aee08d3503e50`, тесты `5a831b4a9853893d8994b94b9f44a6a07946c3cc`.
- **CI подтверждён:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42858641541 — `completed/success` для `5a831b4a9853893d8994b94b9f44a6a07946c3cc`, тесты и сборка успешны.
- **Критически важно:** маркер готовности НЕ означает фактическое атомарное переключение всех гостевых read/write путей. Legacy UI всё ещё пишет в старые stores; поздние записи после маркера остаются возможны. Для реального cutover необходим единый transactional routing/fence всех операций, защита от параллельных старых вкладок и end-to-end проверка. Функция не готова к выпуску, production и код `main` не менялись.

### 2026-11-11 · Транзакционная защита legacy-записей после маркера cutover

- В `feature/local-profiles-foundation` внедрён общий `legacyMutation`: новые legacy-методы записи в `lists`, `items`, `archives`, `pendingOperations` проверяют `profileCutover` в той же IndexedDB readwrite-транзакции. После установки маркера запись отклоняется без изменения данных. Проверены отказ после маркера и сохранение обычной работы до него. Финальный коммит `f6366f7b9f28abccb58b7d52cdb0ef292eb5ad8e`.
- Первые прогоны выявили синтаксическую ошибку и несогласованный тип транзакции; исправлены до финального коммита. **Итоговый CI:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42893842892 — `completed/success`, `npm ci`, `npm test`, `npm run build` успешны.
- **Ограничение/блокер полного cutover:** старые уже открытые вкладки/установленные версии не содержат нового guard; маркер не переключает UI на профильные read/write пути, и включать его в пользовательском потоке нельзя (новые legacy-записи будут блокироваться). Необходимы безопасная маршрутизация операций, координация версий/старых вкладок, тесты полной интеграции двух профилей и отдельная приёмка. Production и код `main` не изменены.

### 2026-11-11 · Безопасное дополнение снимка legacy перед cutover

- В `feature/local-profiles-foundation` метод `markGuestCutoverReady()` расширен: в одной IndexedDB readwrite-транзакции сверяет профильный снимок с legacy и добавляет отсутствующие записи legacy (списки, товары, архивы, очередь) перед установкой маркера. При несовпадении ранее перенесённой записи, удалении в legacy или иных неоднозначностях — откат и отказ. Коммиты `0a0442d78dd978f7d5edc1f15c2c1dc7e58d3b81`, `6a50d6099c81e863b1fba4a6bf7874e1c7b1f4e8`, исправления TypeScript до `6dc59acf29e31da712df5181b349d638aa3e6222`.
- **CI:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42899992167 — `completed/success`, тесты и сборка прошли. Негативный тест проверяет отсутствие частичного переноса при конфликте.
- **Ограничения:** автоматическое согласование конфликтующих изменений/удалений не реализовано (намеренный отказ ради сохранности); UI не переведён на профильное чтение и запись, старые открытые версии приложения не подчиняются новой защите. Не активировать cutover в пользовательском UI, не считать полную профильную изоляцию принятой. Production и код `main` не изменены.

### 2026-11-11 · Условное подключение гостевого UI к профильным данным

- В `feature/local-profiles-foundation` добавлен `profileItemStore` и транзакционное `saveProfileItems` для многострочного ввода; `App` перед монтированием гостевого рабочего пространства читает `profileCutover` и при наличии маркера маршрутизирует списки, архивы и CRUD товаров в профильные stores. Без маркера остаётся legacy-путь. Для авторизованного аккаунта сохраняется прежний account-scoped адаптер. Коммит `04964c36580917da981b65c63aacd45f425e3042`.
- Тесты: изоляция двух профилей при пакетном добавлении, изменении и удалении товаров, отказ при неизвестном профиле; регрессии общего набора. **CI подтверждён:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42918707119 — `completed/success`, `npm ci`, `npm test`, `npm run build`.
- **Не готово к HMI:** автоматическая безопасная активация маркера, переключение/удаление профилей и полноценный жизненный цикл авторизации, межвкладочная/межверсионная координация, сквозной браузерный тест и пользовательская приёмка. Маркер не включён в пользовательском потоке. Код `main` и опубликованная PWA не изменены.

### 2026-11-11 · Локальные профили: переключение, удаление и условный UI

- В `feature/local-profiles-foundation` добавлены `switchLocalProfile` и `deleteLocalProfile` с транзакционной записью реестра и профильно-изолированной очисткой списков, товаров, архивов и очереди. Переключение/удаление требуют активного cutover; исходный гостевой профиль защищён от удаления, несинхронизированная очередь блокирует удаление, неверное подтверждение отклоняется. Дополнительные профили создаются отдельно. В гостевом UI после cutover доступны выбор/создание и подтверждённое удаление локального профиля; гостевой вход не открывает профиль, связанный с облачным аккаунтом. Коммиты `0b29456cccb11ddf70bf9db4c9d87b26476da590`, `ec68907aae87e66af76a7638d49e45323657d654`, `874ed488b4fdb32e53342a6225f732ab9dd8636d`, `2e631781ffc9a98a4e7aefd23297bd851583ad75`.
- **CI:** https://github.com/MusicMeasurer/shopping-app/actions/runs/42921510561 — `completed/success` на `2e631781ffc9a98a4e7aefd23297bd851583ad75`; unit/regression тесты и сборка прошли.
- **Ограничения:** реальная активация cutover и координация старых вкладок/версий не завершены; профильная привязка к подтверждённой авторизации и полный сценарий двух облачных пользователей не реализованы; HMI/browser acceptance не проведена. Новые контролы остаются недоступны без cutover. Production и код `main` не изменены.


### 2026-11-11 · Инструкция 2: аудит локальных профилей и реальной A/B-интеграции (после последней записи)

- **Источник изменений:** draft PR [#14](https://github.com/MusicMeasurer/shopping-app/pull/14), ветка `feature/local-profiles-foundation`, основанная на `feature/e3-e4-integration`. Это рабочий код, не `main` и не опубликованная PWA. Согласованная модель локальных профилей от 10.11 остаётся неизменной.
- **Guest cutover и IndexedDB:** после записанного ранее инкремента добавлена автоматическая подготовка гостевого cutover при запуске гостевого UI, защита перехода между IndexedDB v9/v10 и сигнализация о заблокированном обновлении старой вкладкой. Старые вкладки должны закрыть соединение перед переходом; нельзя считать межверсионную безопасность физически принятой. Примеры коммитов: [`348bc682`](https://github.com/MusicMeasurer/shopping-app/commit/348bc682), [`19569ffb`](https://github.com/MusicMeasurer/shopping-app/commit/19569ffb). Автоматические регрессии есть; iPhone acceptance ещё нет.
- **Проверенная привязка профиля:** `bindVerifiedLocalProfile` запрещает привязку исходного защищённого гостевого профиля и перепривязку профиля другому аккаунту; `ensureVerifiedAccountProfile` создаёт/находит профиль подтверждённого аккаунта. Авторизованный UI блокируется до готовности соответствующего локального профиля. Код: [`8049e55d`](https://github.com/MusicMeasurer/shopping-app/commit/8049e55dde1c78927f9e625a17e6b1798d246e28).
- **Два профиля и durable queue:** тесты с `fake-indexeddb` проверяют сохранение исходного гостя, разделение двух условно подтверждённых аккаунтов, независимость покупок и очередей, закрытие/повторное открытие IndexedDB; [`892708d1`](https://github.com/MusicMeasurer/shopping-app/commit/892708d1c7c3dac33fff6f6d3e2522a2bfe1175e). Эти тесты **не** являются настоящим браузерным входом двух пользователей.
- **Фоновая синхронизация:** `AuthenticatedApp` допускает фоновую отправку и импорт только для аккаунта с подтверждённой серверной личностью и готовым локальным профилем; негативные тесты сохраняют неподтверждённую операцию при сетевой ошибке или смене аккаунта во время RPC. Код/тесты [`52db3b29`](https://github.com/MusicMeasurer/shopping-app/commit/52db3b2997b046c23001faf445da6707a5d4af36), [`77669139`](https://github.com/MusicMeasurer/shopping-app/commit/77669139d6b1aef61a1bedace694b0269bf3ba0e). Итоговые CI [`42939484357`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42939484357), [`42939484424`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42939484424) — success.
- **Проверка существующих секретов:** вместо создания новых пользователей использованы уже зафиксированные в этом журнале `e3-lab` secrets для A/B. Значения секретов не извлекались и не записывались. В рабочей ветке добавлен автоматический `local-profiles-hosted-ab.yml`, использующий существующие real-session/RLS/RPC/IndexedDB gates, с ограничением URL конкретной disposable лабораторией. Коммит [`1fe0e558`](https://github.com/MusicMeasurer/shopping-app/commit/1fe0e5585c3bf08136dbd30435a7398b5b9648fc).
- **Первый реальный запуск:** [`42942102874`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942102874) подтвердил серверную идентичность двух разных аккаунтов, запрет чужого чтения и RPC-записи, создание/изменение/конфликт/повтор операции, но завершился **failure** на устаревшем утверждении, будто soft-deleted запись должна быть невидимой. В лаборатории ранее сознательно разрешено читать tombstone для сверки удалений; это не новый продуктовый дефект.
- **Исправление теста, без изменения сервера:** в `scripts/e3-rpc-write-probe.mjs` проверка удаления теперь требует сохранённого tombstone, заполненного `deleted_at` и увеличенной версии. Коммит [`a08fb896`](https://github.com/MusicMeasurer/shopping-app/commit/a08fb89613b0961a8b6159b8b46508e0ae4f99f9). **Итоговая hosted A/B интеграция** [`42942190054`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942190054) — `completed/success`: настоящий Auth A/B, запрет межаккаунтного доступа, RPC/idempotency/conflicts, IndexedDB очередь, повтор после потери квитанции и review tombstone. Для того же head успешны [`42942190063`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942190063), [`42942190038`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942190038), [`42942195225`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942195225), [`42942195239`](https://github.com/MusicMeasurer/shopping-app/actions/runs/42942195239).
- **Открыто:** сквозной браузерный сценарий `A → выход → B → выход → A` с проверкой гостевых и аккаунтных данных; реальный offline/restart/online в UI; физическая приёмка на iPhone; полноценный перенос исходных гостевых товаров/архивов в аккаунтное/облачное хранилище; восстановление после ошибок и конфликты на уровне всего UI; независимый Codex gate перед слиянием. Текущий авторизованный интерфейс использует `accountItems`, а не `profileItems`: регистрация локального профиля **не равна** переносу содержимого и не закрывает согласованную семантику первого входа. Предупреждения Supabase security advisors по callable SECURITY DEFINER требуют отдельной оценки перед выпуском.
- **Следующая согласованная практическая задача:** браузерный end-to-end тест настоящих A/B-аккаунтов и восстановления после потери сети; это план, **не** выполненная проверка. `main` приложения, опубликованная PWA и production база не изменены.


## 2026-11-11 · Офлайн-восстановление ранее подтверждённого аккаунта (Instruction 1)

- **Задача:** сохранить доступ к локальному аккаунтному списку после перезапуска без сети и позволить редактировать его до возвращения соединения, не объявляя кэшированную сессию действующей серверной авторизацией.
- **Реализация:** в `feature/local-profiles-foundation` добавлено отдельное UI-состояние `offline-account`. При недоступном сервере Auth оно допускается только при наличии непросроченного локального session candidate, ранее созданной привязки локального профиля к тому же ID и отсутствии незавершённого выхода. Облачные элементы управления и автоматическая отправка не активируются в offline-состоянии; при событии `online` состояние скрывается до повторной серверной проверки. Неподтверждённые операции остаются в IndexedDB. В `auth-controller.test.ts` добавлены позитивная и негативная проверки.
- **Браузерная лаборатория:** `tests/real-cloud-offline-restart.spec.ts` расширен сценарием offline add → restart без сети → локальное редактирование → online → повторная проверка Auth → отправка обеих операций в изолированный облачный список с последующей очисткой тестовых записей. Существующий A/B сценарий сохранён. `local-profiles-hosted-ab.yml` теперь запускается также при изменении Auth UI. Финальный код [`53a93bab`](https://github.com/MusicMeasurer/shopping-app/commit/53a93bab5c87bd0f898a456cefa8b767c142fd12); hosted CI [42971277070](https://github.com/MusicMeasurer/shopping-app/actions/runs/42971277070) — **success**, 4/4 мобильных браузерных сценария, 2/2 real cloud integration и Auth/RLS/RPC проверки; остальные CI [42971285023](https://github.com/MusicMeasurer/shopping-app/actions/runs/42971285023), [42971284943](https://github.com/MusicMeasurer/shopping-app/actions/runs/42971284943) — **success**.
- **Ограничения и безопасность:** офлайн-доступ — локальный UX для ранее подтверждённого профиля, **не** криптографическая повторная проверка личности и **не** доступ к серверу без сети. Истёкшая сессия, отсутствие сохранённой привязки и незавершённый выход блокируют такой путь. Локальные данные не зашифрованы отдельным PIN; защита от лица с физическим доступом к разблокированному устройству не доказана. Не подтверждены отзыв сессии во время офлайна, все сценарии истечения токена, физическая iPhone-приёмка и полная E3↔E4 функциональность. `main` приложения, опубликованная PWA и production не изменены.


## 2026-11-11 · Consolidation of branch journals into the sole canonical log

**Canonical journal: `main/docs/05_DEV_LOG.md` only.** Reviewed all 17 branches of `MusicMeasurer/shopping-app`, and the main branches of `shopping-app-auth-lab` and `shopping-app-preview` (no journal files in those two repositories). Fifteen branches in the application repository carried `docs/05_DEV_LOG.md`; two did not. Their journals fall into historical copies and two differing series. The E4-series headings and E1 release-gate headings were already present in this main journal; the E3-cloud-auth series (2026-11-06–08) and the 2026-11-11 E4 incident were missing and are preserved verbatim below as a historical source annex. Statements in that annex reflect what was recorded at the time, **not automatic proof that an earlier pending check has since passed**. This consolidation does not alter application code or production.

**Critical E4 integration incident:** accepted E4 `src/App.tsx` blob `9760df0b10719d6078056d8c900a332a0124ef66` is identical in `snapshot/e4-ui-v1.0` and `feature/e4-functional-acceptance`; the E3/E4 integration `App.tsx` is a distinct partial implementation. Accepted E4 `src/domain/ordering.ts`, complete card/menu/swipe/drag UI, full-field item editing and 18 E4 acceptance tests were absent from the integration baseline. Green E3 checks did not establish E4 parity. A separate correction branch `feature/e4-accepted-reintegration` has begun restoring accepted E4 ordering, its tests and full-field editing through E3-scoped item storage; **no claim of full E4 integration or completed CI**. Existing guest/account list and archive parity remains unverified. Preserve E3 security and profile isolation. Full E4 regression, E3 CI, and user acceptance are release gates. Historical 24–40-hour estimate is withdrawn as unsubstantiated.

### Historical entries recovered from noncanonical E3 branch journal (preserved, not a new verification)

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

## 2026-11-08 · PWA-first E4 batch: rename existing item (FR-003-03)

Following user-approved PWA-first release strategy, resumed E4 instead of native Siri development. Inspected canonical requirements and roadmap: FR-003-03 (rename existing item preserving ID and purchase status) is mandatory and previously planned. Implemented on isolated `feature/e3-cloud-auth` branch:
- shared item-name validation `normalizeItemName` in `src/domain/shopping.ts` (`f6f246d`);
- `useShopping.rename` persists same item identity with updated name using existing account-aware item store (`5f2811a`);
- inline form with Save/Cancel and labels in `src/App.tsx` (`4dca895`);
- three Vitest cases for trimming, validation and item-identity preservation (`f803be1`).

**Verification status:** source commits completed; automated Vitest/build and physical iPhone checks **NOT YET RUN**, so FR-003-03 remains **implemented, not verified**. Existing cloud queue may block consecutive edits pending sync; this is not silently bypassed. No production deployment, no main/docs changes. Next: CI/build regression and actual guest/account persistence tests before marking accepted.


## 2026-11-11 · E4→E3 integration incident — source audit and corrective gate

**Incident status: CONFIRMED; correction NOT YET VERIFIED.** Read-only comparison of `snapshot/e4-ui-v1.0`, `feature/e4-functional-acceptance`, `feature/e3-e4-integration`, and `feature/local-profiles-foundation`. This entry is recorded before further integration changes, at the user's explicit request. Neither `main` nor published PWA is modified.

### Confirmed errors and evidence

1. **Wrong integration source / loss of accepted baseline.** The accepted E4 `src/App.tsx` has blob SHA `9760df0b10719d6078056d8c900a332a0124ef66` in both `snapshot/e4-ui-v1.0` and `feature/e4-functional-acceptance` (18,825 characters). The first E3/E4 integration uses different `src/App.tsx` blob `c143f286357a37c224b60dfa3a53de7c6e14aa5d` (10,870 characters), not the accepted E4 component. The subsequent local-profile branch uses another partial rewrite `1deb38594220e28fd674949a37b00d89e95805d4` (20,603 characters). This establishes baseline mismatch; it does not establish the original author's intention.
2. **E4 functionality omitted.** E4 swipe archive navigation (`startSwipe`/`endSwipe`), long-press drag (`startPress`/`movePress`/`finishPress`), full list tile/menu with portal and dismiss, compact two-dot navigation, rename dialog, item quantity/unit editing and cancellation/validation semantics are not present as equivalent implementations in the integration UI. `src/domain/ordering.ts` (E4 blob `d842a746c7482932214428ce67bb77ad72616897`, including `placeList`) is absent from both integration branches. The first integration CSS (3,149 characters) omits E4 menu/tile/editor/dialog styles (E4 CSS 14,805 characters). Current CSS (6,833 characters) has only some restored tile/settings styles. The current item hook is a different, smaller implementation (2,608 vs E4 5,702 characters), and item rename does not restore optional quantity/unit editing.
3. **Partial work reported without an E4 parity gate.** Subsequent integration commits restored settings, sizing and new-list tile/dialog, but not all E4 behavior. Current integration has no `tests/e4.spec.ts` at all; accepted E4 has 18 Playwright acceptance cases. Passing E3/profile CI therefore does not establish E4 completeness or regression freedom.
4. **Guest/account mismatch.** Current UI gates local list management and archive behind `accountId === null`; account mode uses predefined lists and cloud-aware item store. Arbitrary E4 list/archive operations are not proven supported by account/cloud synchronization. Do not represent local E4 completion as cloud feature parity.
5. **Branch provenance not controlled as a release gate.** Comparison confirms `feature/e3-e4-integration` is not a descendant of the accepted E4 snapshot (diverged), and `feature/local-profiles-foundation` is 89 commits ahead of the former. Branch proliferation itself is not a defect; failure to pin the E4 acceptance ref and run parity checks before reporting integration success is the process defect.
6. **Overstated progress and unsupported estimate.** Prior reports emphasized green CI for implemented fragments without distinguishing E4 acceptance. A prior 24–40-hour estimate was not derived from an audited reuse plan and must not be treated as a validated remaining-work estimate.

### Corrective contract / acceptance gate

- **Authoritative E4:** `feature/e4-functional-acceptance` (same app source as `snapshot/e4-ui-v1.0`, plus 18 acceptance tests). Preserve E4 behavior and presentation, not an intermediate approximation.
- **Authoritative E3 data/security base:** current `feature/local-profiles-foundation` until an explicit reviewed change. Preserve guest-profile isolation, account isolation, auth, offline queue, recovery and existing E3 tests.
- **Integration method:** adapt accepted E4 UI/handlers to E3 storage interfaces; reuse proven E4 code and tests. Do not overwrite E3 auth/storage with old E4 files. Distinguish local E4 integration from cloud list/archive synchronization, which requires separate design and tests.
- **Verification before claiming done:** port and run all 18 accepted E4 cases against the integration branch; run existing E3/profile/auth/offline/hosted A/B CI; test guest and authenticated modes and negative isolation/cancellation/reload cases. Verify final branch commit and CI conclusions. Record every unsupported case explicitly. No main merge or production deployment without authorization.

**Current status:** audit complete for the listed source files, no integration repair yet in this entry. Next step: implement on a dedicated integration branch, starting with a parity-preserving E4 UI adapter while protecting E3 data boundaries.


## 2026-11-11 · Отложенная задача после завершения интеграции E3/E4

**Решение пользователя:** после завершения интеграции E3/E4 провести ревизию и упорядочивание репозиториев и веток проекта, а также разработать и зафиксировать единые правила ведения версий (назначение и жизненный цикл веток, обозначение эталонных/рабочих/выпускных версий, критерии создания и закрытия веток, маркировка релизов и сохранение истории). До завершения интеграции это отдельная **запланированная, не выполненная** задача; не отвлекать на неё текущую интеграцию. При уборке не удалять исходники, историю, эталонные снимки или рабочие данные без предварительной проверки и отдельного согласования конкретных удалений. Единственный канонический журнал — `main/docs/05_DEV_LOG.md`.


## 2026-11-11 · E4 reintegration — ongoing Instruction 1 checkpoint (not accepted)

User authorized continuing full Instruction 1 for accepted E4↔E3 reintegration. Isolated branch `feature/e4-accepted-reintegration`, no production deployment or application merge to main. Accepted E4 sources: `feature/e4-functional-acceptance`; E3 base: `feature/local-profiles-foundation` before journal cleanup.

**Implemented in working branch:** restored accepted E4 ordering helpers and tests; full item name/quantity/unit editor through scoped E3 item stores; list tile grid, portaled menu, two-dot archive switch, swipe navigation, long-press list reordering, rename and creation dialogs, quick list actions, list deletion and accepted E4 styling. Profile reordering is now one IndexedDB transaction rather than a sequence of independent writes (`6cf8786`, `cf7381f`), with isolation/negative regression test (`795a148`). Source tests and build passed at `7c6cd479`: https://github.com/MusicMeasurer/shopping-app/actions/runs/43007184201 (unit-and-build job). Restored all 18 accepted E4 Playwright scenarios (`fafd2de`) and added mobile Chromium/WebKit CI job (`1b5707f`). **E4 Playwright result pending** at this checkpoint; do not claim full acceptance. Earlier failed unit runs stemmed from an incomplete reorder test fixture that omitted migrated default lists; corrected and rechecked. Account/cloud arbitrary list/archive parity and end-to-end E3↔E4 behavior remain open, with no claim of completion.


## 2026-11-11 · E4 accepted local regression green; E3 cloud integration remains blocked

**Working branch:** `feature/e4-accepted-reintegration`, commit `b3780253dec8cd5478848edf125da01a43e12aa8`. **GitHub Actions:** https://github.com/MusicMeasurer/shopping-app/actions/runs/43007928029 — `unit-and-build` **SUCCESS** (`npm test`, TypeScript/Vite build), `e4-acceptance` **SUCCESS** (**all 36 Playwright runs = 18 accepted E4 scenarios × iPhone WebKit/mobile Chromium**). Earlier acceptance run https://github.com/MusicMeasurer/shopping-app/actions/runs/43007637979 was 35/36 due to a race in a test that reloaded before the durable list-kind update; corrected test now awaits persisted UI state (`b378025`). Earlier tests also exposed and drove fixes for an inherited CSS rule that stretched the circular menu button, missing inline validation, creation-dialog heading, asynchronous guest startup, and offline service-worker readiness. Hosted real-auth E2E cases require disposable-lab credentials and were **not run in this E4 job**; they remain a separate E3 integration gate, not passing by implication.

**Scope verified:** accepted E4 *local/guest* behavior and existing automated E3 unit/build checks. **NOT full E3↔E4 integration.** The authenticated workspace still uses fixed E3 list definitions rather than full E4 list/archive management. `src/data/owned-cloud-lists.ts` is explicitly **read-only**, and `src/data/remote-mutation.ts` only supports remote item name/purchased (no quantity/unit). Therefore E4 account list creation/rename/delete/complete/archive and cloud persistence of item quantity/unit cannot honestly be marked integrated or safe across devices. These need a designed, versioned, security-reviewed cloud schema/API and offline/conflict rules, followed by disposable-hosted tests. No migration or cloud data modification was authorized/performed. User acceptance (Instruction 4), independent Codex audit and release (Instruction 5) remain outstanding. Do not merge or publish as complete.


## 2026-11-11 · Зафиксирован snapshot локальной интеграции E4 (автоматическая приёмка)

По прямому решению пользователя создана контрольная ветка `snapshot/e4-local-integration-ci-passed-2026-11-11`, указывающая на **точный коммит** `b3780253dec8cd5478848edf125da01a43e12aa8`. Проверено повторным чтением списка веток GitHub: SHA совпадает. Контрольный CI: https://github.com/MusicMeasurer/shopping-app/actions/runs/43007928029 — успешные `unit-and-build` и `e4-acceptance` (18 исходных E4 сценариев × 2 мобильных браузера = 36/36). Назначение: сохранённый исходный код для сравнения и возврата перед продолжением облачной E3/E4 интеграции. **Не** означает визуальную приёмку на физическом iPhone, завершённую интеграцию E3 cloud или выпуск. Snapshot-ветку считать контрольной: не перемещать её указатель и не удалять без отдельного разрешения. Рабочая ветка остаётся `feature/e4-accepted-reintegration`; `main` приложения и production не изменены. Защита ветки правилами GitHub не устанавливалась, поэтому неизменность поддерживается процессом, а не серверным запретом.


## 2026-11-12 · E3/E4 cloud integration — verified preflight and fail-closed guard (ongoing)

User authorized continuing Instruction 1 to extend E3/E4 safely without touching production or existing user data. Work branch `feature/e4-accepted-reintegration`. Read-only inspection of `shoppingapp-migration-lab` confirmed `shopping_items.quantity` and `shopping_items.unit` **already exist**; previous statement that the cloud schema lacks these columns was incorrect. Actual gap: `apply_item_change` RPC signature, its idempotency hash, `list_changes` snapshot and current TypeScript remote mutation/snapshot omit them. `shopping_lists` lacks `kind`, `position`, completion/archive model. Security advisor reported SECURITY DEFINER grants requiring audit, not automatic proof of a vulnerability. Existing lab data was not changed.

Preflight and implementation gates recorded in `cloud/drafts/E4_CLOUD_CONTRACT_PREFLIGHT.md` (`5b5a7ec`, `b35fd315`). Added fail-closed check in `src/data/cloud-aware-item-store.ts` (`549cc9ca`) preventing quantity/unit edits for cloud-bound lists before local write/queue until server supports them; unbound account lists remain local. Added negative/isolation tests (`45c308b0`). CI unit-and-build for `45c308b0` successful at https://github.com/MusicMeasurer/shopping-app/actions/runs/43116043160 ; mobile E4 acceptance still running at the time of this log. **Not a completed cloud integration or permission to deploy**. Next: additive versioned cloud contract, isolated disposable database, hosted A/B/offline regression, then user acceptance. Existing Supabase labs are persistent historical test environments and must not be treated as disposable for destructive schema experiments.


## 2026-11-12 · E4 cloud contract next iteration — partial implementation, no hosted schema change

Following user instruction to maintain `cloud/drafts/E4_CLOUD_CONTRACT_PREFLIGHT.md` and execute Instruction 1, inspected canonical principles/requirements and current branch. On `feature/e4-accepted-reintegration`: added fail-closed check for **persisted** quantity/unit operations in `resolveVersionedMutation` with negative tests (`971caeb`, `9ebc4d5`); added strict owner-scoped cloud list metadata read/parse adapter with unit tests (`98ef843`, `cc9510c`), deliberately not wired until schema is migrated. Created **unapplied, review-only** SQL drafts `cloud/drafts/022_e4_list_metadata_REVIEW_ONLY.sql` (`3d01ce6`) and `023_e4_list_metadata_rpc_REVIEW_ONLY.sql` (`a1b659c`): additive kind/position backfill and owner-only versioned metadata RPC with idempotent operation receipt. Updated preflight through `10a173f` to distinguish draft, implemented, verified and unresolved. Neither historical Supabase lab nor production modified.

**Open blocking gates:** (a) FR-002-03 does not settle fate of items and archived snapshots when a list is deleted; cannot silently implement destructive retention semantics; (b) current direct `shopping_lists` UPDATE grants/RLS can bypass new RPC revision semantics, requiring security hardening with E3 compatibility; (c) disposable hosted DB for SQL execution and A/B negative tests is not provisioned; Supabase development branch may incur hourly charges and was not created without authorization. SQL drafts have **not been executed or verified**. TypeScript CI is not SQL acceptance. Full E3/E4 integration and user acceptance remain open. Existing E4 snapshot untouched.


**CI confirmation for cloud-contract draft iteration:** branch tip `10a173fdf933f5cd2d0c4bfa633a042f926c5102`, run https://github.com/MusicMeasurer/shopping-app/actions/runs/43117284992 — `unit-and-build` **success**, `e4-acceptance` **success** (existing 18 E4 scenarios in two mobile projects). These tests verify TypeScript changes and local E4 regression only; SQL drafts 022/023 are **unexecuted** and hosted E3/E4 integration remains unverified. Snapshot unchanged.


## 2026-11-12 · Решения пользователя: история покупок и резервирование лаборатории (Инструкция 2)

**Согласовано:** (1) FR-002-03 — удаление списка не удаляет историю покупок или завершённый архив; история принадлежит пользователю и остаётся доступной без исходного списка. Историческое имя может храниться как метаданные, совпадение названия нового списка не связывает истории. Удаление самой истории требует отдельного явного подтверждения. (2) Продолжать предпочтительно в существующей тестовой Supabase `shoppingapp-migration-lab`, предварительно подготовив проверяемый комплект резервирования/восстановления; не создавать новые платные ресурсы без разрешения. Разделять PostgreSQL схему/роли/данные, функции и миграции, настройки сервиса и секреты; SQL dump не покрывает всё. Восстановление считать подтверждённым только после изолированной проверки.

**Уточнения открыты:** момент записи покупки в историю относительно `purchased`/завершения FR-005; судьба незавершённых позиций удаляемого списка; физическая модель истории, каскады/RLS, миграция и способ проверки восстановления без риска для исторических данных. Предыдущая блокировка SQL draft 022/023 по неутверждённой семантике удаления теперь частично снята решением о сохранении истории, но сама миграция и безопасность ещё не приняты.

**Проверено при обсуждении:** Supabase connector показал обе лаборатории `shoppingapp-migration-lab` и `shoppingapp-security-lab` в статусе `ACTIVE_HEALTHY`; официальная документация Supabase описывает CLI backup/restore PostgreSQL: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore . Это не является проверкой резервной копии. **Никаких изменений Supabase, бэкапа, восстановления, миграций, приложения или production в рамках этой инструкции не выполнялось.** Документированы только согласованные решения.


## 2026-11-12 · Утверждена семантика завершения и архива как источника будущей истории (Инструкция 2)

**Решение пользователя после обсуждения сценариев:** отметка «Куплено» обратима и не изменяет архив; запись появляется только при подтверждённом завершении списка. Для частично отмеченного списка — завершить с текущими отметками / считать все купленными / отменить; для полностью отмеченного — завершить / отменить; для списка без отметок — считать все купленными / ничего не куплено / отменить. Неотмеченные при завершении исключаются из архивного результата; при «Ничего не куплено» пустой архив не создаётся. Пустой список не завершать. Постоянный список остаётся для следующего цикла, разовый удаляется из активных.

**Удаление:** не архивировать текущие товары; если хотя бы один отмечен купленным, предупредить о потере этих отметок для будущей истории и предложить завершение; если нет — не показывать специальное предупреждение. Уже сохранённые архивные записи сохранять независимо от удаления списка. Унифицировать диалоги по состояниям.

**Уточнённое архитектурное решение:** архив завершённых списков — единственный источник будущей истории покупок; отдельную таблицу истории сейчас не создавать. В архиве хранить только подтверждённые купленные позиции и метаданные завершения (ID, владелец, дата, историческое имя, название/количество/единица позиций). Будущая история — представление поверх архива. Это уточняет предыдущую формулировку о независимой истории, **не** отменяя требование сохранять архив при удалении исходного списка.

**Статус:** согласованное продуктовое и архитектурное решение, не реализация. Исторические E4 iPhone/CI проверки не покрывают новые сценарии. Открыты: схема и безопасная миграция архивов, атомарность/идемпотентность завершения, офлайн/облачные конфликты, RLS, регрессии, iPhone-приёмка; резервирование лаборатории из предыдущего решения ещё не выполнено. Код, тесты, Supabase и production этой документационной операцией не изменялись.

## 2026-11-12 · E3↔E4: инвентаризация и изолированная репетиция восстановления (Инструкция 1, в работе)
- Рабочая ветка `feature/e4-accepted-reintegration`: read-only снимки определений лаборатории `shoppingapp-migration-lab`: `cloud/drafts/E4_LAB_RECOVERY_INVENTORY_2026-11-12.md` (23 функции, 10 RLS-политик, 5 триггеров, 38 записей ACL, исходники двух Siri Edge Functions; commit `22b8b8f`), `cloud/drafts/E4_LAB_SCHEMA_METADATA_2026-11-12.md` (71 столбец, 41 ограничение, 22 индекса, 6 расширений; commit `b1c3d61`). Не является полным pg_dump; данные тестовых пользователей не сохранялись по согласованию.
- Добавлены статические тесты инвентаря `tests/recovery/test_inventory.py`, workflow `e4-recovery-inventory.yml` и тест базовой структуры `tests/recovery/test_restored_baseline.sql`.
- Добавлен workflow `.github/workflows/e4-postgres-recovery.yml` (commit `f5ead6b`): временный PostgreSQL 16, CI Auth shim, 001–016, ACL 018, проверка схемы/RLS/ACL и A/B регрессия. **Результат запуска GitHub Actions не подтверждён**; нельзя считать восстановление прошедшим.
- Первичное сопоставление только 001–016, 018, 020: имена 14/23 live-функций найдены; 9 требуют проверки в других миграциях. Равенство сигнатур/тел функций и полноценное восстановление Supabase не доказаны. Отдельная лаборатория не создавалась, действующая БД не изменялась.
- Далее: получить фактический результат CI, исправить обнаруженные проблемы, сопоставить оставшиеся миграции и проверить воспроизводимость в пределах PostgreSQL. Интеграция Auth/HTTP/Edge и облачного E4-архива остаётся отдельным этапом.

- **Подтверждение пользователя (скриншот GitHub Actions, 2026-11-12):** workflow `E4 isolated PostgreSQL recovery rehearsal`, run #1 на коммите `f5ead6b`, ветка `feature/e4-accepted-reintegration`, зелёный статус Success, длительность 22 с. Ссылка: https://github.com/MusicMeasurer/shopping-app/actions/workflows/e4-postgres-recovery.yml . Это подтверждает успешный статус всего CI job; детальные логи шагов отдельно не изучены. Охват — baseline 001–016 + ACL 018 + CI Auth shim и включённые проверки, не полное восстановление Supabase/E3/E4.

- **Продолжение Инструкции 1 (2026-11-12):** сверены восемь зарегистрированных в Supabase лабораторных миграций (названия/версии) с известными SQL-черновиками; сопоставление имён 23 live-функций с шестью доступными исходными SQL-файлами дало 17 совпадений. Остальные шесть определений сохранены как **неприменяемый reference**, `cloud/drafts/E3_LAB_ONLY_FUNCTIONS_RECOVERY_REFERENCE_DO_NOT_APPLY.sql` (commit `5c968cb`); это не проверенная миграция. Добавлены `tests/recovery/check_live_function_coverage.py` и шаг проверки в workflow (commit `e83ddbe`). Сводка и ограничения: `cloud/drafts/E3_E4_RECOVERY_RECONCILIATION_2026-11-12.md` (commit `e471641`). **Новый CI-прогон и полная E3-реконструкция не подтверждены**; прежний Success #1 относится к baseline workflow на `f5ead6b`.

- **2026-11-12 · Продолжение автономного цикла E3 recovery:** на `feature/e4-accepted-reintegration` добавлены `tests/recovery/bootstrap_extensions_pg.sql` (только для временного CI PostgreSQL; схема `extensions`), `tests/recovery/test_restored_e3.sql` (наличие таблиц 017/020, RLS, anon/role EXECUTE) и расширен workflow `.github/workflows/e4-postgres-recovery.yml` для последовательного применения 017 и 020 после 001–016/018 (commit `ed97f01`). **Новый прогон не подтверждён**: статус Success #1 относится к более раннему baseline `f5ead6b`. Это частичная E3-репетиция; последующие Siri pairing/credential migrations и реальный Supabase API остаются открыты.

- **Подтверждение пользователя, 2026-11-12:** после коммита `ed97f01` пользователь сообщил зелёный статус расширенного workflow `E4 isolated PostgreSQL recovery rehearsal`. Это подтверждение статуса со стороны пользователя, без независимого просмотра job logs или run ID. Проверенный объём: временная PostgreSQL, baseline 001–016, ACL 018, приглашения 017, Siri SQL 020 и соответствующие CI-проверки. Поздние Siri pairing/credential миграции, реальный Supabase Auth/Edge и полный E3 restore не подтверждены.

- **2026-11-12 · E3 Siri pairing CI reconstruction:** в рабочей ветке добавлены `tests/recovery/e3_pairing_schema_ci.sql`, `e3_pairing_functions_ci.sql` (пять live-функций, без platform-specific `rls_auto_enable`), `e3_pairing_acl_ci.sql`, `test_restored_e3_pairing.sql`; расширен workflow `e4-postgres-recovery.yml` (commit `f7545e2`). Покрыты схема одноразового сопряжения, nullable `expires_at` Siri credentials и отрицательные ACL-проверки. **Новый прогон ещё не подтверждён; реконструкция не эквивалентна проверенной полной цепочке миграций.** Никаких SQL-записей в hosted Supabase.

- **2026-11-12 · Пользователь подтвердил выполнение расширенного E3 CI:** после публикации workflow commit `f7545e2` пользователь ответил «Готово» на запрос о зелёном статусе. Зафиксировано как пользовательское подтверждение успешного запуска (без доступного run ID/job logs). Покрытие включает baseline 001–016, ACL 018, invitation 017, Siri 020 и CI-only pairing schema/functions/ACL. Не подтверждает полный паритет с hosted Supabase, функциональный E2E Siri или архив E4.


## 2026-11-12 · Решение о двух средах и отказ от избыточного бэкапа

**Согласовано пользователем:** использовать две уже существующие бесплатные лаборатории Supabase без третьего проекта. `shoppingapp-migration-lab` — **полигон**: E3↔E4 продолжается **поверх существующей E3**, без очистки; далее там разрабатываются следующие этапы. `shoppingapp-security-lab` — **основная среда**: после приёмки E3↔E4 на неё разворачивается последняя завершённая версия; затем она обновляется только принятыми этапами. До развёртывания проверить текущую структуру и совместимость. Это не разрешение на production-релиз или немедленные изменения основной среды.

**Тестирование:** временная PostgreSQL в GitHub Actions для SQL/регрессии; реальные интеграционные проверки Supabase — на полигоне. Нет второго полигона, третьего проекта и платных ресурсов. Исторические тестовые данные сохранять не нужно; **полный бэкап исключён из плана и условий**. GitHub хранит код, миграции, значимые SQL-определения, правила безопасности и результаты проверок. Для реальных пользовательских данных основной среды позднее нужна отдельная политика сохранности.

**Проверенные факты:** оба проекта ACTIVE_HEALTHY; в migration-lab зарегистрировано 8 миграций и 2 Edge Functions; security-lab Edge Functions не имеет. Содержимое SQL security-lab не подтверждено: запросы завершились тайм-аутом. Снимки схемы/ACL и восстановительный CI для migration-lab существуют, но не равны полному бэкапу. Никаких hosted изменений в рамках обсуждения не выполнено.

**Документальный след:** [checkpoint](https://github.com/MusicMeasurer/shopping-app/commit/3d85ba3457ca1dc6bf87d265e86eb98b56eec4c8), [снятие требования полного бэкапа](https://github.com/MusicMeasurer/shopping-app/commit/fe993cfb6370c34746d7d9ad9f5e770f0e945c94). Текущая запись фиксирует последующее согласованное решение и заменяет устаревшее представление о необходимости отдельного восстановления полигона перед продолжением E3↔E4.

**Открыто:** обследовать security-lab при восстановлении SQL-доступа; завершить интеграцию E3↔E4, CI, hosted-тесты, приёмку и независимый аудит перед продвижением. Ни E3, ни E4 пока не объявлены завершёнными.


## 2026-11-12 · Отложенная семантика семейного завершения и архива (E8)

**Решение пользователя:** текущую E4 реализацию завершения и облачного архива **не изменять** ради семейного сценария. До полноценного сервиса покупок и семейных групп общие списки носят вспомогательный характер. Продолжать интеграцию личных списков E3↔E4 по действующему контракту. Не считать нижеописанное утверждёнными требованиями.

**Текущее поведение SQL-кандидата:** `complete_e4_list` завершает список только при `shopping_lists.owner_id = auth.uid()`; архивные записи `e4_archive_completions` читаются только по `owner_id`. Таким образом, участники, не являющиеся владельцами, не могут завершить общий список и не видят его архив через существующую RLS. Семейный сценарий не развёрнут и не принят.

**Предложения для будущего обсуждения E8 (НЕ УТВЕРЖДЕНЫ):**
1. Любой участник с правом редактирования может завершить общий список.
2. Одно атомарное завершение действует для общего списка у всех участников; устройства получают результат через синхронизацию.
3. Архив завершённой версии доступен участникам с соответствующими правами.
4. Архивная версия хранится однократно, без физического копирования каждому участнику.
5. **Открытый вопрос:** сохранять ли участнику доступ к истории за период его участия после выхода из списка, отзыва доступа или удаления владельцем.

**Этапы:** E7 — интеграционные испытания и первый релиз PWA; **E8 — семейный режим**, приглашения, участники, права и общие списки. E8 не переносится в E4/E7 этим обсуждением. Никаких изменений SQL, приложения, облачных сред и продуктовых требований этой записью не вносится.


## 2026-11-13 · Порядок физической приёмки платформ и открытый дефект Chromium

**Согласованное решение пользователя:** на текущем этапе физические Android-устройства не тестировать. Приоритет — довести приложение до состояния готовности к выходу на iPhone, провести необходимую iPhone-приёмку; **только после решения о готовности iPhone-версии к выпуску** вернуться к испытаниям Android, в том числе на имеющемся Xiaomi Redmi Note 9. Наличие Chrome на iPhone не считается заменой Android/Chromium: iOS-браузеры используют WebKit. Это решение меняет порядок испытаний, но не отменяет требование исправить Android-дефекты до соответствующего Android-выпуска.

**Факты автоматической проверки:** в [GitHub Actions run 43373698403](https://github.com/MusicMeasurer/shopping-app/actions/runs/43373698403) WebKit прошёл E3/E4 one-off: создание → добавление товара → серверное завершение → архив → перезагрузка → повторное открытие архива. Mobile Chromium не прошёл: при обычном клике «Добавить товар» Playwright фиксирует перехват pointer events сеткой списков/заголовком. Предыдущие CSS-попытки (слои, clip, ограничение сетки до 45dvh) и снятие фокуса поля не устранили сбой. Не установлено, воспроизводится ли дефект на физическом Android; не объявлять его исправленным или E4 полностью принятым.

**Дальнейшая работа:** не блокировать другие независимые задачи E3/E4 повторением этой же Android-ориентированной проверки; сохранить её как известную красную регрессию, не маскировать статус. Следующая приоритетная автоматическая проверка — поведение постоянных списков и их сохранение; физическая пользовательская приёмка — на iPhone 15 Pro. Android-приёмка — позднее по решению выше. Защищённую основную Supabase-среду и production не изменять.

## 2026-11-13 · Аудит по Инструкции 2: облачные списки E3↔E4

- **Исходная редакция:** [ab37a62](https://github.com/MusicMeasurer/shopping-app/commit/ab37a62fff4c5691054ac4aff471bdf9eab594f6) в `main/docs` зафиксировала порядок физической приёмки и открытый дефект Chromium. В предыдущем обсуждении пользователь отдельно согласовал временно исключить Chromium из текущей облачной проверки. Коммит [2aa1c8a](https://github.com/MusicMeasurer/shopping-app/commit/2aa1c8a81252c577620a3be2e103c1fc0252f885) оставил в этом workflow обязательный `iphone-webkit`. История сбоя сохранена в [43373698403](https://github.com/MusicMeasurer/shopping-app/actions/runs/43373698403): WebKit прошёл разовый список, Chromium не прошёл обычный клик «Добавить товар» из-за перехвата событий сеткой списков и заголовком. Воспроизведение на физическом Android не проверялось.
- **Реализация в рабочей ветке:** добавлены загрузка и обновление подтверждённых облачных списков аккаунта ([1090557](https://github.com/MusicMeasurer/shopping-app/commit/10905579e8932f34fb9b0460e86880b3a77dcdb1)) и сверка удаления завершённого разового списка через квитанцию операции ([9e8a05a](https://github.com/MusicMeasurer/shopping-app/commit/9e8a05a12de01d33fa8b0b8f4ed6743017788321)). В [43369098949](https://github.com/MusicMeasurer/shopping-app/actions/runs/43369098949) unit-регрессия остановила проверку до SQL-шагов. После обновления тестовой заглушки квитанции ([c264085](https://github.com/MusicMeasurer/shopping-app/commit/c264085dab1fee90d34c78eb1856264d167febdc)) прогон [43369514658](https://github.com/MusicMeasurer/shopping-app/actions/runs/43369514658) прошёл: временная PostgreSQL, метаданные, создание, архив и атомарное завершение, права, идемпотентность и конкурентные операции.
- **Hosted WebKit:** [0070451](https://github.com/MusicMeasurer/shopping-app/commit/0070451c26133ca60a8e34837af8e1d9d828097c) добавил постоянный список с проверкой сохранения после завершения и перезагрузки ([43374915994](https://github.com/MusicMeasurer/shopping-app/actions/runs/43374915994), 2/2). [81528c1](https://github.com/MusicMeasurer/shopping-app/commit/81528c1f24a7fd33238753e09b050e564e7e822f) добавил новый товар в следующем цикле, проверку его серверной синхронизации и наличие после повторной перезагрузки. Итоговый [43375469925](https://github.com/MusicMeasurer/shopping-app/actions/runs/43375469925) — **2/2 по журналу Playwright**: разовый и постоянный списки, подтверждение завершения сервером, повторное открытие архива. [43375469929](https://github.com/MusicMeasurer/shopping-app/actions/runs/43375469929) — успешные unit-тесты, сборка и отдельный `tests/e4.spec.ts`. Второе завершение постоянного списка этими облачными тестами не проверялось.
- **Полигон:** в предыдущем чате сообщалось о развёртывании E4 SQL и `create_e4_list` в `shoppingapp-migration-lab`. Hosted CI подтверждает работоспособность операций в проверенных сценариях. Точный перечень зарегистрированных миграций не установлен по материалам этого аудита.
- **Сверка документов E3:** более ранний [42971277070](https://github.com/MusicMeasurer/shopping-app/actions/runs/42971277070) подтвердил браузерное A/B переключение, гостевую изоляцию и восстановление аккаунтной работы после offline/restart/online в ветке локальных профилей. Полный перенос исходных гостевых данных и повторение полного сценария на актуальной интеграционной сборке остаются открытыми.
- **Открыто:** физическая iPhone-приёмка, полный объём E3↔E4, оставшиеся варианты завершения и удаления, облачные количество/единица и конфликты, независимый аудит. Android-приёмка следует после решения о готовности iPhone. Семантика семейного архива остаётся вопросом E8. Слияние приложения, перенос в основную среду и выпуск требуют отдельных решений.

## 2026-11-13 · Повторное завершение постоянного облачного списка (Инструкция 1)

- В рабочей ветке `feature/e4-accepted-reintegration` расширен существующий облачный Playwright-тест ([03f511a](https://github.com/MusicMeasurer/shopping-app/commit/03f511ab81add14974786d69f1af8c992a54b14a)). Проверены два последовательных завершения с подтверждением сервера. После перезагрузки список остаётся активным, товар второго цикла убран из активных, а в архиве доступны две отдельные записи с товарами своих циклов.
- Первый [прогон 43376994661](https://github.com/MusicMeasurer/shopping-app/actions/runs/43376994661) остановился после первого серверного подтверждения: тестовый селектор совпал с двумя одинаковыми уведомлениями. Поиск ограничен панелью облачного архива. Повторный [облачный прогон 43377204244](https://github.com/MusicMeasurer/shopping-app/actions/runs/43377204244) — 2/2 в профиле iPhone WebKit. [Интеграционные проверки 43377204171](https://github.com/MusicMeasurer/shopping-app/actions/runs/43377204171) — сборка успешна, 268 тестов прошли, 2 пропущены, 36 локальных браузерных сценариев E4 прошли.
- Проверка относится к завершению «всё куплено» в лаборатории. Другие варианты завершения, физическая приёмка и полная приёмка E3↔E4 остаются открытыми.

## 2026-11-13 · Частичное завершение облачного списка и отмена (Инструкция 1)

- В `feature/e4-accepted-reintegration` расширена проверка постоянного списка ([e236135](https://github.com/MusicMeasurer/shopping-app/commit/e236135e6c692421fbac872fc98f119e4e823098)). В первом цикле сохранён сценарий «Всё куплено». Во втором сервер подтвердил две позиции с разными отметками. После отмены обе позиции остались в списке, архив сохранил прежнюю запись. После подтверждения «Отмеченные» обе позиции ушли из активных, а после перезагрузки в новой архивной записи осталась только отмеченная позиция. Запись первого цикла сохранилась.
- В первых [двух](https://github.com/MusicMeasurer/shopping-app/actions/runs/43377886425) [прогонах](https://github.com/MusicMeasurer/shopping-app/actions/runs/43377640063) отметка сразу после добавления не сохранилась. Клиент требует подтверждённую версию позиции для изменения. В том прогоне отметка сохранилась после синхронизации и перезагрузки перед нажатием. Код приложения этим изменением не менялся.
- [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43378220724) — 2/2. [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43378220715) — успешно. «Ничего не куплено» и физическая приёмка остаются открытыми.

## 2026-11-13 · Отметка облачного товара через 2,5 секунды после появления

- По просьбе пользователя в тесте постоянного списка целевой товар добавляется последним. После появления его флажка на экране тест ждёт ровно 2500 мс и нажимает «Куплено» без промежуточной перезагрузки или ожидания подтверждения создания от сервера. Проверены отметка в интерфейсе, сохранение в облаке и её восстановление после последующей перезагрузки. Затем прошли отмена и частичное завершение. Изменён тест в рабочей ветке ([6d1e4fe](https://github.com/MusicMeasurer/shopping-app/commit/6d1e4febbe7743f8c5e5c78bfe2d6bd82d3b4edb)).
- [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43379740696) — 2/2. [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43379740218) — успешно. По решению пользователя сценарий без паузы исключён из плана проверок перед приёмкой на iPhone. Для этого случая зафиксирован успешный лабораторный прогон с паузой 2,5 секунды.

## 2026-11-13 · Завершение облачного списка без покупок (Инструкция 1)

- В `feature/e4-accepted-reintegration` добавлен третий цикл постоянного списка ([6248cc6](https://github.com/MusicMeasurer/shopping-app/commit/6248cc67256c277a47f53d0fa4806d9279378269)). Сервер подтвердил завершение «Ничего не куплено» и очистку активных товаров. После перезагрузки список остался доступен, в архиве сохранились ровно две прежние записи с исходным содержимым. [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43381244378) — 2/2; [интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43381244358) — успешно.
- Удаление облачного списка с сохранением архива остаётся отдельной задачей реализации. В рабочей ветке удаление списка через интерфейс доступно в локальном режиме. Облачные операции с метаданными поддерживают переименование, смену типа и порядка; сравнение серверных удалений относится к синхронизации позиций. Для облачного удаления списка предстоит реализовать подтверждения по состоянию отметок и серверную операцию с сохранением архива, затем проверить оба сценария в лаборатории. Физическая приёмка на iPhone впереди.

## 2026-11-13 · Удаление облачного списка с сохранением архива (Инструкция 1)

- В `feature/e4-accepted-reintegration` добавлено удаление личного облачного списка. При наличии отметок диалог предупреждает о потере незавершённых покупок из будущей истории и предлагает завершить отмеченные. Без отметок показывается обычное подтверждение. Удаление убирает активный список и его позиции, сохраняя архив. Использованы версионированная операция завершения, квитанция для безопасного повтора и атомарная очистка локальной привязки. [Коммит 3a560dd](https://github.com/MusicMeasurer/shopping-app/commit/3a560dd068f1afd433c2bb58c9aaa752b7421ac6).
- Миграция `e4_cloud_list_delete_preserve_archive` применена к `shoppingapp-migration-lab`. [PostgreSQL CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/43382292240) проверил пустой список, запрет удаления чужого списка и устаревшей ревизии, повтор запроса, сохранность архива и отметки удаления позиций для синхронизации. [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43382292287) — 2/2: предупреждение и предложение завершить, отмена, удаление списков с отмеченной и неотмеченной позицией, сохранность прежних архивных записей после перезагрузки. [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43382292332) прошли. Физическая приёмка на iPhone впереди.

## 2026-11-13 · Метаданные облачных списков и редактирование товаров (Инструкция 1)

- В `feature/e4-accepted-reintegration` проверены переименование, смена типа с постоянного на разовый и перестановка соседних списков. После перезагрузки сохранились название, тип, порядок и активный товар. Две прежние записи остались в архиве под историческим названием. [Коммит 2a77d49](https://github.com/MusicMeasurer/shopping-app/commit/2a77d49277945ee39f08053334379d4278e5e531).
- В облачном списке через редактор изменены название, количество и единица товара. Проверены запись 2,5 кг, отображение после перезагрузки, очистка обоих полей, повторная запись 3 л и сохранение 3 л в архиве. Существующий RPC сохранён для прежних клиентов и операций без полей E4. Миграция `e4_cloud_item_attributes_and_list_order` применена на `shoppingapp-migration-lab`.
- [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43383434892) — 2/2, включая предыдущие сценарии завершения и удаления. [Изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43383434961) — успешно, включая повтор операции, защиту от изменения её параметров, запрет чужой записи, сохранение архива и перестановку списков. [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43383434924) — успешная сборка, 269 тестов прошли, два пропущены, 36 браузерных регрессий E4 прошли. Физическая приёмка на iPhone впереди.

## 2026-11-13 · Смена аккаунтов и офлайн-перезапуск в E3↔E4 (Инструкция 1)

- Для ранее подтверждённого аккаунта сохранены название, тип и порядок привязанных облачных списков в IndexedDB. При офлайн-перезапуске восстанавливаются список и его привязка. Новые операции остаются в локальной очереди до возвращения сети и повторной проверки аккаунта. [Коммит b4a3516](https://github.com/MusicMeasurer/shopping-app/commit/b4a3516a8595a028f1be9a460e3b2c8996e1d3be).
- [Лабораторный прогон A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43384724514) прошёл на объединённой ветке в iPhone WebKit: переход A → выход → B → выход → A, изоляция покупок и сохранение гостевых данных, офлайн-перезапуск привязанного облачного списка и отправка двух покупок после подключения. Также прошли серверные проверки разграничения A/B, идемпотентности RPC, конфликтов версий и сохранения квитанций в IndexedDB. Первые два прогона остановились на устаревшем имени гостевого диалога и неоднозначной метке поля; исправлены селекторы.
- [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43384724564), [облачные регрессии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43384211091) и [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43384210960) прошли. Автоматический перенос исходных гостевых списков, товаров и архивов при первом входе и физическая приёмка на iPhone остаются открытыми.

## 2026-11-13 · Первый перенос гостевого профиля и локальный доступ после выхода (Инструкция 1)

- Первый перенос готовит снимок выбранного непривязанного профиля в IndexedDB. Снимок закрепляется за подтверждённым аккаунтом, исходный профиль остаётся на устройстве. Сервер выполняет перенос списков, товаров и архивных записей одной транзакцией и возвращает прежний результат при повторе той же операции. Если аккаунт сессии изменился, сервер отклоняет запрос. После выхода открывается последний локальный профиль; доступны сохранённые профили, включая аккаунтные локальные копии. Изменения товаров в привязанном списке ожидают повторной авторизации соответствующего аккаунта. [Коммит 9d21e5b](https://github.com/MusicMeasurer/shopping-app/commit/9d21e5b782f869f9423e10bd72f8e8c327a656cb).
- Миграция `e4_import_guest_profile` установлена на `shoppingapp-migration-lab`. [PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43386545402) проверила перенос архива и полей товара, идемпотентность и отказ при смене аккаунта. [Облачный WebKit и A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43386868382) подтвердили перенос гостевого списка с товаром, изоляцию B, переключение на исходный профиль после выхода, сохранность при офлайн-перезапуске. [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43386868390) прошли. Первоначальные прогоны выявили устаревшее ожидание в тесте профиля и неоднозначный выбор стандартного списка; тест использует уникальный список.
- Перенос архива проверен на уровне SQL. Физическая приёмка на iPhone и облачный браузерный сценарий миграции архивного списка остаются открытыми. Управление облачными списками и удаление локального аккаунтного профиля после выхода не входят в проверенный объём. Первичная миграция отправляет снимок на момент первой привязки; дальнейшие изменения исходной гостевой копии автоматически не копируются в облако.

## 2026-11-13 · Проверка гостевого архива и удаление локальной копии аккаунта (Инструкция 1)

- [WebKit A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43403076724) подтвердил, что завершённая гостевая покупка видна в облачном архиве A и отсутствует у B. После удаления локальной копии A и повторного входа облачный список, товар и архив снова доступны. Исходный гостевой профиль сохранился.
- Удаление профиля очищает его локальные товары, версии и привязки. Неотправленные изменения, незавершённые операции и ожидающий перенос блокируют удаление. При повторном входе списки и товары восстанавливаются из облака. Последний коммит реализации — [54bcaa9](https://github.com/MusicMeasurer/shopping-app/commit/54bcaa90f82754f0bb9b67203f0560b718087d47).
- [Сборка и интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43403076720), [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43403076711) и [повторный прогон облачных регрессий](https://github.com/MusicMeasurer/shopping-app/actions/runs/43403076660/attempts/2) прошли. В первом прогоне регрессий разовый список исчез из активных, после чего тест дождался тайм-аута при открытии архива. Повтор на том же коммите прошёл. Причина первого тайм-аута не установлена. Физическая приёмка на iPhone впереди.

## 2026-11-13 · Восстановление принятого интерфейса E4

- Эталон — исходники `snapshot/e4-ui-v1.0`; рабочая ветка — `feature/e4-accepted-reintegration`. Физическая проверка показала расхождение в сохранённом локальном профиле аккаунта после выхода: отсутствовали карточка создания, меню активной карточки, кнопки списка и многострочный ввод. Этот дефект не был покрыт прежним облачным сценарием удаления.
- Возвращены шапка E4, меню, панель действий, многострочный ввод, редактор товара и переход к архиву. Выбор локального профиля перенесён в настройки. Две позиции из одного ввода сохраняются с операциями синхронизации одной транзакцией. [Код](https://github.com/MusicMeasurer/shopping-app/commit/f00b002e7f7cb207d2966e966256df879e3e323c).
- [Локальная E4 и сборка](https://github.com/MusicMeasurer/shopping-app/actions/runs/43416273186) и [два облачных сценария WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43416272928) прошли. [Изолированный preview](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43415962900) отдаёт сборку `0a6892e`; последующие коммиты меняют только тесты. Физическая iPhone-приёмка и полный A/B с выходом и офлайн-перезапуском остаются открытыми на момент записи.
- После выхода в сохранённой копии аккаунта кнопки управления списками видны, но отключены до входа. Локальное редактирование товаров остаётся доступным. Принятое требование полного локального управления после выхода не закрыто. Отдельный чистый аккаунт для ручной приёмки не подготовлен.

## 2026-11-14 · Приёмка удаления на iPhone

- Тест 4 выявил общее сообщение об архиве для пустого списка и отсутствие предупреждения при удалении локального списка с отметками. Решение FR-002-03 от 12.11: незавершённые покупки при удалении не архивируются; уже созданные записи остаются. При наличии отметок предупредить и предложить завершение; без отметок — обычное подтверждение.
- В интеграционной сборке `dd43ce2` исправлены подтверждения локального и облачного удаления; из предупреждения можно завершить список с сохранением только отмеченных покупок. [Локальные браузерные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43546747058) прошли. [Тестовая сборка](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43546504701) развёрнута. Повтор теста 4 на iPhone и ручной тест 5 открыты.
- После согласования продолжения добавлена проверка именно повторного цикла постоянного списка: завершение отмеченных → новые отмеченные товары → подтверждение удаления → перезагрузка. Старая запись остаётся, новые товары отсутствуют в архиве. [Локальные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43547677094) и [повтор облачного WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43546536857/attempts/2) прошли. Последующий коммит меняет только тест, повторная ручная приёмка остаётся открытой.

## 2026-11-14 · Ручная приёмка на iPhone

- Тест 4 пройден по сообщению пользователя. Тест 5 заблокирован до создания списка.
- В тестовом аккаунте отображаются списки автотестов. На показанном облачном списке без подтверждённой локальной привязки недоступны добавление товара, завершение и удаление.
- При открытии пользователь видел полноэкранную проверку аккаунта, затем локальные списки и затем облачные. При возврате из фона ожидается сохранение оставленного экрана без промежуточных экранов. Холодный запуск проверить отдельно.
- При большом числе списков карточка «Новый список» скрыта в конце прокручиваемой сетки. Пользователь не смог начать тест 5. Доступность создания при заполненной сетке и управление существующими облачными списками остаются открытыми.

### Повтор теста 5 на iPhone после очистки тестового аккаунта

- Тест 5 пройден по сообщению пользователя. Прежняя блокировка относилась к попытке до очистки. Доступность карточки «Новый список» при заполненной сетке остаётся открытой проблемой.
- Требование пользователя: исключить создание списков с одинаковым именем. Область уникальности и правила сравнения имён предстоит уточнить перед реализацией.
- Открытый дефект: на iPhone окно «Завершить список» и горизонтальный ряд кнопок выходят за границы экрана. Крайние действия частично обрезаны. Все варианты завершения и отмена должны быть видны и доступны без горизонтальной прокрутки.

## 2026-11-14 · Согласование интерфейса открытого списка покупок

**Статус:** спецификация согласована. Реализация и приёмка впереди.

- Из области под названием убрать служебную информацию. Счётчик «Осталось» оставить под названием списка.
- В правом верхнем углу шапки разместить кнопку «⋯». Она открывает то же меню действий, которое сейчас открывается кнопкой «⋯» на карточке списка.
- Кнопку «✓» для завершения списка разместить непосредственно слева от «⋯». Обе кнопки занимают фиксированные места относительно правого верхнего угла шапки. Длина названия и переносы строк не сдвигают их. При прокрутке они перемещаются вместе с шапкой списка.
- Кнопку «✎» для переименования разместить рядом с названием. По вертикали она выровнена по верхнему краю первой строки. По горизонтали она расположена сразу за правым краем самой широкой отрисованной строки названия. Если самая широкая строка вторая или ниже, её ширина определяет горизонтальное положение кнопки, а сама кнопка остаётся на уровне первой строки.
- Из формы добавления убрать видимую надпись «Что надо купить?» (в текущей сборке «Что нужно купить?», включая подсказку про несколько строк). Поле ввода товара и кнопка «+» остаются.

**Критерии приёмки:**

1. Для короткого названия «Продукты» карандаш стоит сразу справа от названия. Для двухстрочного «Хозяйственные покупки», если шире первая строка, карандаш стоит справа от «Хозяйственные». Для названия, у которого шире вторая строка, правый край второй строки определяет отступ карандаша, при этом по вертикали он остаётся у первой строки.
2. При переходе между списками с коротким и многострочным названием кнопки «✓» и «⋯» остаются в тех же местах относительно шапки. Название и карандаш не перекрывают эти кнопки.
3. «⋯» в шапке открывает меню с теми же действиями, что «⋯» на карточке списка. «✓» запускает завершение списка. «✎» открывает переименование.
4. Под названием отображается счётчик «Осталось». Служебный текст в этой области и видимый заголовок над полем добавления отсутствуют. Товар по-прежнему можно добавить через поле и кнопку «+».

### Дополнение к спецификации интерфейса · главный экран и карточки списков

**Статус:** согласовано пользователем. Реализация и приёмка впереди.

1. **Типографика карточек.** В каждом стиле названия списков и подпись «Новый список» имеют одинаковые гарнитуру, начертание и размер. База для расчёта — размер текста «Новый список» в соответствующем стиле до доработки. В стандартном стиле общий размер равен 110% прежней базы стандартного стиля, в крупном — 80% прежней базы крупного стиля.
2. **Меню карточки.** Кнопка «⋯» без видимого круга отображается на каждой карточке существующего списка, включая неактивные. Нажатие открывает меню действий именно той карточки, на которой нажата кнопка.
3. **Поле добавления товара.** Подсказку «Например, молоко» заменить на «Добавьте покупку».
4. **Главный заголовок.** Убрать надпись «ПОКУПКИ · E4 (разработка)». Заголовок «Всё по списку» заменить на «Надо купить», сохранив его шрифт. Под заголовком вместо слогана «Меньше держать в голове. Больше успевать.» отображать номер версии приложения.
5. **Верхняя строка.** Слева кнопка меню «☰». До входа напротив неё у правого края расположена кнопка «Войти». После входа на той же строке отображаются название аккаунта и кнопка «Аккаунт», выровненная по правому краю. Длинное название аккаунта сокращается многоточием, сохраняя положение кнопки.

**Критерии приёмки:** в обоих стилях размер названий и подписи «Новый список» совпадает и соответствует расчёту от прежней базы. Меню вызывается и с неактивной карточки и относится к выбранному списку. В поле ввода видна новая подсказка. До и после входа меню и кнопка справа занимают одну строку, в том числе при длинном названии аккаунта. Ранее согласованные правила шапки открытого списка и счётчика «Осталось» применяются вместе с этим дополнением.

## 2026-11-14 · Функциональный дефект выхода из аккаунта на iPhone

**Статус:** открыт, требуется исправление. Наблюдение пользователя и два скриншота с iPhone (20:09). Причина сбоя не установлена.

**Последовательность воспроизведения:**

1. В активной сессии нажать «Выйти» в меню аккаунта. Приложение открывает экран «Проверяем аккаунт…» и остаётся на нём после длительного ожидания. Режим без входа не открывается.
2. Перезапустить приложение. Оно сообщает «Аккаунт заблокирован до завершения выхода» и «Предыдущий выход не завершён. Повторите выход из аккаунта».
3. Нажать «Повторить выход». Снова открывается экран «Проверяем аккаунт…», выход по наблюдению пользователя не завершается.

**Критерии проверки исправления:** при штатной сети выход завершается переходом в режим без входа и остаётся завершённым после перезапуска. Если сетевой запрос выхода задерживается или завершается ошибкой, приложение показывает понятный результат и даёт повторить выход без бессрочного ожидания. Повтор после перезапуска должен восстановить прерванную операцию, а списки предыдущего аккаунта должны оставаться скрытыми, пока выход не подтверждён. В проверку включить штатный выход, ошибку или задержку сети, перезапуск во время выхода и успешный повтор после восстановления связи.

## 2026-11-14 · Согласование окон, индикаторов и пиктограмм списков

**Статус** — согласовано пользователем. Реализация и приёмка впереди.

### Редактирование товара и настройки

- Редактор товара и настройки открываются поверх текущего экрана по образцу окна «Новый список». Фон затемняется. После закрытия пользователь возвращается к тому же экрану, выбранному списку и позиции прокрутки.
- На iPhone при открытой клавиатуре поля и действия сохранения и отмены остаются доступны. Отмена закрывает окно без применения изменений.

### Принадлежность списка и состояние синхронизации

| Состояние | Карточка списка | Открытый список |
| --- | --- | --- |
| Локальный список | Без значка облака | Без значка облака |
| Облачный список при подключённом аккаунте | Контур облака | Контур облака рядом со счётчиком «Осталось» |
| Облачный список после выхода из аккаунта | Облако со знаком паузы | Облако со знаком паузы рядом со счётчиком и короткая подсказка «Войдите для синхронизации» |

- При выходе облачная принадлежность списка по-прежнему видна на его сохранённой локальной копии. Значок паузы показывает, что синхронизация приостановлена. Контур облака показывает принадлежность списка к облаку при подключённом аккаунте и сам по себе не подтверждает отправку последних изменений.
- У значков есть доступные текстовые подписи. Обозначение принадлежности визуально отличается от пиктограммы, которую пользователь выбирает для списка.

### Тип списка

- На карточке и в открытом списке рядом со счётчиком «Осталось» тип отображается статическим значком. Песочные часы обозначают разовый список, круговые стрелки — постоянный. Значки имеют текстовые подписи для средств доступности. Нажатие на индикатор не меняет тип.
- Текущую кнопку прямого переключения типа убрать. Тип меняется через общее меню «⋯» в шапке списка или на карточке. Действие «Изменить тип списка» открывает выбор «Разовый» или «Постоянный» с отметкой текущего значения. Изменение применяется при явном выборе варианта.

### Пиктограммы списков

- Сохранить существующие варианты и дополнить набор пиктограммами 🍎, 🧴, 🐾, 🧰, 🎁, 🎒, 🪴 и 💊. Универсальный вариант по умолчанию — 🛒.
- Увеличить пиктограмму на карточке ориентировочно на 25% от текущего размера для каждого из двух стилей. На iPhone проверить размещение длинного названия, меню «⋯» и индикаторов при увеличенной пиктограмме.
- Один и тот же выбор пиктограмм доступен при создании списка, при редактировании через «✎» и через пункт «Изменить пиктограмму» в меню «⋯» на карточке и в шапке открытого списка. Текущая пиктограмма выделена. Новый выбор применяется при сохранении.

**Проверка на iPhone** — открыть и закрыть оба окна с клавиатурой и без неё, проверить три состояния принадлежности и оба типа на карточке и в открытом списке, сменить тип через оба меню, выбрать пиктограмму при создании и через каждую точку редактирования. Проверить оба стиля карточек, короткие и длинные названия, сохранение выбранной пиктограммы.

## 2026-11-14 · Результаты ручных тестов и принятый план доработок

- По подтверждению Ильи, ручные тесты 1–3 на iPhone пройдены. Тесты 4 и 5 ранее отмечены как пройденные. Итого тесты 1–5 пройдены. Отдельные замечания к возврату в приложение, выходу из аккаунта, управлению существующими облачными списками, доступности создания и окну завершения остаются в плане.

**Функциональные задачи в принятом порядке**

1. Выход из аккаунта и возврат в приложение. Устранить зависание и проверить повтор выхода после перезапуска. При возврате из фона сохранять оставленный экран без полноэкранной проверки и переключения с локальных списков на облачные. Холодный запуск проверить отдельным сценарием.
2. Имена списков и дубли базовых карточек. Проверить предотвращение дублей «Продуктов» и «Хозяйственных покупок» при повторном входе и переносе локальных данных, а также сквозную проверку имён при создании и переименовании. Рабочая ветка содержит локальную проверку имён и черновик облачного ограничения для CI. Способ обработки уже существующих дублей требует отдельного согласования.
3. Управление существующими облачными списками. На списке, созданном на другом устройстве или до текущего входа, проверить добавление товаров, завершение и удаление после подтверждения его принадлежности аккаунту.

**Интерфейсные задачи в принятом порядке**

4. Модальные окна на iPhone. Уместить все действия и отмену окна завершения в ширину экрана. Открывать редактор товара и настройки поверх текущего экрана, проверить работу с клавиатурой и сохранение позиции прокрутки.
5. Главный экран, карточки и шапка списка. Применить согласованные компоновку верхней строки и шапки списка, заголовок, номер версии, типографику карточек, меню и текст поля добавления. Сохранить доступ к «Новому списку» при заполненной сетке.
6. Индикаторы облака и типа списка. Добавить согласованные обозначения принадлежности и паузы синхронизации, показать тип статическим значком, менять тип через «⋯».
7. Выбор пиктограммы. Увеличить пиктограммы карточек, расширить набор и сделать единый выбор доступным при создании, через карандаш и из обоих меню «⋯».

Илья согласовал план и разрешил начать функциональные задачи по Инструкции 1 в рабочей ветке. Публикация приложения и интерфейсная реализация остаются отдельными шагами.

### Функциональные доработки в рабочей ветке

- Выход и возврат в приложение. Коммит [bf4034a](https://github.com/MusicMeasurer/shopping-app/commit/bf4034a6063e51caef12e78f597ec320162b6a6c) ограничивает ожидание Auth, сохраняет блокировку аккаунтного экрана при незавершённом выходе и оставляет открытый список на экране при временной ошибке проверки той же сессии. Серверная проверка личности для облачных операций сохранена. [Сборка и интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591093652) прошли. Первый hosted A/B прогон остановился на ожидании сетевого запроса при искусственном событии видимости. Тест изменён на проверку выбранного экрана при временной потере связи. Модульный тест отдельно проверяет временный отказ проверки сессии.
- Имена и существующие облачные списки. Коммит [2b70626](https://github.com/MusicMeasurer/shopping-app/commit/2b70626222a02076c42b98be0e8c52d92d56f48e) сохраняет диалог переименования при отклонённом имени, уточняет подготовку переноса базовых списков и обнаруживает списки, созданные отдельно, при фоновом обновлении аккаунта. Облачная привязка производится по идентификатору подтверждённого владельца. Проверено наличие активного ограничения повторяющихся имён в лаборатории `shoppingapp-migration-lab`. Существующие дубли сохранены.
- Проверки на соответствующих коммитах — [полный облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591389642), [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591389631), [повтор hosted A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591457092), [сборка и регрессии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591457148). Итог проверок и ручная перепроверка изменений фиксируются отдельно.

### Итог автоматической проверки функциональных задач

- [Итоговая версия рабочей ветки](https://github.com/MusicMeasurer/shopping-app/commit/d743b506b19419cac6c22ac271967b3f8f0817bd). [Сборка, модульные и локальные браузерные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591956649) прошли. [Изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591389631) прошла, в том числе повтор импорта и запрет конкурентного создания одинаковых имён.
- [Hosted A/B в iPhone WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591956665) прошёл после проверки ошибки выхода отключением сети на уровне браузера. Подтверждены сохранение открытого списка при возврате без сети, восстановление выбранного списка после холодного запуска, блокировка аккаунтного экрана после ошибки выхода, повтор после перезапуска и сохранение факта выхода. Также прошли переключение A/B, изоляция и восстановление офлайн-очереди.
- [Облачный iPhone WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591619071) — 2 сценария пройдены. Подтверждены отказ при создании и переименовании в занятое имя, обнаружение списка второго клиента на уже открытом экране, добавление товара, завершение и удаление списка. Повторный прогон учёл, что два тестовых списка могут стоять не рядом.
- Физические тесты 1–5 относятся к предыдущей сборке. Перепроверка новых исправлений на физическом iPhone впереди. Существующие дубли требуют отдельного решения. Изменения приложения находятся в рабочей ветке. Публикация приложения не выполнялась.

## 2026-11-15 · Ручная приёмка на iPhone: первый вход, локальные профили и облачный аккаунт C

**Среда:** тестовое превью, новый профиль Safari «Приёмка», чистый тестовый аккаунт C в `shoppingapp-migration-lab`. По отчёту Ильи, облачный сценарий повторён в другом браузере. Точный SHA физически проверенной сборки не зафиксирован. Для сопоставления использованы [реализация первого переноса](https://github.com/MusicMeasurer/shopping-app/commit/9d21e5b782f869f9423e10bd72f8e8c327a656cb), [фильтр стартовых списков](https://github.com/MusicMeasurer/shopping-app/commit/2b70626222a02076c42b98be0e8c52d92d56f48e) и [автоматические регрессии выхода и профилей](https://github.com/MusicMeasurer/shopping-app/actions/runs/43591956665). Эти ссылки не удостоверяют SHA ручного прогона.

| Сценарий | Наблюдение | Оценка |
| --- | --- | --- |
| 1. Первый вход в C | До входа в «Моих покупках» были базовые карточки и «Локальный до входа». В C виден только «Локальный до входа». | Перенос пользовательского списка подтверждён. Исключение из импорта пустых неизменённых стартовых списков соответствует проверенной реализации. Базовые списки с товарами или изменёнными параметрами отдельно не проверены. |
| 2, 5. Выход из C | Открывается «Локальный профиль 2» со списком «Локальный до входа». Повторный выход возвращает в тот же профиль. | Штатный выход и возврат в сохранённый локальный профиль аккаунта подтверждены. |
| 3, 4. Исходный профиль | После первого входа и выхода в исходных «Моих покупках» виден только «Локальный до входа». Отметка «Яблоки» в этом профиле не появилась в C после входа. | Изоляция изменений исходной копии подтверждена. Исчезновение базовых карточек из исходного профиля — отдельное отклонение от ожидаемой сохранности его содержимого, если это были сохранённые локальные списки. Причина и наличие записей в хранилище не установлены. |
| 6, 7. Обмен данными C и его локальной копии | Отметка «Яблоки» в «Локальном профиле 2» появляется в C при входе. Добавленные в C «Хлеб, 2 шт.» видны после выхода в «Локальном профиле 2». | Подтверждены отправка отметки и получение товара для этого списка. |
| 8.1. Локальные действия после входа | В локальном профиле недоступны создание списка, архив и действия над существующими списками. | Открыто. При активной сессии показ только аккаунтных списков согласован. Если действия отсутствуют в локальной копии после выхода, это функциональный разрыв с согласованным локальным доступом. Если независимый локальный профиль виден при активной сессии, требуется уточнить, какой режим показан и предполагается ли работа в нём. |
| 8.2, 9. Облачная работа | В C действия со списками доступны, завершение даёт запись в архиве. Созданные списки видны в другом браузере. | Облачная доступность списков и наблюдавшийся сценарий архива подтверждены. Видимость архива во втором браузере отдельно не подтверждена. |

**Предыдущая приёмка:** Илья подтвердил защиту от одинаковых имён и дублей базовых карточек. Прежние неоднозначные наблюдения по облачным спискам разделены этим прогоном на независимый исходный профиль и локальный профиль аккаунта. Штатный выход принят. Сетевой сбой выхода, холодный запуск и полный offline → перезапуск → online этим ручным прогоном не подтверждены; автоматические результаты указаны выше.

**Назначенная точечная проверка (результат ниже):** без входа сопоставить базовые карточки в исходном профиле до и после первого входа и выхода; проверить создание списка, архив и действия в «Моих покупках» и в локальном профиле C отдельно, записав активную сессию и профиль для каждого шага. Не требуется повторять уже подтверждённый штатный обмен отметкой и товаром. Полная приёмка E3↔E4 остаётся открытой.

### Повторная проверка после выхода из C (15.11)

- «Локальный профиль 2» (локальная копия C): архив отсутствует, карточка «Новый список» видна, нажатие недоступно. Меню существующего списка отдельно не подтверждено. Ограничения локальной копии остаются открытыми для приёмки.
- «Мои покупки»: базовые карточки на месте, все кнопки и архив доступны. Ранее отмеченное исчезновение карточек при повторной проверке не воспроизведено.
- По ручной проверке Ильи, архив аккаунта C и архив «Моих покупок» корректно работают при цикле входа и выхода. Отсутствие архива в локальной копии C остаётся отдельным результатом. Код и база в рамках фиксации не изменялись.

### Доработка локальной копии аккаунта

- По ручной проверке Ильи после выхода из C в «Локальном профиле 2» также недоступно завершение списка. Диалог завершения в локальном режиме отличается от облачного. Оба отклонения добавлены к отсутствию архива и недоступности создания списка.
- [Код в рабочей ветке](https://github.com/MusicMeasurer/shopping-app/commit/c24260cc766d13ca40d19a9b0e0add266074bb91): локальный и облачный режимы используют общий диалог вариантов завершения. Локальная копия аккаунта показывает последний успешно загруженный архив из IndexedDB; кэш разделён по аккаунтам и удаляется при удалении соответствующего локального профиля.
- Создание и завершение облачного списка после выхода остаются открытыми. Очередь товаров не покрывает создание списка и завершение цикла; серверное завершение опирается на проверенную ревизию и идемпотентную квитанцию. Нужен сценарий сохранения запроса после выхода, его привязки к тому же аккаунту и обработки конфликта при повторном входе.
- Локальная сборка успешна, 280 тестов прошли, 2 пропущены. [Интеграционный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/43714827768), [WebKit с облачной лабораторией](https://github.com/MusicMeasurer/shopping-app/actions/runs/43714827793). Пользовательская приёмка изменений предстоит. Регистрация в текущем объёме не разрабатывается.

- [Прогон hosted A/B 43714994300](https://github.com/MusicMeasurer/shopping-app/actions/runs/43714994300) на [2d6127b](https://github.com/MusicMeasurer/shopping-app/commit/2d6127b799a5209e50a67d560ea78f12096cd9e9) прошёл. WebKit подтвердил доступ к сохранённому архиву аккаунта после выхода и перезапуска. В [b03f209](https://github.com/MusicMeasurer/shopping-app/commit/b03f20948967e39c79c34d56b663313f5b66dd8c) кнопка завершения ждёт завершения локального сохранения товара, чтобы нажатие не терялось. Проверки этой версии: [E3/E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715095141), [облако WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715095150), [временная PostgreSQL и браузеры](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715095183).

- [fffdd5b](https://github.com/MusicMeasurer/shopping-app/commit/fffdd5bab2f6a7d12c6cd89d5f8933c19dcbc763) переносит кнопки диалога на узком экране, включая отмену. После изменения [сборка, модульные тесты и браузерная приёмка E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715305972) и [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715305955) прошли. Предыдущая [репетиция PostgreSQL и браузеров](https://github.com/MusicMeasurer/shopping-app/actions/runs/43715095183) завершилась тайм-аутом сценария отмены в отдельном браузерном наборе; этот набор на fffdd5b отдельно не запускался. Ручная приёмка iPhone не проводилась. Приложение не опубликовано.

## 2026-11-16 · Согласованный объём локального режима

Илья согласовал ограничение текущего этапа: создание и завершение списков в локальной копии аккаунта после выхода пока недоступны. К обоим сценариям возвращаемся при работе над общими списками (E8).

- Архив после выхода и общий диалог завершения опубликованы на [полигоне iPhone `/integration/`](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=fffdd5b). [GitHub Pages](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43759299803) завершился успешно. Публичный `revision.txt` подтвердил `fffdd5bab2f6a7d12c6cd89d5f8933c19dcbc763`. Ручная приёмка на iPhone впереди.

## 2026-11-16 · Ручная приёмка окна завершения и интерфейсная задача 1

- Илья подтвердил ручную проверку окна «Завершить список» на iPhone на полигоне `fffdd5b`. Все варианты и отмена доступны. Ручная приёмка этого окна пройдена.
- По Инструкции 1 в [рабочей ветке](https://github.com/MusicMeasurer/shopping-app/commit/70684ceef2945320f02c15a009d6706d71ef6b2b) редактор товара и настройки теперь открываются модально поверх текущего экрана. Окна учитывают высоту видимой области, содержимое прокручивается внутри диалога. Настройки оформления сохраняются по явному подтверждению; отмена отбрасывает черновик. Действия с локальными профилями сохраняют прежнее поведение.
- [Регрессии E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43760185615), [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43760161738) и [перепроверка A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43760185630). Ручная приёмка новых окон на физическом iPhone, в том числе с открытой экранной клавиатурой, впереди.
- Итог рабочей ветки — [9b224ca](https://github.com/MusicMeasurer/shopping-app/commit/9b224caf86395e92af09a5ea20c4fcab0248fe9e). Сборка и 280 модульных тестов прошли, 2 пропущены. Браузерные проверки E4 прошли в WebKit и Chromium. [A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43760185630/attempts/2) и [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43760161738/attempts/3) прошли при повторе после тайм-аутов на восстановлении сессии и операциях со списками. Опубликованный полигон не обновлялся.

## 2026-11-16 · Интерфейсная задача 2: главный экран, карточки и шапка списка

- [Реализация](https://github.com/MusicMeasurer/shopping-app/commit/59676d409997f469a063bee7b0d9f2eaee1cbb12) в ветке `feature/e4-accepted-reintegration`. Верхняя строка разделяет меню и аккаунт. На главном экране «Надо купить» и версия пакета. Названия карточек и подпись «Новый список» имеют размер 11 px в стандартном и 9,6 px в крупном стиле. Действие создания расположено под прокручиваемой сеткой.
- Меню доступно на каждой карточке и в шапке. Действия адресуются выбранной карточке. В шапке кнопки завершения и меню закреплены справа, положение карандаша рассчитывается по самой широкой строке. Счётчик «Осталось» под названием. Видимую подпись поля заменяет подсказка «Добавьте покупку», доступная метка поля сохранена.
- Итог ветки — [133a6c9](https://github.com/MusicMeasurer/shopping-app/commit/133a6c98358fd98fffb33d0cfd660baee8ff500c). Прошли [сборка, тесты и браузерные сценарии E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43766200559), [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43766200618), [A/B и Supabase](https://github.com/MusicMeasurer/shopping-app/actions/runs/43765964124) и [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43765756257). Первые прогоны выявили неоднозначные селекторы и гонку между сохранением типа и перезагрузкой в тесте. После уточнения сценариев проверки прошли.
- Ручная проверка на физическом iPhone впереди. Полигон не обновлялся.

## 2026-11-16 · Интерфейсная задача 3: принадлежность и тип списка

- [Реализация adb409b](https://github.com/MusicMeasurer/shopping-app/commit/adb409b300423b32e1f04fe27cdc4cbedb19fc73) в `feature/e4-accepted-reintegration`. Карточка и шапка показывают тип списка и, для облачного списка, облако с состоянием подключения или паузы. В сохранённой копии после выхода рядом со счётчиком показывается «Войдите для синхронизации». Продолжение офлайн с сохранённой сессией обозначается паузой без предложения войти.
- Пункт «Изменить тип списка» в обоих меню «⋯» открывает окно с отмеченным текущим типом. Изменение применяется при явном выборе, отмена закрывает окно. Используются действующие локальные и облачные операции изменения типа.
- Прошли [сборка и браузерные проверки E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43768565466), [A/B и проверка состояния после выхода](https://github.com/MusicMeasurer/shopping-app/actions/runs/43768565521), [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43768565462) и [повтор облачного WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43768565443/attempts/2). Первый облачный прогон прошёл сценарий постоянного списка и остановился по тайм-ауту на этапе создания разового. При повторе оба сценария прошли. Полигон не обновлялся. Ручная приёмка на iPhone впереди.

## 2026-11-16 · Интерфейсная задача 4 и полигон для приёмки

- [10fd22f](https://github.com/MusicMeasurer/shopping-app/commit/10fd22f96521e66b67db56a3a9604bbb93818213) в `feature/e4-accepted-reintegration`. Единый выбор пиктограммы при создании, через карандаш и через оба меню «⋯». Добавлены восемь согласованных пиктограмм, корзина используется по умолчанию. Текущий выбор отмечен, отмена сохраняет исходное значение. Размер пиктограмм в обоих стилях увеличен на 25%.
- Пиктограмма локального списка хранится в его записи. При переносе гостевого списка и при создании или редактировании облачного списка предпочтение хранится в локальной привязке аккаунта на устройстве, включая сохранённую копию после выхода. Между устройствами это предпочтение не синхронизируется. Схема Supabase не менялась.
- Прошли [сборка, Vitest и браузерные проверки E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43776614691), [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43776614687), [повтор A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43776359945/attempts/2) и [повтор облачного WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43776359925/attempts/2). В первых прогонах обнаружены попытки ввода до закрытия окна создания, а также тайм-ауты облачного удаления и архива. После ожидания закрытия окна и отдельного повторного запуска облачных прогонов проверки прошли.
- Интерфейсные задачи 1–4 опубликованы на [прежнем полигоне /integration/](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=10fd22f). [Развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43777436705) успешно, опубликованные ревизия `10fd22f` и область действия манифеста проверены. Открыта ручная приёмка на iPhone: редактор и настройки с клавиатурой, длинные названия и оба стиля карточек, индикаторы до и после выхода, смена типа и сохранение пиктограммы через доступные точки входа.

## 2026-11-16 · Замечания по приёмке интерфейса на iPhone

- На полигоне `10fd22f` Илья подтвердил прохождение тестов 2 и 3, за исключением перекрытия названия карандашом. В тесте 1 сохранение правок облачного товара не закрыло редактор, после его ручного закрытия отображалась общая ошибка сохранения, повторная загрузка не применяла правку.
- Дополнительно отмечены неверная база размера текста в крупном стиле и переключение активного списка при завершении или удалении через меню другой карточки.
- [Исправления 1baeb76](https://github.com/MusicMeasurer/shopping-app/commit/1baeb762b5fbabbfc45bf30e27b26211eb051815): крупный размер 24 px из фактической прежней базы 30 px, стандартный 11 px из базы 10 px. Карандаш получает ширину названия через общий контейнер. Завершение и удаление адресуются идентификатору выбранной карточки, открытый список сохраняется, пока он существует.
- При правке облачного товара редактор ждёт подтверждения предыдущей операции, если она ещё находится в очереди, и сохраняет новое изменение с подтверждённой версией. При ошибке сообщение видно внутри открытого редактора. Исходная причина на устройстве не установлена по общему сообщению на скриншоте. Повторная приёмка требуется для сохранения и положения карандаша.
- Прошли [сборка и регрессии E4](https://github.com/MusicMeasurer/shopping-app/actions/runs/43779418220), [A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43779418197) и [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43779418224). В [облачном WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43779418203) разовый список и правка атрибутов товара прошли, прогон остановился по тайм-ауту при повторном открытии облачного архива. Полигон остался на `10fd22f`.

## 2026-11-16 · Повторное открытие облачного архива в WebKit

- В журнале неуспешного прогона зафиксированы параллельная проверка выхода под тем же тестовым аккаунтом и ответ 403 в браузере. Журнал не привязывает 403 к конкретному запросу, поэтому отзыв сессии остаётся вероятной причиной конкретного сбоя. Два workflow лаборатории теперь используют общую группу последовательного запуска. Вспомогательные клиенты тестов завершают только собственную сессию.
- В [fb7b033](https://github.com/MusicMeasurer/shopping-app/commit/fb7b033ac4c07c67fe665d5cc5d62697427eb9b3) кнопка архива сохраняет доступное имя во время загрузки, архивные HTTP-запросы ограничены 12 секундами каждый, ранее загруженные записи остаются при ошибке. Итоговый [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43781867254) прошёл с реальными запросами, включая повторное открытие архива. Имитация сетевой ошибки в WebKit не дала воспроизводимой проверки и исключена из этого сценария. Тайм-аут проверяется на уровне клиента.
- Прошли [сборка и браузерные регрессии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43781867246), а на коммите с тем же кодом приложения — [A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43780992415) и [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43780992351). Версия на полигоне проверена по `revision.txt`: `10fd22f`.

## 2026-11-16 · Публикация исправлений интерфейса на полигоне

- На [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=fb7b033) опубликован [fb7b033](https://github.com/MusicMeasurer/shopping-app/commit/fb7b033ac4c07c67fe665d5cc5d62697427eb9b3). [Сборка и развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43790985945) прошли. После развёртывания страница вернула HTTP 200, `revision.txt` показал полный SHA, а `id`, `start_url` и `scope` манифеста соответствуют `/shopping-app-preview/integration/`. Публикация выполнена в репозитории полигона; миграции и развёртывание в основной среде не запускались.
- Открыта повторная приёмка на физическом iPhone: размер текста в крупном стиле, доступность карандаша при длинном названии, сохранение активного списка при завершении или удалении другого списка, сохранение правок облачного товара с закрытием редактора и повторное открытие облачного архива. Статусы требований и этапов остаются прежними.

## 2026-11-16 · Повторная приёмка крупного стиля и правок после выхода

- Илья сообщил, что тесты на полигоне `fb7b033` прошли, и выявил два дополнительных дефекта. В крупном стиле обрезались части букв длинных названий. В локальном профиле, связанном с аккаунтом, второе сохранение правки товара блокировалось ожиданием синхронизации.
- Согласованы две строки фиксированной высоты при размере текста 24 px и объединение ещё не отправленных правок товара. В [405a2d5](https://github.com/MusicMeasurer/shopping-app/commit/405a2d5741e7fa8811bca58bc60248240659949e) заголовок целиком помещается в отведённую область, длинное название сокращается многоточием. Локальный товар и запись очереди обновляются атомарно. Перед отправкой полезная нагрузка фиксируется для безопасного повтора, исходная версия сохраняется для проверки конфликтов. Для записей старых версий без признака об отправке применяется прежнее ожидание подтверждения.
- [Интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/43794454458) прошли, включая геометрию заголовка и 46 браузерных сценариев в Chromium и WebKit. Тест хранилища подтвердил объединение правок после перезапуска и сохранение содержимого операции после начала отправки. [Облачные браузерные сценарии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43794454428) прошли. Дополнительный [прогон A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/43794269304) отменён в очереди и не засчитан.
- [Развёртывание полигона](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43794628940) прошло. [Полигон](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=405a2d5) отдаёт ревизию `405a2d5`, область действия PWA проверена. Открыта повторная проверка на физическом iPhone двух строк и последовательных правок после выхода, с перезапуском и последующим входом.

## 2026-11-16 · Отметка покупки после локальной правки и плотность карточек

- Илья подтвердил прохождение повторной приёмки `405a2d5`. Дополнительные замечания: после локальной правки товара отметка «куплено» возвращала ошибку сохранения, в стандартной карточке оставался лишний отступ снизу, пиктограммы обоих стилей требовалось увеличить на 20%.
- В [4a5fe5e](https://github.com/MusicMeasurer/shopping-app/commit/4a5fe5e5d8f751eb7923ac44df52ced75dc7bbed) отметка покупки и её снятие объединяются с ещё не отправленной правкой того же товара. Регрессия проверяет сохранение количества и отметки через перезапуск и неизменность операции после начала отправки. Стандартная карточка стала компактнее с сохранением двух строк. Пиктограммы увеличены от размеров предыдущего полигона: стандартная с 22,5 до 27 px, крупная с 28,75 до 34,5 px.
- Прошли [сборка и Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43800572858), [облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43800572865) и [A/B в лаборатории на коммите с тем же кодом очереди](https://github.com/MusicMeasurer/shopping-app/actions/runs/43800360427).
- [Полигон](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=4a5fe5e) отдаёт ревизию `4a5fe5e`, HTML и область действия PWA проверены после [развёртывания](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43800753825). Открыта проверка на физическом iPhone: отредактировать товар после выхода, отметить покупку и проверить оба изменения после входа, сверить карточки в двух стилях.

## 2026-11-16 · Правила разрешения конфликтов товаров

- Илья согласовал автоматический выбор значения по времени для конкурирующих правок описания и отметки покупки. Независимые поля объединяются, для количества и единицы используется одна пара, при равенстве времени сохраняется облачное значение. Удаление против правки требует явного выбора из строки товара в списке с меткой конфликта. Решение внесено в [архитектуру](02_ARCHITECTURE.md).
- Реализовано в [8af0fcd](https://github.com/MusicMeasurer/shopping-app/commit/8af0fcda5b4ff3a9e78e6bdc1c3fed78e7672d97). Локальная метка хранится для изменённого поля, облачная берётся из `updated_at` записи товара. При нескольких серверных правках эта метка относится к последней записи товара в целом. Правка из старой версии приложения без исходного снимка и меток сохраняется в очереди при конфликте версий. Восстановление облачно удалённого товара создаёт новую активную запись. Схемы IndexedDB и Supabase не менялись.
- Прошли [сборка и Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/43864583575), включая переход от метки товара к диалогу, и [Hosted A/B и реальные RPC](https://github.com/MusicMeasurer/shopping-app/actions/runs/43864319305), включая автоматическое слияние независимых полей и явный выбор при конфликтующем удалении. [Облачные браузерные регрессии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43864121306) прошли на том же коде приложения.
- Полигон остаётся на `4a5fe5e`. Ручная приёмка конфликтов на iPhone и втором устройстве открыта.

## 2026-11-16 · Облачные метки отдельных полей и публикация конфликтов

- Исправлена привязка метки к товару целиком. [Миграция 031](https://github.com/MusicMeasurer/shopping-app/commit/2ab2cfb93548bb650704382ea6f19641f17635db) добавляет серверные метки названия, количества с единицей и отметки покупки. Для записей до миграции исходная метка равна последнему времени записи товара, затем группы обновляются независимо. Миграция прошла [изолированную PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/43867035534) и установлена на тестовом Supabase `shoppingapp-migration-lab`. Проверены триггер и отсутствие прямых прав записи новых меток у authenticated.
- В [347ba79](https://github.com/MusicMeasurer/shopping-app/commit/347ba79c718586979bbbcd7920e8f963dc14f187) конфликтующая старая операция очереди без исходного снимка сохраняется отдельно и больше не задерживает синхронизацию остальных товаров, включая тот же список. Исходные данные операции сохраняются после перезапуска.
- Прошли [сборка, 288 автоматических тестов и браузерные сценарии](https://github.com/MusicMeasurer/shopping-app/actions/runs/43867316464), [Hosted A/B и реальные RPC](https://github.com/MusicMeasurer/shopping-app/actions/runs/43867316423). Практический сценарий с облачными 3 л, более поздними локальными 2 л и ещё более поздним облачным переключением отметки подтвердил сохранение 2 л вместе с изменением отметки.
- [Полигон](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=347ba79) отдаёт ревизию `347ba79`. Проверены HTML и область действия PWA после [развёртывания](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/43867707063). Открыта ручная приёмка конфликта количества и удаления. Для закрытия E3↔E4 также открыты полный физический офлайн-цикл на iPhone, перенос гостевого архива при первом входе и независимый аудит.
- Пользователь уточнил последовательность: физическая приёмка Android перенесена за E8. [Дорожная карта](03_ROADMAP.md), [требования](01_REQUIREMENTS.md) и [архитектура](02_ARCHITECTURE.md) актуализированы.

## 2026-11-17 · Ручная приёмка конфликтов и доработки интерфейса

Проверена сборка полигона [347ba79](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=347ba79).

- **Тест 1, конфликт количества и поздняя отметка «куплено».** На двух устройствах сценарий прошёл. На одном устройстве в двух браузерах осталось 3 л при ожидаемых 2 л. Межбраузерное расхождение остаётся открытым для воспроизведения и диагностики.
- **Тест 2, удаление против правки.** Илья расширил сценарий и подтвердил успешный результат во всех проверенных случаях.

### Доработки к реализации

1. Если нет ни одного списка, скрывать форму добавления товаров. Вместо неё можно показать подсказку «Чтобы добавить товары, создайте список».
2. Добавить «шт.» и «уп.» в варианты единиц измерения товара.

## 2026-11-17 · Пустое состояние списков и быстрый выбор единиц

- В [9479c7e](https://github.com/MusicMeasurer/shopping-app/commit/9479c7ef1d2435b13ca4f7671dd365e00e857212) при отсутствии списков форма добавления заменена подсказкой «Чтобы добавить товары, создайте список». После создания списка форма появляется. В редакторе товара доступны «шт.» и «уп.» и ручной ввод. Эти сокращения с точкой распознаются и при добавлении товаров текстом.
- Прошли [сборка, 289 автоматических тестов и мобильные Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44085357291), [облачные браузерные сценарии](https://github.com/MusicMeasurer/shopping-app/actions/runs/44085357227) и [изолированная проверка PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44085357293). Браузерный тест подтвердил отсутствие формы после удаления последнего списка и перезагрузки, возвращение формы после создания нового списка и сохранение единицы.
- [Полигон](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=9479c7e) отдаёт ревизию `9479c7e`; HTML и область действия PWA сверены после [развёртывания](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44085780048). Открыта ручная приёмка на iPhone.
- По решению Ильи диагностика межбраузерного расхождения в тесте конфликтов отложена. Причина расхождения не установлена.

## 2026-11-17 · Приёмка интерфейса и подготовка к выпуску

- Илья подтвердил, что обе доработки на [полигоне `9479c7e`](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=9479c7e) работают. Приёмка пустого состояния списка и быстрого выбора единиц закрыта. [CI интеграции](https://github.com/MusicMeasurer/shopping-app/actions/runs/44085357291) и [облачные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/44085357227) прошли.
- Перед публикацией пользовательской сборки убрать служебные поля и панели. При уборке проверить доступность пользовательского архива и штатных действий синхронизации.
- В подготовке к переносу E3↔E4 остаются физический офлайн-цикл на iPhone, перенос гостевого архива при первом входе и независимый аудит. Проверить фактическую схему основной БД, совместимость и порядок миграций, защиту данных, восстановление и откат, конфигурацию сборки и контрольные сценарии. Согласование выполнения переноса остаётся отдельным шагом по инструкции 5.

## 2026-11-17 · Уборка служебных элементов из пользовательской сборки

- В [e7431d2](https://github.com/MusicMeasurer/shopping-app/commit/e7431d21cc8ec3d8771809bc9e16d6a005a6f27e) служебные облачные панели и лабораторный Siri исключены из обычной сборки. Диагностические сценарии включают панели только отдельным флагом сборки в CI.
- Архив открывается из штатного раздела приложения. В окне аккаунта доступны повтор синхронизации и продолжение незавершённых операций, если они сохранены на устройстве. Ошибки автоматической отправки и загрузки списков видны без служебных панелей.
- Прошли [сборка, 289 тестов и Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44089172407), [пользовательская сборка с облачным архивом и отдельная диагностическая регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44089172510), [авторизация A/B и офлайн-перезапуск](https://github.com/MusicMeasurer/shopping-app/actions/runs/44089172459) и [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44089172520). Состав файлов пользовательской сборки проверен отдельно.
- Изменения на интеграционной ветке. Полигон остаётся на `9479c7e`. Открыта ручная проверка на iPhone, включая офлайн-цикл и перенос гостевого архива при первом входе.

## 2026-11-18 · Полигон без служебных панелей

- На [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=e7431d2) опубликован `e7431d2`. После успешного [развёртывания](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44119042768) проверены полная ревизия, область действия PWA и опубликованный JavaScript. В сборке отсутствуют служебные панели, присутствуют штатные действия архива и восстановления.
- Для ручной приёмки на физическом iPhone остаются два сценария. Первый: добавить товар в облачный список офлайн, перезапустить приложение без сети, убедиться в сохранности правки, вернуть сеть и проверить автоматическую синхронизацию на втором устройстве. Второй: в свежем гостевом профиле завершить список с отмеченным товаром, войти в тестовый аккаунт и найти покупку в обычном разделе «Архив» после повторного открытия приложения.

## 2026-11-18 · Согласовано: перенос и наименования локальных профилей

Это решение заменяет прежнее правило автоматического переноса без запроса согласия. Регистрацию аккаунтов сейчас не разрабатываем; проверяем вход в существующий аккаунт, включая первое использование на устройстве.

1. На устройстве каждому облачному аккаунту соответствует ровно один связанный локальный профиль. Независимый профиль можно переименовать. После привязки имя — серверно подтверждённый логин (email); ручное переименование запрещено. При изменении email имя обновляется после следующей подтверждённой авторизации.
2. При входе из независимого локального профиля приложение спрашивает, синхронизировать ли его с аккаунтом. Отказ сохраняет независимый профиль и открывает связанную локальную копию аккаунта (создаёт её, если ещё нет). Данные профиля другого аккаунта не переносятся.
3. При согласии переносятся списки, товары и архив, включая стартовые списки. Если на устройстве уже есть связанный профиль аккаунта, исходный профиль объединяется с ним и удаляется только после подтверждённого переноса; предупреждение об удалении показывается до согласия. Если связанного профиля ещё нет, создаётся единственная связанная копия с именем аккаунта, а перенесённый источник удаляется после подтверждения.
4. При совпадениях названий после первого согласия открывается отдельный диалог. Один выбор применяется ко всем совпадениям: создать отдельные списки с автоматически выбранным свободным постфиксом `(2)`, `(3)` и далее либо добавить товары в соответствующие существующие списки. Пользователь не вводит новые названия. Тип облачного списка сохраняется; одноимённые товары остаются отдельными позициями, количества автоматически не суммируются. Архив сохраняется как история завершений.
5. Перенос должен выдерживать обрыв ответа и повтор: неизменный снимок, идентификатор операции, отсутствие дублей и изоляция аккаунтов. Во время незавершённого переноса исходный профиль сохраняется и защищён от изменений; после повторного входа операция продолжается. Источник удаляется только после проверки серверной квитанции и чтения перенесённых товаров и полного архива.
6. Универсальное самостоятельное объединение списков отложено. Объединение при переносе профиля входит в текущую задачу. Ранее принятые ограничения локального режима связанного профиля до E8 не меняются.

**Статус:** реализовано в `feature/e4-accepted-reintegration`; автоматические проверки завершены успешно ([unit/build/Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44168132255), [перенос, A/B, офлайн и Supabase](https://github.com/MusicMeasurer/shopping-app/actions/runs/44168132198)). Пользовательская приёмка на физическом iPhone и публикация новой версии ещё не выполнены.

- Начальная реализация: [50fae2b](https://github.com/MusicMeasurer/shopping-app/commit/50fae2b6ff41be27e305ebb98d570e0492dce706). Расширенные браузерные испытания: [06c8170](https://github.com/MusicMeasurer/shopping-app/commit/06c8170e5f310c4934ecbf43fa91497bb9a8d813).
- Локальная первичная регрессия: 292 теста прошли, два существующих hosted-теста пропущены без секретов; сборка успешна. Затем добавлены проверки полного архива, отказа RPC и смены аккаунта; финальный результат фиксируется после CI.
- В первом серверном тесте найдено ошибочное чтение закрытой `list_changes`: проверка заменена на разрешённую `pull_item_changes`, клиентские ACL не ослаблялись. Повторный CI выполняется.

### Результат инструкции 1 · Перенос профилей и имена

- Реализация и регрессии зафиксированы в рабочей ветке, итоговый [коммит `0d8c1ff`](https://github.com/MusicMeasurer/shopping-app/commit/0d8c1ffa34581ffd88f10ff83b5f89e77811e8f1). Барьер старых клиентов — [IndexedDB v14](https://github.com/MusicMeasurer/shopping-app/commit/3c9941baafbb6ebba3ad72f5db2c7fd222489bdc). Согласованное решение выше заменяет автоматический перенос без запроса; прежние наблюдения сохранены как история старой версии.
- [Финальный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44168132255): 299 тестов прошли, два существующих hosted-теста пропущены в обычном unit-запуске; сборка и браузерные регрессии Chromium/WebKit успешны. Реальные облачные проверки выполнялись отдельно, а не объявлялись пройденными по этим пропускам.
- [Hosted CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44168132198) завершился успешно: четыре браузерных сценария iPhone WebKit, авторизация A/B, запрет чужого доступа, RPC, квитанции и конфликтное восстановление. В новых сценариях проверены переименование и перезапуск, отказ от переноса, имя по логину и запрет его редактирования, оба варианта коллизий, занятый постфикс `(2)` с выбором `(3)`, перенос архива и товаров, реальный обрыв ответа после HTTP 200 сервера, повтор той же операции без дублей, удаление источника только после успешного подтверждения и доступ к архиву после выхода.
- [SQL/recovery](https://github.com/MusicMeasurer/shopping-app/actions/runs/44166858075): миграция, коллизии названий, повтор с неизменным содержимым, отказ изменённому повтору, события синхронизации, архив и изоляция аккаунтов прошли. [Обычная облачная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44166858064) также успешна в пользовательской и диагностической сборках.
- Дополнительно подтверждены unit-проверками: запрет новых записей в переносимый источник, сохранность снимка при перезапуске, отсутствие перезаписи существующих локальных правок аккаунта, повтор локального подтверждения, старые v13-вкладки и сохранность их данных, постраничное чтение архива более 1000 позиций. Обычное обновление кэша архива также использует полное чтение.
- При разработке исправлено стирание предупреждения о незавершённом переносе обычным автообновлением облака: сообщение выделено в отдельное состояние. В испытаниях устранены ошибки самого сценария: закрытие неизменённых настроек, ожидание асинхронной отметки покупки и перехват RPC при service worker. Для инъекции обрыва service worker блокируется только в двух новых тестах; отдельный PWA offline/restart-сценарий остаётся с ним и прошёл. Успех переноса не выдавался за успех инъекции сбоя, пока запрос действительно не был перехвачен.
- Серверный `import_e4_profile_merge` применён только на полигоне `shoppingapp-migration-lab` (`gmrqeubhotjpmtwokfeq`) миграцией `e4_explicit_profile_merge`. Проверены наличие RPC и ACL: anon запрещён, authenticated разрешён с проверкой владельца внутри функции. Основная БД не менялась.
- Основные требования, архитектура, дорожная карта и журнал актуализированы в `main/docs/`. Код приложения в main и опубликованный полигон остаются прежними; новая версия на полигон не выпускалась. Регистрация и самостоятельное объединение списков не добавлялись. Следующий шаг — отдельная публикация и пользовательская приёмка нового алгоритма на физическом iPhone; автоматические результаты её не заменяют.

## 2026-11-18 · Публикация алгоритма профилей и подготовка окончательной приёмки

- По поручению Ильи опубликован проверенный `0d8c1ffa34581ffd88f10ff83b5f89e77811e8f1` на [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=0d8c1ff). [Развёртывание 44172595900](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44172595900) успешно; сверены опубликованные revision.txt, HTML и изолированная область PWA. Основная версия приложения и основная БД не менялись.
- На полигонной БД обработаны 78 служебных списков, включая ранее удалённые: активные удалены штатной операцией с tombstones для синхронизации. Удалены 24 тестовые архивные записи с зависимыми позициями. Имена автотестов сопоставлены с исходниками и квитанциями импорта; в очистку включены созданные этими импортами стартовые списки с постфиксами. Пользовательские «Самбери» и его архив сохранены. Повторная проверка: в первом тестовом аккаунте остаётся только «Самбери» и одна архивная запись, в остальных аккаунтах активных списков и архивов нет. Учётные записи, пароли и схема не сбрасывались.
- Локальные IndexedDB на устройствах пользователя недоступны удалённо. После входа актуальные облачные метаданные скрывают удалённые тестовые карточки; независимые локальные копии не очищались. Для новых сценариев использовать отдельные независимые профили через настройки, не удаляя нужные покупки и не перенося старые тестовые данные.
- Ручная приёмка на физическом iPhone открыта. Минимальная последовательность: (1) имя независимого профиля и сохранение после перезапуска; (2) отказ от переноса в существующий аккаунт, независимость исходного профиля и имя связанной копии; (3) согласованный перенос списка и архива с созданием постфиксов при совпадении имени, удаление источника и повторный вход без дублей; (4) повтор с объединением товаров в существующий список; (5) вход в другой аккаунт из связанной копии без переноса чужих данных; (6) перенос в аккаунт, у которого ещё нет локальной копии в данном браузере; (7) физический офлайн → правка товара и отметки → закрытие/перезапуск без сети → восстановление сети/вход → проверка на втором устройстве под тем же аккаунтом. В одном из переносов проверить обычный архив после выхода и перезапуска. Регистрация и общее самостоятельное объединение списков не входят в эту приёмку.
- Результаты пользователя ещё не получены; публикация и успешные автоматические проверки не означают завершения физической приёмки. После её прохождения остаются независимый аудит перед слиянием и подготовка совместимости/миграций основной БД по инструкции 5; разрешение на сам перенос требуется отдельно.

## 2026-11-18 · Ручная приёмка 0d8c1ff: тест 1 не пройден

Илья сообщил два замечания на физическом iPhone. Это результаты пользователя, не самостоятельное воспроизведение разработчиком.

1. **T1-01 · Исчезновение неотмеченных товаров при локальном завершении.** В локальном списке с отмеченными и неотмеченными позициями при выборе «Завершить отмеченные» неотмеченное молоко исчезло. Пользователь повторил сценарий дважды, проверяя случайное нажатие; результат повторился. В выданном сценарии приёмки ожидалось, что молоко останется, а отмеченный хлеб попадёт в архив. Зафиксировано расхождение с этим ожиданием. Результат содержимого архива в данном сообщении отдельно не подтверждён. Причина и соответствие ранее согласованной семантике завершения пока не исследованы; это наблюдение не изменяет автоматически продуктовые решения.
2. **T1-02 · Поле переименования локального профиля отображается некорректно.** Пользователь описал поле как ввод наименования списка, но на приложенном IMG_3804.png показано окно «Имя локального профиля» с подписью «Имя профиля». Поле сжато до небольшого круглого элемента, введённое имя не видно. Ввести имя пользователь смог; корректность сохранения после перезапуска этим сообщением не подтверждена. Скриншот приложен пользователем к сообщению о тесте 1; повторно в публичный репозиторий не загружался.

**Статус:** тест 1 не принят, оба замечания открыты. Тесты 2–7 и остальные части теста 1 не объявляются пройденными. Исправления, публикация и изменения БД по этому сообщению не выполнялись; изменена только документация.

## 2026-11-18 · Обновление ручной приёмки: тесты 1–6 пройдены

Илья сообщил: «тесты 1-6 прошли успешно». Последний пользовательский результат фиксируется как успешное прохождение:
1. Имя независимого профиля и сохранение после перезапуска; локальная подготовка списка/архива в объёме выданного теста 1.
2. Отказ от переноса, независимость исходного профиля и имя связанной копии по логину.
3. Перенос с автоматическим постфиксом при совпадении имени, сохранением архива и удалением источника.
4. Объединение товаров в существующий список при переносе профиля.
5. Изоляция аккаунтов при переключении A/B.
6. Первая локальная привязка к существующему аккаунту в отдельном браузерном контексте.

**Тест 7:** результата ещё нет; физический офлайн → перезапуск → восстановление сети → проверка на втором устройстве остаётся открытым. Весь набор приёмки пока не закрыт.

Сообщение о прохождении теста 1 обновляет его итоговый результат относительно предыдущего сообщения. Исторические замечания T1-01 и T1-02 сохраняются: пользователь отдельно не уточнял, устранены ли они, перестали ли воспроизводиться либо приняты с замечаниями. Не объявляем их исправленными и не приписываем исправление коду без доказательств. Код, БД и публикация при этой фиксации не изменялись.

## 2026-11-18 · Реализовано и опубликовано единое меню профилей

- Согласованы кнопка в шапке, меню с именем и состоянием синхронизации, переход из общих настроек, два недавних профиля с раскрытием остальных и лимит 10. В меню перенесены существующие действия входа, выхода, переключения, переименования, создания и удаления локальной копии.
- Исправлен T1-02. Размер радиокнопок больше не применяется к текстовому полю имени. Сборка с изменением доступна для ручной проверки на iPhone.
- Коммит [98120d8](https://github.com/MusicMeasurer/shopping-app/commit/98120d8ed76d4700c4a3a6c2f8027dae5ca286e7). Прошли [301 тест, сборка и 52 браузерных сценария в Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44237787201), [реальное переключение A/B, перенос и офлайн-перезапуск](https://github.com/MusicMeasurer/shopping-app/actions/runs/44237787213), [облачная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44237787200) и [изолированный PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44237787199). Два теста с облачным подключением пропущены в обычном модульном запуске и прошли в hosted CI.
- Опубликовано на [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=98120d8). [Развёртывание прошло успешно](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44238384602).
- На iPhone предстоит проверить читаемость поля имени и доступность закрытия с открытой клавиатурой, компактную кнопку и разные состояния при входе, выходе и потере сети, порядок двух профилей и раскрытие «Ещё». Результат физического теста 7 остаётся открытым.
- По решению Ильи возврат к алгоритму завершения списка и T1-01 запланирован в E3/E4 до боевой публикации.

## 2026-11-18 · Ручная приёмка меню профилей на iPhone (`98120d8`)

- Илья подтвердил прохождение тестов 1 и 2 и теста 3 в исходном сценарии последней доработки. Эта нумерация относится к приёмке меню профилей. Результата отдельного физического офлайн-теста 7 в этом сообщении нет.
- В расширенном сценарии с несколькими пустыми локальными профилями Илья не смог открыть существующий аккаунт. После добавления товара в один из пустых списков вход удался. При попытке открыть новый для этого браузера аккаунт приложение показало сообщение о лимите 10 локальных профилей. Скриншот подтверждает сообщение о лимите, а последовательность входов зафиксирована со слов Ильи. Причина первого отказа и связь с добавлением товара не установлены. По решению Ильи наблюдение не блокирует текущую приёмку. Вернуться к нему при подготовке полноценного релиза.
- После штатного удаления облачного списка в меню профиля отображались постоянно доступная кнопка «Повторить синхронизацию» и подтверждение удаления с техническим идентификатором операции. В [коде сборки](https://github.com/MusicMeasurer/shopping-app/blob/98120d8ed76d4700c4a3a6c2f8027dae5ca286e7/src/AuthenticatedApp.tsx#L908-L916) кнопка запускает общий повтор синхронизации, а подтверждение показано независимо от неё. Скриншоты к записи не прикладывались.

## 2026-11-18 · Очередь облачных операций и интерфейс профилей

- По согласованной доработке завершение и удаление облачных списков используют очередь IndexedDB. Действия с ожидающим списком ограничены, остальные списки доступны. Подтверждённая операция очищает свою запись. При потере ответа восстанавливается прежний идентификатор запроса. Явный отказ сервера освобождает список для повторного подтверждения. Локальное хранилище обновляется до версии 15.
- В меню профилей удаление локальной копии доступно через корзину рядом с именем. Удаление другой копии сохраняет текущий профиль, незавершённые операции блокируют очистку. Под именем показано состояние обмена с облаком. Ручной повтор доступен при ошибке, а служебный идентификатор операции не выводится в пользовательском сообщении.
- На карточках оставлен индикатор типа списка. Признак облака показан в открытом списке. «Разовый» и «Постоянный» выбираются прямо в меню списка, где видны оба значка и отметка текущего типа.
- Итоговый [коммит `369602c`](https://github.com/MusicMeasurer/shopping-app/commit/369602c2e43a70609afa1f8f8adede0366f83e18). Сборка и 303 модульных теста прошли. Два теста, пропущенные в локальном запуске без облачной конфигурации, прошли в [hosted A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/44254837005). [Облачный WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44254836997) подтвердил приём второго удаления при задержанном ответе первого, потерю ответа после подтверждения сервером и восстановление после перезапуска. [PostgreSQL и сквозные браузерные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/44254837129) прошли.
- 54 сценария интерфейса прошли в [Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44254586464) на `5d0f7d5`. Итоговая ревизия добавляет обработку явного серверного отказа и повтор из меню профиля при ошибке операции. [Повторный браузерный прогон](https://github.com/MusicMeasurer/shopping-app/actions/runs/44254837027) на момент записи оставался на установке браузеров.
- [Публикация на интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=369602c) прошла. Сверены HTTP 200, полный номер ревизии, манифест, область service worker и пользовательские строки в опубликованном JavaScript. [Развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44255576229). Открыта ручная приёмка на iPhone: удаление другой локальной копии, смена типа в меню списка и наблюдение статусов при разрыве связи и повторном подключении.

## 2026-11-18 · Убрано сообщение после успешного удаления

- По замечанию Ильи после подтверждённого удаления облачного списка приложение убирает карточку без строки «Список удалён» в открытом списке. Ожидание, ошибки и повтор по-прежнему показываются. Браузерные сценарии теперь проверяют результат по исчезновению карточки, а облачная регрессия дополнительно проверяет отсутствие строки.
- [Изменение `ac211b4`](https://github.com/MusicMeasurer/shopping-app/commit/ac211b4caeacbda1ac52f43c6c192113876867c8). Сборка и 303 модульных теста прошли, два облачных модульных теста исключены из локального запуска. [Облачная браузерная проверка](https://github.com/MusicMeasurer/shopping-app/actions/runs/44257749502).
- [Опубликовано на интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=ac211b4). Подтверждены полный номер ревизии и отсутствие строки в опубликованном JavaScript. [Развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44257771267).

## 2026-11-18 · Частичный перенос покупок в архив

- По согласованному сценарию кнопка в шапке предлагает «Завершить покупки» и «Завершить список». Первый пункт после подтверждения архивирует отмеченные позиции, сохраняя активными неотмеченные позиции и сам список обоих типов. Разовый список остаётся активным и при переносе всех его позиций. Полное завершение использует прежний сценарий.
- Облачная очередь фиксирует подтверждённые позиции и использует существующую модель ревизий и квитанций. SQL-черновик `033_e4_archive_purchased_RPC_CI_ONLY.sql` покрывает атомарное создание архива и выборочные tombstones. Использование новой операции на полигоне потребует применения SQL перед публикацией приложения.
- [Итоговая ревизия `319b99c`](https://github.com/MusicMeasurer/shopping-app/commit/319b99cca640f84599e0b14d6637e8514073538b). Сборка и 304 модульных теста прошли, два теста без облачной конфигурации пропущены. [Браузерная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44285199455) и [целевые проверки Chromium/WebKit и изолированного PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44285199617) прошли. Целевые проверки охватывают отмену, сохранение разового и постоянного списков, восстановление после перезапуска, повтор серверного запроса, устаревшую ревизию и границу доступа аккаунта. В первых браузерных прогонах скорректированы ожидания выбора списка и сохранения отметки. Пользовательская приёмка на полигоне и сквозная проверка нового облачного сценария на размещённом Supabase относятся к следующему этапу публикации.

## 2026-11-18 · Горизонтальная лента крупных карточек

- В крупном режиме списки размещены в горизонтальной ленте с нативной прокруткой и выравниванием по карточкам. «Новый список» расположен в конце. После создания лента прокручивается до новой карточки. Свайп за пределами ленты по-прежнему переключает архив.
- Стрелки у выбранной карточки перемещают её на одну позицию с анимацией. Используются существующие операции сохранения порядка локально и в облаке. После перезагрузки восстанавливаются порядок и выбранный локальный список. Стандартная сетка сохраняет перестановку долгим нажатием.
- [Итоговая ревизия `97a3f1b`](https://github.com/MusicMeasurer/shopping-app/commit/97a3f1b5dff587df7956af2aec4ff302e52e6a79). Сборка, 304 модульных теста и [регрессия Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44287843582) прошли. Покрыты шесть карточек, положение кнопки создания, прокрутка после создания, смена порядка и перезагрузка, направление свайпа внутри и вне ленты. Chromium также проверяет нативный жест касанием. На ревизии с тем же кодом приложения прошла [облачная браузерная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44287043750). Результаты относятся к рабочей ветке.

## 2026-11-18 · Сортировка покупок и совпадения названий (Инструкция 1)

- По умолчанию новые позиции выше, строки одного ввода сохраняют исходный порядок. Для открытого списка доступны оба направления сортировки по названию и количеству. При сортировке по количеству группы единиц всегда идут от А до Я. Позиции без единицы идут последней группой, а без количества — в конце своей группы. Порядок отображения не меняет данные. Выбранный режим запоминается для каждого списка до закрытия рабочей области.
- Добавление и переименование проверяют название внутри одного списка без учёта регистра и лишних пробелов. При пакетном вводе уникальные позиции сохраняются, а пропущенные перечисляются. Сохранённые ранее совпадения и конфликты после офлайн-правок остаются доступны для ручного решения. Показываются обе позиции и их свойства. Можно оставить одну, переименовать одну или вернуться к решению позже. Остальные покупки синхронизируются.
- SQL-черновик `034_e4_ordered_item_and_name_conflict_CI_ONLY.sql` сохраняет время ввода пакетных позиций и проверяет версии обеих позиций при разрешении конфликта под блокировкой списка. Клиент совместим со старым RPC добавления до миграции. Для облачного порядка новых пакетов и разрешения конфликтов на полигоне потребуется применить миграцию перед публикацией.
- Этапы сохранены в рабочей ветке. [Сортировка](https://github.com/MusicMeasurer/shopping-app/commit/cf99cc3152a56e94e4ea935aded44131db82aec9), [проверка имён](https://github.com/MusicMeasurer/shopping-app/commit/bd05a333b098bc25e66c2c28d8240db08a3eb77d), [конфликты и облачный порядок](https://github.com/MusicMeasurer/shopping-app/commit/581daf256ba1869a522020221936f89674c5c2dd). [Итоговая ревизия](https://github.com/MusicMeasurer/shopping-app/commit/4ef95ea49a9842697be29be6ebc4b07cce75b858).
- Сборка и 312 автоматических тестов прошли, два облачных теста локально пропущены из-за конфигурации. [Мобильная регрессия Chromium/WebKit](https://github.com/MusicMeasurer/shopping-app/actions/runs/44302496297). [Целевые сценарии Chromium/WebKit и изолированный PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44302496262). PostgreSQL подтвердил сохранение времён, повтор запроса, защиту от противоположных решений и межаккаунтных операций. Два устройства с независимыми локальными хранилищами проверены на уровне клиента. [Облачная браузерная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44301482032) на лабораторном сервере прошла по существующему контракту. Новый контракт проверен на изолированном PostgreSQL. Публикация и пользовательская приёмка остаются отдельным этапом.

## 2026-11-18 · Публикация сортировки, разрешения совпадений и частичного архива на полигоне

- На базе интеграционного полигона применены миграции `e4_033_archive_purchased` и `e4_034_ordered_item_and_name_conflict`. На размещённой базе с временными записями в транзакциях проверены частичный архив постоянного и разового списка, порядок пакетного ввода, переименование и удаление при конфликте, повтор операции и граница доступа. Транзакции откатились, тестовые учётные записи не остались. Оба новых RPC обнаруживаются через Data API и отклоняют анонимные вызовы. Предупреждение анализатора об исполнении функций SECURITY DEFINER ролью authenticated проверено вместе с ограничениями доступа. [Описание проверки Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- На [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=4ef95ea) опубликована ревизия `4ef95ea49a9842697be29be6ebc4b07cce75b858`. [Развёртывание GitHub Pages](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44303774520) успешно. Подтверждены HTTP 200, полный SHA, нужные элементы в сборке, отдельная область PWA и загрузка приложения в браузере с обоими пунктами меню завершения.
- Приёмка на физическом iPhone открыта. Проверить свайп и сохранение порядка крупных карточек, сортировку и пакетный ввод с дублем, частичный архив и конфликт одного облачного списка после независимых офлайн-правок. Боевой выпуск не выполнялся.

## 2026-11-18 · Приёмка 4ef95ea на iPhone и уточнения интерфейса

- Илья подтвердил прохождение всех четырёх сценариев на физическом iPhone. Приняты лента карточек и сохранение их порядка, пакетный ввод и сортировка, частичный архив и разрешение офлайн-конфликта.
- На скриншоте после работы с Test 1 подтверждение переноса покупок осталось видно в другом списке. В рабочей ветке подтверждение завершения, архивации или удаления списка вынесено в одно полупрозрачное уведомление у верхнего края экрана. Оно не прокручивается со списком и автоматически исчезает через пять секунд. Смена списков не перезапускает таймер.
- Кнопка в подтверждении частичного архива называется «Завершить отмеченные». В пустом списке убрана декоративная галочка. Режимы сортировки открываются компактной пиктограммой в правой части заголовка списка.
- [Коммит рабочей ветки](https://github.com/MusicMeasurer/shopping-app/commit/f88cc5d13db492ce982c05b78fc779a2b88fc09d). Сборка и 312 тестов прошли. [Мобильная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44310947423), [целевые тесты завершения и уведомления](https://github.com/MusicMeasurer/shopping-app/actions/runs/44310947500) и [облачная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44310947444). Новые интерфейсные изменения подготовлены в рабочей ветке.

## 2026-11-18 · Интерфейсные правки опубликованы на полигоне

- На [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=ec9b1b5) опубликована ревизия `ec9b1b52840a6710b463649976b03ed57c1efb17`. [Развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44312684550) прошло. Сверены полный SHA, актуальные JS и область PWA. В браузере опубликованная версия открылась, а в пустом списке осталась текстовая подсказка без декоративной галочки. Обновление интерфейсное, миграции базы не требовались.
- [Мобильный прогон](https://github.com/MusicMeasurer/shopping-app/actions/runs/44311505447) прошёл в Chromium и WebKit, включая подтверждение «Завершить отмеченные», положение уведомления, исчезновение и отсутствие повторного появления при смене списка. [Облачная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44310947444) для того же кода приложения прошла.
- Для приёмки на физическом iPhone осталось проверить нажатие на компактный значок сортировки и уведомление при прокрутке и смене списка, а также вид пустого списка.

## 2026-11-18 · Приёмка и объём промежуточной публикации

- Илья подтвердил работу интерфейсных правок на [полигоне ec9b1b5](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=ec9b1b5). Тест 7 зачтён по его подтверждению об аналогичных действиях при последнем тесте с двумя устройствами. Отдельного прогона по точному сценарию не было.
- Согласована промежуточная публикация принятых чистовых версий до E6. Цели — GitHub Pages основного репозитория, ветка `main`, БД `shoppingapp-security-lab`. Полноценный выпуск на собственном домене с торговой маркой выделен отдельно.
- Согласован п. 2: подготовка основной БД без переноса данных с полигона. Подключение домена и выкладка приложения относятся к следующим пунктам.
## 2026-11-18 · Подготовлена БД промежуточной чистовой версии

- В `shoppingapp-security-lab` (`tdcrtwpewbngoermckmx`) выполнена `20261118135404_clean_e4_schema_and_acl`. После первоначальных тайм-аутов доступ восстановился. Инвентаризация перед записью подтвердила базовую схему E3, две существующие учётные записи, один список и одну позицию. Подтверждено отсутствие дублей имён списков.
- Применены изменения E4 из 022–034 и [SQL чтения tombstones по квитанции](https://github.com/MusicMeasurer/shopping-app/blob/55da053a5de467e6fd1e2bab0353cfef97be1509/cloud/drafts/035_e4_completion_tombstones.sql). Клиентские права установлены по матрице принятого полигона для 13 прикладных таблиц. RLS включена на всех таблицах public. Контроль содержимого подтвердил сохранность существующих записей при добавлении метаданных. Данные полигона не переносились. Полная копия проекта не создавалась согласно принятому плану. Переход и откат проверены на изолированной копии тестовой схемы с существующими записями. SHA-256 выполненного пакета: `03f397189bf579abf43f7602f2ab5decb4e9288d822100e0e03a5ef81f232e3c`.
- На основной БД проверены частичный архив в обоих типах списков, квитанции, порядок товаров, разрешение конфликтов и объединение профилей с проверкой разделения аккаунтов. Тестовые транзакции откатились. Через реальный HTTP API проверены ответ Auth и отказ анонимным обращениям к спискам и трём проверенным RPC. Анализатор сообщает об анонимном EXECUTE только для служебного event trigger `rls_auto_enable()`. Предупреждения о доступных authenticated SECURITY DEFINER и защите от утёкших паролей остаются в выпускном аудите. Сборка на домене и реальный вход из неё относятся к следующему шагу.

## 2026-11-19 · Слияние чистовой версии в `main`

- По подтверждению Ильи ветка `release/interim-clean` влита в `main` до [ревизии `bd35ac8`](https://github.com/MusicMeasurer/shopping-app/commit/bd35ac834354f15523ddc20d6d15734f29a6f187). [Предварительный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44389401006) подтвердил сборку, модульные проверки и запуск PWA в Chromium и WebKit.
- [Первый запуск публикации](https://github.com/MusicMeasurer/shopping-app/actions/runs/44392990691) прошёл модульные тесты и сборку. Установка браузеров затянулась, пока сайт оставался на предыдущей версии. Эта запись запускает публикацию заново с тем же кодом приложения. Реальное развёртывание проверяется отдельно.

- [Чистовая версия опубликована на основном адресе](https://musicmeasurer.github.io/shopping-app/) в ревизии `cbdbfd5`. [Финальный запуск GitHub Actions](https://github.com/MusicMeasurer/shopping-app/actions/runs/44395809981) подтвердил 312 модульных тестов, сборку и обе браузерные проверки, включая локальные данные и открытие без сети. Два облачных модульных теста пропущены в конфигурации локальной проверки.
- После задержки установки пакетов Ubuntu браузерные проверки переведены на готовый образ Playwright версии из `package-lock.json`. Изменения после согласованной ревизии касались конвейера GitHub Actions и журнала. На опубликованном сайте проверены ревизия по HTTPS, адрес отдельной Supabase, пространство локального хранилища, манифест и список ресурсов для офлайн-работы. Вход в аккаунт и синхронизация в браузере на основном адресе остаются отдельной проверкой.

## 2026-11-19 · Точка входа для работы из нового чата и уборка полигона

- В [`main/docs/START_HERE.md`](START_HERE.md) записана единая рабочая ветка `feature/e4-accepted-reintegration`, основная версия, интеграционный полигон и состояние приёмки. В README добавлена ссылка на точку входа. [Рабочие инструкции, редакция 1.2](04_WORK_INSTRUCTIONS.md), требуют сверить исходную ветку и коммит до правок и проверить адрес, базу и фактическую версию при публикации. Изменения документации — [`819f808`](https://github.com/MusicMeasurer/shopping-app/commit/819f808f1d3323c22d762d2d5226337ccc91ac07). Следующая задача разработки пока не выбрана. Проверка из отдельного обычного чата остаётся открытой.
- По решению Ильи убраны отдельные страницы E3 и E4 на полигоне. [GitHub Actions 44465302941](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44465302941) успешно опубликовал только интеграционную сборку из прежней принятой ревизии `ec9b1b5`. Проверены загрузка интеграционного адреса и ответы 404 на обоих прежних адресах. Код приложения и схемы Supabase этой работой не изменялись.
- [Указатель сохранённых версий](BRANCH_ARCHIVE.md) фиксирует точные коммиты вспомогательных веток. Илья разрешил убрать имя ветки `snapshot/e4-ui-v1.0`. Создание архивных меток и удаление веток остаются открытыми. Для веток с открытыми заявками на слияние ещё требуется решение об их закрытии. Ветка `feature/cloud-schema-draft` используется проверками базы из `main`.

## 2026-11-19 · Проверка обычного чата и закрытие старых заявок

- Илья подтвердил, что в новом обычном чате найдена рабочая ветка по точке входа. Проверка чтения пройдена в подтверждённом объёме. Запись кода и просмотр CI в обычном чате ещё не проверялись.
- С разрешения Ильи [заявки №4–14](https://github.com/MusicMeasurer/shopping-app/pulls?q=is%3Apr+is%3Aclosed) закрыты без слияния. [№1](https://github.com/MusicMeasurer/shopping-app/pull/1) остаётся единственной открытой. Проверено наличие 19 веток и отсутствие архивных меток. Сначала сохранить нужные коммиты метками, затем убрать имена исторических веток. Ветка облачной схемы нужна текущим автоматическим проверкам.

## 2026-11-19 · Проверка облачной синхронизации на основном адресе

- Илья подтвердил прохождение двух из трёх проверок основного адреса. Третий сценарий не прошёл: после отметки покупки на одном устройстве повторное открытие приложения на другом показало «Не удалось обновить некоторые списки. Повторите синхронизацию». Исправление и повторная проверка этого сценария остаются открытыми.
- На исходнике опубликованной версии воспроизведён соответствующий сбой автоматического получения изменений: при подтверждённой более новой версии товара в облаке и отсутствии локальных правок изменение только отметки о покупке считается конфликтом. Причина сообщения на конкретном устройстве по скриншоту однозначно не устанавливается. Код и база не изменялись.

## 2026-11-19 · Продолжение разработки и новый план доработок

- Илья решил продолжить разработку после промежуточной публикации. Зафиксированы пять новых требований: единое поведение ленты карточек в обоих стилях, сохранение стиля по профилю, переключение между локальными профилями и одной облачной сессией, запоминание отказа от синхронизации для локального профиля с настройкой в его меню и самостоятельная регистрация. Подробности — в [требованиях](01_REQUIREMENTS.md).
- Для планирования фраза об отказе в сценарии входа трактуется как отказ от синхронизации списков текущего локального профиля. Окончательно уточнить поведение в интерфейсе перед реализацией.
- [План незавершённых работ](03_ROADMAP.md) составлен заново. Включены открытые дефекты, отложенные функции и технические задачи. Ранее записанные сроки, приоритеты и варианты выполнения для этих работ не определяют новый план. Договорённость об отложенной Siri сохраняется.
- Исправление получения отметки с другого устройства и Broadcast готовы в [рабочей ревизии dbf3ecf](https://github.com/MusicMeasurer/shopping-app/commit/dbf3ecf6fcefdfdacc9982ef2f5f01fd0f13b0b3). [Интеграционный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44516227874) и [проверка SQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44516227889) прошли. Проверка на двух устройствах после выкладки и применения миграции на полигоне открыта.

## 2026-11-19 · Профили и карточки в продолжении E4

- Илья согласовал продолжение E4 после интеграции с E3. Шаг 2 «Профили и карточки» выполняется в прежней рабочей ветке. Физическая приёмка на iPhone перенесена за шаг 4 «Личные списки и история». Шаг 1 остаётся открытым для пользовательской проверки. См. [дорожную карту](03_ROADMAP.md).
- Работа начата от [dbf3ecf](https://github.com/MusicMeasurer/shopping-app/commit/dbf3ecf6fcefdfdacc9982ef2f5f01fd0f13b0b3). Изменения пункта 2 сохранены в [рабочей ветке](https://github.com/MusicMeasurer/shopping-app/tree/feature/e4-accepted-reintegration), для которой запущены [автоматические проверки](https://github.com/MusicMeasurer/shopping-app/actions?query=branch%3Afeature%2Fe4-accepted-reintegration). Приёмка и выкладка выполняются отдельно.

- Реализация шага 2 сохранена в [7a57503](https://github.com/MusicMeasurer/shopping-app/commit/7a575031312ba4b9cd4327f9a8c3dd9e64c28d5a). Оба стиля используют горизонтальную ленту. Стиль карточек запоминается на устройстве по профилю, облачный профиль и его локальная копия используют одну настройку. Переход в локальный профиль сохраняет сессию, смена облачного аккаунта завершает прежнюю сессию на этом устройстве при отправке формы нового входа. Запоминание отказа от переноса списков управляется флажком для конкретного локального профиля.
- [Интеграционный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44526986195) подтвердил сборку, 321 тест и 70 браузерных проверок. [Прогон A/B](https://github.com/MusicMeasurer/shopping-app/actions/runs/44525991102) подтвердил возврат без повторного входа, смену аккаунта и сохранение отказа при перезагрузке. [Репетиция восстановления](https://github.com/MusicMeasurer/shopping-app/actions/runs/44525871102) прошла. Выкладка шага 2 и физическая приёмка остаются отдельными действиями.
- Финальная ревизия рабочего шага — [3a3df08](https://github.com/MusicMeasurer/shopping-app/commit/3a3df085334d7226d5124a648b951fc507503e33). Повторно прошли [интеграционные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/44527609592) и [облачные проверки разового и постоянного списков](https://github.com/MusicMeasurer/shopping-app/actions/runs/44527609618). Для облачных сценариев и репетиции восстановления использован образ Playwright закреплённой версии. Браузерные тесты дождались завершения первичной облачной синхронизации перед проверкой последующих операций.

## 2026-11-19 · Шаг 3 «Самостоятельная регистрация»

- Для продолжения E4 после E3 выбрана регистрация по email и паролю с подтверждением одноразовым кодом. Восстановление доступа также подтверждается кодом. Временная сессия используется в памяти отдельно от сессии приложения. После подтверждения адреса или смены пароля пользователь возвращается к обычному входу. Перенос локальных списков остаётся отдельным выбором при первом входе.
- Реализация сохранена в [рабочей ревизии 9de94ee](https://github.com/MusicMeasurer/shopping-app/commit/9de94ee90553176171efcdb773e00b3413ffcc89). [GitHub Actions](https://github.com/MusicMeasurer/shopping-app/actions/runs/44532123375) подтвердил сборку, 321 тест и новые сценарии с имитацией Auth в Chromium и WebKit. Среди сценариев — несовпадение паролей, неверный код, повторный запрос кода, повторная регистрация, восстановление доступа, явный первый вход и сохранение локального списка при отказе от переноса.
- Для выкладки включить `VITE_ACCOUNT_EMAIL_CODES=true` в согласованной сборке. В соответствующем проекте Supabase проверить разрешение регистрации по email и обязательное подтверждение, настроить SMTP, шаблоны Confirm signup и Reset password с кодом `{{ .Token }}` и серверный минимум 8 символов для нового пароля, в соответствии с уточнением Ильи от 20.11. Проверить доставку и код на полигоне. Настройки облачного Auth и опубликованные сборки на этом шаге не менялись. Физическая приёмка остаётся после шага 4.

## 2026-11-20 · Личные списки, порядок этапов и авторизация

- Минимум пароля снижен до 8 символов в [48be6d9](https://github.com/MusicMeasurer/shopping-app/commit/48be6d957c27d85ceaba85a87c20928e29853346). Поиск покупок после удаления исходного списка добавлен в [b33630e](https://github.com/MusicMeasurer/shopping-app/commit/b33630e879ed66b50e41dd2a7763cdff8735b307). Доставка писем не проверена из-за отсутствия доступа к настройке отправки.
- Илья согласовал сохранение общего решения по совпавшим спискам при переносе профиля, чтобы сократить число действий. При ручном объединении сохраняется разбор отдельных позиций, включая переименование переносимого дубля. Реализация и CI объединения — [c03c0cb](https://github.com/MusicMeasurer/shopping-app/commit/c03c0cb3bec6a3d323e9625963138ed00654886d), [браузеры](https://github.com/MusicMeasurer/shopping-app/actions/runs/44608599963) и [PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44608599952). Миграция 037 ожидает выкладки на полигон.
- Создание и завершение после выхода и при повторном входе в тот же аккаунт реализованы в [c7ee34b](https://github.com/MusicMeasurer/shopping-app/commit/c7ee34bb8c58a499df51a30c7b5a0a04d9da3278). Проверки: [сборка и браузеры](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381904), [два аккаунта и очередь после повторного входа](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381877), [изолированная PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381939). Публикация и приёмка на физическом iPhone открыты.
- Согласована последовательность 4 → 1 → 5 → 6 с сохранением прежних номеров. Следующий блок — облачные списки, затем языки, затем полный выпуск. Конфигурация и испытания регистрации описаны в [руководстве для владельца](07_AUTH_ACCEPTANCE_GUIDE.md).

## 2026-11-21 · SMTP на полигоне

- Илья подтвердил настройку собственного SMTP в `shoppingapp-migration-lab`. Ранее он подтвердил серверный минимум пароля в 8 символов. Сохранение шаблонов Confirm signup и Reset password с `{{ .Token }}` пока не подтверждено.
- После подтверждения шаблонов и разрешения на выкладку включить `VITE_ACCOUNT_EMAIL_CODES=true` в сборке полигона. Доставка писем, регистрация и восстановление по коду на iPhone ожидают проверки. См. [руководство](07_AUTH_ACCEPTANCE_GUIDE.md).
- Илья подтвердил сохранение обоих шаблонов с одноразовым кодом. Ожидаются выкладка тестовой сборки и проверка фактической доставки и обоих сценариев на iPhone.

## Выкладка регистрации по коду на полигон

- С разрешения Ильи на [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=48be6d9) опубликован исходник `48be6d957c27d85ceaba85a87c20928e29853346` с включённым `VITE_ACCOUNT_EMAIL_CODES` и базой `shoppingapp-migration-lab`. [Развёртывание GitHub Pages](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44901897411) успешно. Чистовая публикация и миграции базы не менялись.
- Подтверждены HTTP 200, полная ревизия, наличие обеих кнопок авторизации и адреса базы полигона в опубликованной сборке, а также область PWA. Модульные тесты: 321 пройден, 2 пропущены. Локальный Chromium не запустился из-за ограничения системного вызова. Доставка писем и оба сценария на iPhone ожидают приёмки.
- Илья подтвердил прохождение двух сценариев на iPhone на полигоне `48be6d9`: регистрация с письмом и кодом, затем восстановление по коду и вход с новым паролем. Базовые сценарии авторизации на полигоне приняты. Дополнительные проверки из руководства и проверка на основной среде остаются отдельными шагами.

## Интеграционный полигон c7ee34b · Инструкция 4

- По поручению Ильи опубликована последняя ревизия рабочей ветки `c7ee34bb8c58a499df51a30c7b5a0a04d9da3278` на [интеграционном полигоне](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=c7ee34b) с базой `shoppingapp-migration-lab`. [Развёртывание](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44903143409) успешно. Через HTTP подтверждены полная ревизия, область PWA, адрес тестовой базы и наличие кода регистрации, восстановления, объединения списков и Realtime. Настройки и данные чистовой среды не менялись.
- На тестовой базе зарегистрированы миграции `20261121121647_e4_036_list_revision_broadcast` и `20261121121652_e4_037_merge_personal_lists`. Подтверждены права выполнения обеих функций объединения и наличие трёх политик Realtime и триггера. Транзакционная проверка с откатом подтвердила переименование дубля, сохранение архива, повтор операции, проверку ревизии и прав, создание приватного события изменения списка.
- 327 модульных тестов пройдено, 2 пропущено. На исходном коммите успешны [браузерные проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381904), [облачная регрессия](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381877) и [PostgreSQL](https://github.com/MusicMeasurer/shopping-app/actions/runs/44613381939).
- На физическом iPhone ожидаются проверка профилей и стилей карточек, поиск в архиве после удаления исходного списка, ручное объединение локальных и облачных списков, создание и завершение в локальной копии после выхода с последующим входом. На двух устройствах ожидается проверка получения отметки без перезагрузки и после восстановления сети. Регистрация и восстановление по коду приняты ранее на `48be6d9`.

## 2026-11-21 · Сбой открытия аккаунта и незавершённый выход на полигоне

- При приёмке `c7ee34b` в Safari на iPhone Илья не смог открыть уже авторизованный аккаунт. Экран предложил повторить открытие или выйти из профиля. Повтор не помог. После попытки выхода на скриншоте в 22:48 приложение показывает «Аккаунт заблокирован до завершения выхода», «Предыдущий выход не завершён. Повторите выход из аккаунта» и кнопку «Повторить выход». Текст первого сообщения и результат нажатия именно на «Повторить выход» не подтверждены.
- В коде экран на скриншоте соответствует локальной отметке незавершённого выхода. В агрегированных логах Supabase полигона около 22:48 обнаружен запрос `/auth/v1/logout` с HTTP 204. Привязка запроса к конкретной попытке не подтверждена. Причина сбоя открытия профиля и сохранения локальной отметки остаётся открытой. Приёмка этого сценария приостановлена до разбора.

### Дополнительные замечания приёмки на iPhone

1. **Ошибка входа.** По наблюдению Ильи, при неверном пароле форма входа не сообщает об ошибке. Показывать понятное сообщение в форме, чтобы пользователь мог исправить данные и повторить вход.
2. **Список профилей.** Показывать каждый профиль одной строкой. Нажатие на профиль с действующей авторизацией открывает его сразу в облаке. Убрать отдельные кнопки «Вернуться в облачный профиль» и «В облако», а также значок паузы рядом с именем. Скриншоты IMG_3841 и IMG_3843 показывают дублирующие способы перехода.
3. **Обводка в настройках.** Убрать цветное кольцо вокруг радиокнопки выбора размера карточек на iPhone, показанное на IMG_3844. При исправлении сохранить видимый клавиатурный фокус.
4. **Длина кода.** Для подтверждения регистрации и сброса пароля перейти с восьмизначных на шестизначные одноразовые коды. Согласовать длину OTP в Supabase с проверкой ввода в приложении и повторно проверить оба сценария на полигоне. Минимальная длина пароля по-прежнему 8 символов.

Замечания открыты. Сбой открытия уже авторизованного профиля и незавершённый выход отслеживаются отдельно выше.

## 2026-11-22 · Результаты тестов 1–3 на iPhone, полигон c7ee34b

- **Тест 1 «Профили и карточки» — пройден.** Ранее зафиксированные замечания к интерфейсу и авторизации остаются в работе.
- **Тест 2 «Архив» — пройден.** Подтверждён поиск покупки в архиве после исчезновения исходного разового списка из активных.
- **Тест 3 «Объединение» — приёмка открыта.** В локальном режиме облачного аккаунта действия с существующими списками недоступны. Требуется восстановить их доступность, включая объединение.
- В обоих режимах, где объединение доступно (независимый локальный и облачный), после выбора «Объединить списки» сразу показывать перечень списков-получателей. Убрать отдельную кнопку раскрытия перечня.
- В облачном режиме после сворачивания приложения объединение блокируется. Скриншот IMG_3852, 11:13, показывает сообщение «Войдите в аккаунт, чтобы продолжить» в диалоге «Объединить списки». После действия с синхронизацией объединение удалось. Причина сбоя и точное действие, восстановившее работу, пока не установлены. Повторная приёмка должна подтвердить объединение после возврата в приложение при действующей сессии без ручного запуска синхронизации.

### Тест 4 «После выхода» · iPhone, полигон c7ee34b

- Илья подтвердил, что в локальном режиме облачного аккаунта списки отображались, но завершение списка не изменило локальный архив. После повторного входа в тот же аккаунт действия завершились. Создание и завершение после входа зафиксированы в переданном объёме. Мгновенное отражение завершения в локальном архиве отсутствует. Тест пройден в части обработки отложенных действий после входа, локальное поведение остаётся открытым.
- По коду локальный режим сохраняет запрос на завершение в очередь. Предложение для обсуждения: отразить завершение в локальном списке и архиве сразу, пометить ожидающую синхронизацию и при подтверждении облака сверить результат без создания второй архивной записи. Это предложение к существующему сценарию, не согласованное изменение.

### Уточнение результата теста 4 и порядка работ

- Илья согласовал правило локального отображения: В локальной копии облачного аккаунта результат виден сразу. Удалённый или завершённый разовый список исчезает из активных, завершённая покупка исчезает из списка. Метка «Ожидает синхронизации» отображается только у записи в архиве. Если действие по действующим правилам не создаёт запись архива, отдельная запись ради метки не добавляется. После входа в тот же аккаунт подтверждённый результат сверяется с локальным без дублей в архиве.
- Тест 5 на двух устройствах не проводился. Выкладка на полигон и приёмка на iPhone после всех исправлений. [План работ](03_ROADMAP.md).

## 2026-11-22 · Задача 1: авторизация, сессия и профили

- От принятой основы `c7ee34b` в `feature/e4-accepted-reintegration` подготовлена [ревизия `934ac55`](https://github.com/MusicMeasurer/shopping-app/commit/934ac55ed73a5225156adcb79e72f835f8279ac0). Если ответ о выходе успешен после тайм-аута интерфейса, контроллер завершает выход при получении ответа и снимает локальную отметку. При временном сбое подготовки профиля приложение показывает ошибку и позволяет повторить открытие без перезагрузки. Точная причина исходного сбоя на физическом iPhone не подтверждена.
- Сессия перепроверяется при возвращении в приложение и восстановлении связи. В облачном объединении временный сбой проверки отличается от отсутствия сессии, допустима одна повторная проверка. Серверная проверка принадлежности аккаунта сохраняется.
- При неверных данных или сбое сети сообщение появляется в форме входа. В меню одна строка для каждого переключаемого профиля. Авторизованный профиль открывается нажатием на строку без повторного входа. Согласие на перенос локальных данных по-прежнему запрашивается в предусмотренном сценарии. Отдельные кнопки возврата в облако и значок паузы убраны.
- 328 модульных тестов прошли, 2 пропущены. Проверены поздний успешный выход после тайм-аута, повторный вход в уже привязанный аккаунт и отказ создания нового профиля на лимите. [Интеграционный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44973500053) подтвердил сборку, сообщения формы и открытие через строку профиля при нескольких пустых профилях в Chromium и WebKit. [Облачный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44973500134) подтвердил предварительный просмотр объединения при имитации возврата в приложение и временного сбоя проверки сессии. [Проверки двух аккаунтов](https://github.com/MusicMeasurer/shopping-app/actions/runs/44973417896) прошли на `e7935af` с тем же кодом приложения.
- Код остаётся в рабочей ветке. Выкладка и физическая приёмка ожидаются после задач 2–4 по согласованному плану.

## 2026-11-22 · Объединение в локальной копии после выхода

- Ранее опубликованный полигон `ea5128d` подтверждён по `revision.txt`. Выкладка содержит предыдущие исправления и использует `shoppingapp-migration-lab`. [Выкладка](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/44978426965).
- Ручное объединение двух ранее синхронизированных личных списков после выхода реализовано в [`c9f81bd`](https://github.com/MusicMeasurer/shopping-app/commit/c9f81bd83edfa65ea738551f9f568521fee62eee). Видимый итог сохраняется при перезапуске. При входе в тот же аккаунт приложение защищает операцию проверкой снимков, серверных ревизий и повтором того же ID. При подтверждённом конфликте оба списка сохраняются, пользователь получает запрос заново проверить результат.
- Прошли сборка, 335 модульных тестов и [интеграционный CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/44985000126). Новый сценарий выхода, объединения, перезапуска и повторного входа прошёл в [браузерной проверке на тестовом Supabase](https://github.com/MusicMeasurer/shopping-app/actions/runs/44984923057). [Повторная проверка финального коммита](https://github.com/MusicMeasurer/shopping-app/actions/runs/44985000128).
- Дополнение находится в рабочей ветке. Физическая проверка объединения после выхода ожидает отдельной выкладки. Объединение новых несинхронизированных черновиков в связанной копии не входит в этот сценарий.

## 2026-11-22 · Тест 1 на iPhone, полигон ea5128d

Статус: приёмка открыта. Первые три пункта фиксируют фактическую доступность удаления. По ним пользователь не уточнил ожидаемое поведение. Причина сбоя входа пока не установлена.

1. В облачном режиме кнопки удаления профилей отсутствуют.
2. В локальной копии облачного профиля кнопка удаления «Моих покупок» отсутствует.
3. В независимом локальном режиме удаление «Моих покупок» недоступно. Созданный дополнительно локальный профиль удалить можно.
4. После создания ещё одного локального профиля открыть облачный профиль не удалось. Приложение показало сообщение о невозможности безопасно открыть локальный профиль аккаунта и предложило повторить открытие или вернуться к локальным профилям. По сообщению Ильи, после обновления страницы авторизация облачного профиля сбросилась.
5. Сообщение о неверных учётных данных должно быть красным и более заметным.
6. В диалоге синхронизации вокруг флажка «Больше не спрашивать для этого профиля» видна цветная обводка. Требуется убрать её в сенсорном сценарии.

Скриншоты получены в чате. Изображения с адресами аккаунтов в репозиторий не загружались.

## 2026-11-22 · Дополнение к интерфейсу меню профилей

Пункты 7–11 продолжают нумерацию замечаний теста 1. Статус требований: зафиксированы для реализации.

7. Если активна локальная копия облачного профиля, в форме входа показывать только поле пароля. Поле e-mail скрыть.
8. Под полем пароля расположить «Войти» и «Забыли пароль?» в одном ряду. Кнопку входа выделить ярче.
9. При активном локальном профиле показывать кнопку «Зарегистрироваться» ниже ряда «Войти» и «Забыли пароль?». Пользователь сообщил, что кнопка исчезла из меню.
10. При создании нового локального профиля сразу открывать окно ввода его названия.
11. В окне ввода названия профиля добавить кнопку очистки поля по образцу окна переименования списка.

## 2026-11-22 · План исправлений после сбоя синхронизации профиля A

- На рабочей ветке синхронизация профиля A завершилась ошибкой, после обновления страницы повтор прошёл. В [c9f81bd](https://github.com/MusicMeasurer/shopping-app/commit/c9f81bd83edfa65ea738551f9f568521fee62eee) полная сверка последовательно читает товары каждого активного списка дважды, даже при пустой очереди. Причина конкретного сбоя и тайм-аут не подтверждены.
- **Задача 1, согласована.** Пакет чтения изменений по аккаунту с сохранённой позицией журнала, включая удаления. Большие ответы разбиваются на страницы. Позиция сохраняется после применения данных. При живом соединении быстрые возвраты не запускают проверку в течение 30 секунд после успешной проверки. Таймера опроса нет. Облачное уведомление и восстановление связи запускают проверку сразу, близкие сигналы объединяются. Отдельная локальная очередь сохраняется сразу и отправляется пакетами без ожидания интервала, с отдельными подтверждениями, прежними правилами конфликтов и защитой от дублей. Полная загрузка нужна на новом устройстве, при потере локальной копии или недоступности нужной истории.
- **Проверки задачи 1.** Быстрые возвраты, один изменённый товар среди 50 списков, два устройства, пропущенное уведомление, обрыв сети и перезапуск, удаления, повтор отправки и отсутствие дублей. Диагностика фиксирует этап, длительность, число запросов и код ошибки без содержимого списков. Проверить сценарий A и облачное объединение после возврата при действующей сессии. Причинная связь двух сбоев не установлена.
- **Задача 2, согласована.** Открытие облачного профиля после создания локального, восстановление сессии после обновления и замечания 5–11 теста 1. По пунктам 1–3 правила удаления сначала сверить. Изменение правил удаления ещё не согласовано.
- **Приёмка.** Прежний прогон приостановлен до исправления и целевой проверки синхронизации на iPhone и втором устройстве. После неё вернуться к прежнему списку, включая непройденный тест 5. Запись фиксирует план, реализация и приёмка открыты.

### Задача 1 · Первый этап реализации

- В рабочей ревизии [`5766295`](https://github.com/MusicMeasurer/shopping-app/commit/57662958aa8594f3c0c6d10afb03fba5bdabc6a4) быстрые возвраты используют интервал 30 секунд после успешной проверки. Уведомления и восстановление сети запускают выборочную проверку версий списков. Пустая очередь не запускает сетевую отправку. Диагностика ошибок пишет этап и длительность без содержимого покупок.
- Подготовлен черновик SQL 038 для чтения журнала по аккаунту и пакетной отправки с отдельными квитанциями. Локальная сборка и 335 модульных тестов прошли, 2 пропущены. На изолированном PostgreSQL проверены применение SQL, порядок и страницы журнала, откат, удаление, изоляция аккаунтов, смешанный пакет операций и повтор с прежними квитанциями.
- Задача открыта. Клиент продолжает использовать прежний протокол чтения и записи. Требуются подключение пакетных RPC, атомарное сохранение позиции с данными, начальный снимок и восстановление при недоступной истории, затем сквозной прогон. Полигон, рабочие базы и физическая приёмка на этом этапе не менялись.

### Задача 1 · Пакетный протокол подключён в рабочей ветке

- В [`6fa28c1`](https://github.com/MusicMeasurer/shopping-app/commit/6fa28c12fcbf8f9a1917860f7043f92c7b51eb47) клиент получает страницы журнала по аккаунту, сохраняет позицию и применённые изменения в одной транзакции IndexedDB. При первом открытии или недоступной позиции восстанавливает снимок. Неподтверждённые правки защищены от перезаписи. Очередь отправляется пакетами до 50 независимых операций со стабильными идентификаторами и отдельными квитанциями.
- Сборка и модульные тесты прошли (341, два пропущены). Изолированный PostgreSQL подтвердил миграцию, изоляцию, восстановление позиции и повтор пакетной отправки. Локальный Chromium с имитацией облачного API подтвердил десять быстрых возвратов без дополнительных запросов, восстановление после обрыва и объединение при действующей сессии. Были также проверены соседние сценарии профилей, входа и архива.
- Миграция 038 не применена на полигоне или в production. Проверка на физическом iPhone и исходный сценарий профиля A остаются открытыми. Итоговый GitHub Actions для коммита пока не подтверждён.

### Задача 2 · Открытие профилей и меню пользователя

- В [`4e438db`](https://github.com/MusicMeasurer/shopping-app/commit/4e438db1a40c337b00789ff75b303b784502b08c) открытие уже авторизованного профиля из меню не запускает перенос покупок. При ошибке подготовки можно повторить открытие или вернуться к прежнему локальному профилю с действующей сессией. Перед сменой аккаунта пароль проверяется в изолированном клиенте, поэтому неверный пароль не завершает действующую сессию.
- У сохранённой копии в форме входа отображается только пароль. «Войти» и «Забыли пароль?» расположены в одной строке, для независимого локального профиля ниже доступна регистрация. Ошибка входа выделена красным. При создании локального профиля открывается редактор имени с очисткой. Сенсорный фокус флажка не рисует обводку, клавиатурный остаётся видимым.
- Правила удаления сохранены. В облаке кнопок удаления профилей нет, исходный «Мои покупки» защищён, дополнительные локальные профили по-прежнему можно удалить при выполнении действующих условий.
- Сборка и 341 модульный тест прошли, два пропущены. Десять сценариев Playwright в мобильном Chromium с тестовым API подтвердили переключение после создания профилей, повтор открытия, возврат после сбоя без выхода, перезагрузку, вход по паролю сохранённого профиля и регрессии. Полигон и физический iPhone ещё не проверены. Результат GitHub Actions для итогового коммита не подтверждён.

### Аудит двух тестов Supabase и очереди CI

- `E3_LAB_URL` поступает из секретов среды GitHub Actions `e3-lab`. Локальный Vitest пропускает два теста без тестовой конфигурации. Это интеграционные тесты, а не модульные. В [прогоне 45023105269](https://github.com/MusicMeasurer/shopping-app/actions/runs/45023105269) на `6fa28c1` лог подтвердил результат обоих тестов. Выборка только по событиям pull request пропускала push-прогоны. В инструкцию 1 добавлена сверка конкретного workflow, события, SHA и шага.
- В [прогоне 45023853125](https://github.com/MusicMeasurer/shopping-app/actions/runs/45023853125) на `4e438db` preflight секретов прошёл. Браузерный шаг остановился на прежних ожиданиях поля email и диалога переноса. Следующий облачный шаг не был исполнен. В `8c7748b` браузерные проверки приведены в соответствие с входом по паролю сохранённого профиля и возвратом без переноса. При смене аккаунта прежняя сессия завершается после проверки новых данных. Тесты RPC и IndexedDB запускаются перед браузерным шагом.
- Ожидающий [прогон 45024972615](https://github.com/MusicMeasurer/shopping-app/actions/runs/45024972615) был отменён до создания заданий. В `e63a739` оба workflow общей лаборатории настроены на очередь `max`. Она допускает ожидание нескольких запусков и сохраняет выполнение по одному. [Точный прогон для проверки](https://github.com/MusicMeasurer/shopping-app/actions/runs/45025051934).

## 2026-11-23 · Тест 1 на iPhone, полигон dd9ffd6

**Результат: пройден с замечаниями.** Илья подтвердил результат в Safari на физическом iPhone. Три замечания остаются открытыми для повторной проверки. [Сборка полигона](https://musicmeasurer.github.io/shopping-app-preview/integration/?v=dd9ffd6).

1. **Удаление «Моих покупок».** У исходного локального профиля нет кнопки удаления, даже после переименования. В `App.tsx` кнопка скрыта для первого профиля в реестре. В `deleteLocalProfile` отдельно запрещено удаление профиля, связанного с переносом старых локальных данных. Имя на эти проверки не влияет. Если правило будет изменено, нужно определить судьбу локальных списков, покупок и архива исходного профиля, а также сценарий выбора оставшегося профиля.
2. **Цветная обводка флажка.** В диалоге переноса профиля на iPhone вокруг флажка «Больше не спрашивать для этого профиля» видна цветная обводка. Проверить фокус при появлении диалога и после касания. Убрать кольцо при сенсорном вводе и сохранить видимый фокус при клавиатурной навигации.
3. **«Добавить профиль» в облачном режиме.** В меню авторизованного профиля кнопки нет. Код показывает кнопку только в локальном режиме. Требуется возможность создать независимый локальный профиль из облачного режима без выхода из аккаунта, с сохранением действующего лимита и возможностью вернуться в облако.

## 2026-11-23 · Решение по удалению профиля и тест 2 на iPhone

### Удаление локального профиля

Илья согласовал правило для замечания 1 теста 1, включая исходный профиль «Мои покупки». Перед удалением приложение показывает окно подтверждения и предупреждает, что списки профиля будут удалены. Если у профиля есть архив покупок, в этом же окне пользователь выбирает «Удалить архив покупок» или «Оставить архив покупок». Обе кнопки находятся на одной строке и визуально отличаются. После подтверждения списки удаляются в любом случае, а архив удаляется или сохраняется согласно выбранному действию. При отмене профиль и его данные сохраняются. Правило согласовано, реализация открыта.

### Тест 2 · Архив

**Результат: пройден на физическом iPhone**, полигон `dd9ffd6`, по сообщению Ильи. Открыты два замечания:

1. В текстовом поле редактирования единицы измерения товара ввод должен начинаться со строчной буквы. Убрать автоматическую заглавную букву в начале поля.
2. Во время работы интерфейс подрагивает и иногда возвращается к началу экрана. Ожидаемое поведение: фоновая синхронизация сохраняет позицию прокрутки и не прерывает работу с интерфейсом. Причина подрагивания и сброса позиции пока не установлена.

## 2026-11-23 · Удаление облачного аккаунта · Итоговая редакция

**Статус:** пользовательское поведение согласовано. Реализация и приёмка открыты.

1. В облачном режиме справа от «Выйти» расположена кнопка «Удалить аккаунт». Приложение предупреждает о безвозвратном удалении списков, архива покупок и локальных данных этого аккаунта. Пользователь явно соглашается и вводит одноразовый код из письма. Код привязан к операции удаления, аккаунту и сессии, имеет срок действия и ограничение попыток. При отмене или неверном коде удаление не начинается.
2. После подтверждения сервер фиксирует операцию, отзывает все сессии и сразу блокирует чтение, запись и синхронизацию по старому ID, включая запросы с ранее выданными токенами. Затем удаляет данные и учётную запись. Очистка возобновляется после сбоя, повтор запроса продолжает ту же операцию.
3. Сервер хранит минимальную отметку по неизменяемому ID старого аккаунта и получает отдельное подтверждение очистки от каждой установки приложения, где оставалась его копия. Приложение проверяет статус при запуске, открытии профиля и восстановлении сети, в том числе в локальном режиме и без действующей сессии. Открытое приложение может получить событие сразу. Сетевой сбой сам по себе не подтверждает удаление.
4. Когда удаление подтверждено, приложение сразу скрывает данные старого профиля, закрывает его локальную сессию и блокирует отправку старой очереди. Очистка идёт в фоне и возобновляется после перезапуска. Если профиль был активным, приложение показывает уведомление и выбор другого профиля. Если других профилей нет, создаёт новый локальный. При открытии неактивного удалённого профиля приложение уведомляет и запускает очистку. Устройство без сети обработает удаление при первой успешной связи.
5. При удалении пользователь может выбрать «Напомнить мне по почте». С его согласия за месяц до планового окончания срока отметки отправляется одно письмо, если есть устройства без подтверждения очистки. Письмо сообщает об отсутствии подтверждений и предлагает открыть приложение с интернетом. Адрес временно хранится отдельно и удаляется после отправки либо после получения всех подтверждений. Если подтверждения не пришли, минимальная отметка по старому ID остаётся доступной для поздно подключившегося устройства. Исходный срок отметки ещё нужно определить.
6. Повторная регистрация на тот же адрес доступна через 24 часа после завершения удаления на сервере. Срок проверяет сервер. Новый аккаунт получает новый ID. Устройство, пропустившее удаление, завершает очистку старого профиля и очереди перед явным новым входом, даже если адрес совпадает.
7. Удаление облачного аккаунта включает его архив. Выбор сохранения архива применяется к удалению независимого локального профиля.

## 2026-11-23 · План доработок после тестов 1 и 2

Тест 1 пройден с замечаниями, тест 2 пройден. Ниже предложена очередность работ. Прежняя нумерация ручных тестов сохраняется.

1. **Стабильность интерфейса при синхронизации.** Воспроизвести подрагивание и возврат к началу в Safari на iPhone с длинным списком и вторым устройством. Проверить сценарии с открытым редактором, прокруткой и восстановлением сети. Критерий: облачные изменения приходят, позиция прокрутки и открытый редактор сохраняются, ввод продолжается.
2. **Правки интерфейса.** Убрать цветное кольцо флажка при касании, сохранив клавиатурный фокус. Отключить автозаглавную в поле единицы измерения. Добавить «Добавить профиль» в облачном меню с действующим лимитом. Проверить создание независимого локального профиля и возврат в облако без нового входа.
3. **Удаление локального профиля.** Разрешить удаление исходного профиля «Мои покупки» с учётом старой миграции данных. Показывать предупреждение об удалении списков и, если есть архив, две визуально различимые кнопки в одной строке. Проверить отмену, удаление и сохранение архива, его доступность после перезапуска и удаление активного или последнего профиля. До реализации определить место показа сохранённого архива.
4. **Удаление облачного аккаунта.**
   - Сервер: сверить связанные таблицы, права, старый черновик 014 и резервные копии. Реализовать код, блокировку, отзыв сессий, возобновляемую очистку и серверное ограничение повторной регистрации. При восстановлении резервной копии повторно применять учтённые удаления.
   - Приложение: добавить кнопку, предупреждение, проверку статуса по старому ID, фоновую очистку и подтверждение каждой установки. Проверить активный и неактивный профиль, выбор профиля и создание нового локального профиля.
   - Напоминание: определить исходный срок отметки, реализовать отправку одного письма при согласии и отмену при полной очистке. Проверить позднее подключение устройства.
   - Приёмка: тестовые аккаунты, неверный и повторный код, отзыв сессий и отказ старому токену, прерванная очистка, второе устройство онлайн и офлайн, сохранность других профилей, регистрация до и после 24 часов и подключение старого устройства после новой регистрации.

### 2026-11-23 · Очередность и результат задачи 2 по инструкции 1

- Илья отложил задачу 1 «Стабильность интерфейса при синхронизации» до уточнения требований и поручил выполнить задачу 2.
- На ветке `feature/e4-accepted-reintegration` от принятой на полигоне основы `dd9ffd6` выполнены три правки в [`beeb466`](https://github.com/MusicMeasurer/shopping-app/commit/beeb4669a08062e2e0d69b431de3347c0102954d). При открытии диалога переноса фокус получает «Не синхронизировать». При касании флажка кольцо подавляется, клавиатурный фокус сохраняется. Поле единицы измерения товара отключает автозаглавную. «Добавить профиль» доступна в облачном меню с прежним лимитом. Открывается существующее окно имени, после его закрытия приложение переходит в созданный локальный профиль. Возврат в облачный профиль использует действующую сессию.
- Локально прошли сборка и 342 теста, два интеграционных теста пропущены в обычном наборе. На точном SHA [CI](https://github.com/MusicMeasurer/shopping-app/actions/runs/45090412586) подтвердил 36 локальных и 6 браузерных сценариев аккаунта в iPhone WebKit, включая фокус, поле единицы и создание профиля из облака. [Прогон с тестовым Supabase](https://github.com/MusicMeasurer/shopping-app/actions/runs/45090412629) подтвердил оба интеграционных теста, 7 сценариев профилей и восстановления, 4 сценария облачных списков и проверки Auth/RPC.
- Этап инструкции 1 завершён. Выкладка и повторная проверка на физическом iPhone относятся к следующему этапу.

## 2026-11-23 · Полигон f7fdb39 и приёмка на iPhone

- Опубликован коммит [f7fdb39](https://github.com/MusicMeasurer/shopping-app/commit/f7fdb392f3745d06091d505676ffa675b00ca9bf) из `feature/e4-accepted-reintegration` на интеграционном полигоне с базой `shoppingapp-migration-lab`. Фактический SHA подтверждён по `revision.txt`; в сборке включено удаление облачного аккаунта. [Выкладка](https://github.com/MusicMeasurer/shopping-app-preview/actions/runs/45121058482).
- Пункты 2 и 3 реализованы. Перенос архива удаляемого локального профиля проверен автоматически в `26957c8`; физическая проверка открыта. Пункт 4 реализован в `f7fdb39`, миграция 039, обработчик и его расписание включены на полигоне. Доставка кода на почту тестового пользователя A подтверждена Ильёй в 15:35 по Владивостоку. Удаление аккаунта при почтовой проверке не выполнялось. [Почтовый прогон](https://github.com/MusicMeasurer/shopping-app/actions/runs/45118608156).
- Для пункта 4 Илья выбрал прямую ручную проверку на iPhone без предварительных сценарных прогонов. Сквозное удаление, доставка напоминания, позднее подключение устройства и полная репетиция восстановления из резервной копии остаются открытыми. Повторены в плане приёмки незакрытые физические проверки 3, 4 и 5 и замечания к меню и авторизации. [Приёмка на iPhone](08_IPHONE_ACCEPTANCE.md).
- **Пункт 1 последнего плана «Стабильность интерфейса при синхронизации» отложен по решению Ильи из-за недельного лимита.** Вернуться в режиме чата либо после обновления лимита, когда Илья уточнит требования. Наблюдение: в Safari на iPhone интерфейс подрагивает и иногда возвращается к началу экрана. При возобновлении проверить длинный список, прокрутку, открытый редактор и восстановление сети при правках со второго устройства. Критерий: фоновые изменения приходят, позиция прокрутки, редактор и ввод сохраняются.
