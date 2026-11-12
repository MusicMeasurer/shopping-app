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
