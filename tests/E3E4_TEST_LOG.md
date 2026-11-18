# E3/E4 integration test journal — 2026-11-13

## Reuse established credentials (do not recreate test users)
Source: `feature/e3-cloud-auth:.github/workflows/e3-verify.yml`, job `real-auth-existing-user-lab`; `tests/authenticated-cloud-live.spec.ts`; main `docs/05_DEV_LOG.md`. Previously successful runs: 42349194228, 42359235928.

GitHub Actions environment: **`e3-lab`**.
- `E3_LAB_URL`: isolated `https://gmrqeubhotjpmtwokfeq.supabase.co`
- `E3_LAB_PUBLISHABLE_KEY`: public API key
- `E3_USER_A_EMAIL`, `E3_USER_A_PASSWORD`
- `E3_USER_B_EMAIL`, `E3_USER_B_PASSWORD`
- Historical `SHOPPINGAPP_TEST_*` may exist for older HTTP A/B tests.

The E3/E4 workflow maps `E3E4_LAB_TEST_EMAIL/PASSWORD` from existing `E3_USER_A_*` environment secrets. No secret values are logged, printed, or committed.

Historical E3 fixture: `SHOPPINGAPP_HTTP_TEST_A`, UUID `6d5b862e-4296-4f03-91ee-89274d6a1772`, owner A `5f6483d0-13b1-47f9-bc91-74a3a56f65d1`. **Do not mutate/complete this shared list**; it contains prior HTTP test items. The new browser test creates its own owned permanent list per run instead.

Workflow: `.github/workflows/e3-e4-cloud-browser.yml`; test: `tests/e3-e4-cloud-acceptance.spec.ts`. Serial `--workers=1` avoids shared-account concurrency. Never use production or `shoppingapp-security-lab`.

Earlier run failed at config validation because the workflow invented new secret names. The established names and environment above fix this configuration mistake. **Run result must still be checked; no claim of E2E success until verified.**

This journal is in the feature branch to avoid unauthorized changes to `main/docs/05_DEV_LOG.md`. After acceptance, transfer the relevant facts to the canonical log under a separately authorized documentation update.

## 2026-11-13 · Повторная сверка E3↔E4 и решение о точечном завершении (Инструкция 1)

- 09.11 журнал main/docs/05_DEV_LOG.md зафиксировал несовместимую основу первоначальной E4 (E3 IndexedDB v6 / E4 v3); 10.11 в feature/e3-e4-integration уже были единая IndexedDB v7, локальные списки E4, архив и сохранённые account stores E3.
- Проверены ветки feature/e3-e4-integration, feature/e4-accepted-reintegration, feature/e4-accessibility-archive-fixes, snapshot/e4-local-integration-ci-passed-2026-11-11 и связанные исходники. Повторная разработка локального E4 не требуется.
- Фактический разрыв в текущей ветке: account-mode App.tsx выбирает фиксированные lists, а создание/переименование/тип/архив UI ограничены accountId === null. Локальные E4 методы и cloud completion/archives существуют; облачные метаданные списков реализованы частично (022/023 REVIEW_ONLY и e4-cloud-list-metadata.ts, не подключённый к account UI). RPC 023 не содержит create/delete; облачный lifecycle oneoff не подтверждён.
- Действие: выполнить Инструкцию 1 на feature/e4-accepted-reintegration с повторным использованием E4 и проверенными E3 контрактами; не менять main, production, shoppingapp-security-lab и принятые данные. Сначала подтвердить недостающий облачный контракт и его security/rollback gates, затем подключить account UI и выполнить негативные/регрессионные/браузерные проверки. Не объявлять E4 account lifecycle завершённым до проверок.
- Ранее подтверждены браузерные сценарии трёх режимов завершения постоянного облачного списка. Тест oneoff показал отсутствие создания в account UI (run 43335452610); не трактовать это как отсутствие локальной E4 реализации.
- Эта запись ведётся в рабочей ветке как оперативный журнал: канонический main/docs/05_DEV_LOG.md не изменён, поскольку main остаётся защищённым от изменений без отдельного разрешения.

### 2026-11-13 · Hosted contract verification (read-only)
- SQL introspection of shoppingapp-migration-lab shows shopping_lists already has kind and position; therefore 022 metadata columns are **present in hosted lab**, despite older REVIEW_ONLY header. No claim is made about the exact migration that added them.
- Only complete_e4_list appears among public functions named *e4*; apply_e4_list_metadata from 023 is **not deployed**. No versioned cloud create/delete RPC is present in the reviewed 023 draft. Thus cloud account list CRUD cannot be safely enabled by simply lifting UI gates.
- No SQL writes were executed. Before applying privileged list operations, require owner-only authorization, idempotency, conflict tests, A/B isolation and recovery checks.
