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
