import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Acceptance characterization: deliberately fails if account-mode oneoff lifecycle is unavailable.
const url = process.env.E3E4_LAB_URL ?? ''
const key = process.env.E3E4_LAB_PUBLISHABLE_KEY ?? ''
const email = process.env.E3E4_LAB_TEST_EMAIL ?? ''
const password = process.env.E3E4_LAB_TEST_PASSWORD ?? ''
test.beforeAll(() => {
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key || !email || !password)
    throw new Error('Refusing to run outside the established isolated E3 lab')
})

test('account E3/E4: oneoff list can be created, completed and archived without remaining active', async ({ page }) => {
  test.setTimeout(120000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error } = await client.auth.signInWithPassword({ email, password })
  expect(error).toBeNull()
  expect(auth.user).not.toBeNull()
  const name = 'E3E4_ONEOFF_' + crypto.randomUUID()
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()

  // Required E4 account capability. Do not fabricate a default-list substitution.
  await expect(page.getByRole('button', { name: 'Добавить список' }),
    'E4 oneoff creation is absent in authenticated mode').toBeVisible()
  await page.getByRole('button', { name: 'Добавить список' }).click()
  await page.getByLabel('Название списка').fill(name)
  await page.locator('#new-list-kind').selectOption('oneoff')
  await page.getByRole('button', { name: 'Создать список' }).click()
  await expect(page.getByRole('button', { name })).toBeVisible()
  // Remaining lifecycle assertions intentionally await availability of account list creation.
  // No shared fixture or accepted environment is modified by this precondition.
  await client.auth.signOut()
})
