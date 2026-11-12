import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Real authenticated Supabase lab only. No service-role key in the browser.
// These tests must never target the accepted security-lab or production.
const lab = 'gmrqeubhotjpmtwokfeq'
const url = process.env.E3E4_LAB_URL ?? ''
const key = process.env.E3E4_LAB_PUBLISHABLE_KEY ?? ''
const email = process.env.E3E4_LAB_TEST_EMAIL ?? ''
const password = process.env.E3E4_LAB_TEST_PASSWORD ?? ''
const fixturePrefix = 'E3E4_BROWSER_ISOLATED_'
const expectedURL = 'https://' + lab + '.supabase.co'
const ready = url === expectedURL && !!key && !!email && !!password
test.beforeAll(() => {
  if (!ready) throw new Error('Authenticated E3/E4 E2E prerequisites missing: isolated lab URL, publishable key, disposable user credentials are required; never use production credentials.')
})

test('authenticated cloud E3/E4: cancel leaves cloud state unchanged; marked-only completion persists after reload', async ({ page }) => {
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: signed, error: authError } = await client.auth.signInWithPassword({ email, password })
  expect(authError).toBeNull()
  expect(signed.user?.id).toBeTruthy()
  const ownerId = signed.user!.id
  // Each run creates its own empty list; never mutate the historical shared HTTP fixture.
  const { data: created, error: listError } = await client.from('shopping_lists')
    .insert({ owner_id: ownerId, name: fixturePrefix + crypto.randomUUID(), kind: 'permanent' })
    .select('id,owner_id,kind,deleted_at').single()
  expect(listError).toBeNull()
  expect(created?.owner_id).toBe(ownerId)
  const listId: string = created!.id
  const { data: initial, error: itemsError } = await client.from('shopping_items').select('id').eq('list_id', listId).is('deleted_at', null)
  expect(itemsError).toBeNull()
  expect(initial).toHaveLength(0)
  const prefix = 'e2e-' + crypto.randomUUID().slice(0, 8)
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить мои облачные списки' }).click()
  await page.locator('#remote-cloud-list').selectOption(listId)
  await page.getByRole('button', { name: 'Привязать', exact: true }).click()
  await page.getByLabel('Что нужно купить?').fill(prefix)
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: prefix })).toBeVisible()
  await page.getByRole('button', { name: 'Отправить подготовленные изменения' }).click()
  await expect(page.getByText(/Отправлено изменений: [1-9]/)).toBeVisible()
  // Require an actual remote sync before completion; no mocked RPC or optimistic-only assertions.
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', prefix).is('deleted_at', null)
    if (error) throw error
    return data?.length ?? 0
  }).toBe(1)
  await page.getByRole('checkbox', { name: prefix }).click()
  await expect(page.getByRole('checkbox', { name: prefix })).toBeChecked()
  await page.getByRole('button', { name: 'Отправить подготовленные изменения' }).click()
  await expect(page.getByText(/Отправлено изменений: [1-9]/)).toBeVisible()
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('purchased').eq('list_id', listId).eq('name', prefix).is('deleted_at', null)
    if (error) throw error
    return data?.[0]?.purchased
  }).toBe(true)
  const completion = page.getByRole('button', { name: 'Завершить: отмеченные' })
  page.once('dialog', dialog => dialog.dismiss())
  await completion.click()
  await expect(page.getByRole('checkbox', { name: prefix })).toBeChecked()
  page.once('dialog', dialog => dialog.accept())
  await completion.click()
  await expect(page.getByRole('checkbox', { name: prefix })).toHaveCount(0)
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', prefix).is('deleted_at', null)
    if (error) throw error
    return data?.length ?? -1
  }).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Продукты', exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: prefix })).toHaveCount(0)
  await client.auth.signOut()
})
