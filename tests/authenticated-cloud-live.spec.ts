import { test, expect } from '@playwright/test'

// Run explicitly against a disposable Supabase project with a dedicated
// confirmed email/password test user. Never commit or print credentials.
// Required build env: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY.
// Required test env: E3_LAB_EMAIL, E3_LAB_PASSWORD.
// Not included in guest smoke or default CI until a safe test identity exists.
test('real Supabase Auth login survives reload and exposes owned cloud lists', async ({ page }) => {
  const email = process.env.E3_LAB_EMAIL
  const password = process.env.E3_LAB_PASSWORD
  if (!email || !password || !process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Real-auth test requires disposable lab URL, publishable key and dedicated test credentials')
  }
  await page.goto('/shopping-app/')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByText('Вы вошли в аккаунт')).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Загрузить мои облачные списки' }).click()
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Вы вошли в аккаунт')).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible({ timeout: 20000 })
})
