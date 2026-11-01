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
