import { UI_TIMEOUT, REMOTE_UPDATE_TIMEOUT, SERVER_WRITE_TIMEOUT } from './test-timeouts'
import { waitForAuthChoice, expectCloudProfile } from './auth-test-phases'
import { test, expect } from '@playwright/test'

// Run explicitly against a disposable Supabase project with a dedicated
// confirmed email/password test user. Never commit or print credentials.
// Required build env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
// Required test env: E3_LAB_EMAIL, E3_LAB_PASSWORD.
test('real account A: existing Siri HTTP item appears in the bound mobile shopping list', async ({ page, request }) => {
  const email = process.env.E3_LAB_EMAIL
  const password = process.env.E3_LAB_PASSWORD
  if (!email || !password || !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Missing disposable lab authentication')
  }
  // Identify the account using the real Auth API; never log credentials or JWT.
  const auth = await request.post(process.env.VITE_SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    headers: { apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY! },
    data: { email, password },
  })
  expect(auth.ok(), 'Disposable account A authentication must succeed').toBeTruthy()
  const session = await auth.json() as { user?: { id?: string } }
  expect(session.user?.id, 'Configured account A must own the Siri fixture list').toBe('5f6483d0-13b1-47f9-bc91-74a3a56f65d1')
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
  const account = page.getByRole('button', { name: 'Открыть аккаунт' })
  await waitForAuthChoice(page)
  await expect(decline.or(account)).toBeVisible({ timeout: UI_TIMEOUT })
  if (await decline.isVisible()) await decline.click()
  await expect(account).toBeVisible()
  await page.getByText('Привязка и синхронизация', { exact: true }).click()
  await page.getByRole('button', { name: 'Загрузить мои облачные списки' }).click()
  await expect(page.getByRole('option', { name: 'SHOPPINGAPP_HTTP_TEST_A' })).toBeAttached({ timeout: REMOTE_UPDATE_TIMEOUT })
  await page.getByLabel('Локальный список').selectOption('groceries')
  await page.getByLabel('Облачный список').selectOption({ label: 'SHOPPINGAPP_HTTP_TEST_A' })
  await page.getByRole('button', { name: 'Привязать' }).click()
  await expect(page.getByText('Продукты: облачный список привязан', { exact: false }), 'List binding failed; inspect UI alert and account mappings').toBeVisible({ timeout: SERVER_WRITE_TIMEOUT })
  // This fixture was previously written by the deployed Siri HTTP endpoint.
  // This browser test reads it without creating any new server-side items.
  await expect(page.getByRole('checkbox', { name: 'E3 HTTP verified fixture' })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
  await page.reload()
  await expectCloudProfile(page)
  await expect(page.getByRole('checkbox', { name: 'E3 HTTP verified fixture' })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
})
