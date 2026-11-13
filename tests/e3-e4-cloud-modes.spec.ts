import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Isolated E3/E4 authenticated acceptance: additional modes not covered by marked-only test.
const url = process.env.E3E4_LAB_URL ?? ''
const key = process.env.E3E4_LAB_PUBLISHABLE_KEY ?? ''
const email = process.env.E3E4_LAB_TEST_EMAIL ?? ''
const password = process.env.E3E4_LAB_TEST_PASSWORD ?? ''
test.beforeAll(() => {
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key || !email || !password)
    throw new Error('Isolated E3 lab credentials missing; refusing to run against any other environment')
})

test('cloud E3/E4: all-purchased and none-purchased have distinct archive outcomes; permanent list survives reload', async ({ page }) => {
  test.setTimeout(150000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error: authError } = await client.auth.signInWithPassword({ email, password })
  expect(authError).toBeNull()
  const ownerId = auth.user!.id
  const { data: list, error: listError } = await client.from('shopping_lists')
    .insert({ owner_id: ownerId, name: 'E3E4_MODES_' + crypto.randomUUID(), kind: 'permanent' })
    .select('id').single()
  expect(listError).toBeNull()
  const listId: string = list!.id

  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()
  await page.getByRole('button', { name: 'Загрузить мои облачные списки' }).click()
  await page.locator('#remote-cloud-list').selectOption(listId)
  await page.getByRole('button', { name: 'Привязать', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Завершить: всё куплено' })).toBeVisible()

  async function addAndSync(name: string) {
    await page.getByLabel('Что нужно купить?').fill(name)
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect(page.getByRole('checkbox', { name })).toBeVisible()
    await expect.poll(async () => {
      const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', name).is('deleted_at', null)
      if (error) throw error
      return data?.length ?? 0
    }, { timeout: 20000 }).toBe(1)
  }
  const purchasedName = 'all-' + crypto.randomUUID().slice(0, 8)
  await addAndSync(purchasedName)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Завершить: всё куплено' }).click()
  await expect(page.getByRole('checkbox', { name: purchasedName })).toHaveCount(0)
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', purchasedName).is('deleted_at', null)
    if (error) throw error
    return data?.length ?? -1
  }).toBe(0)
  await page.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: purchasedName }).first()).toBeVisible()

  const unpurchasedName = 'none-' + crypto.randomUUID().slice(0, 8)
  await addAndSync(unpurchasedName)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Завершить: ничего не куплено' }).click()
  await expect(page.getByRole('checkbox', { name: unpurchasedName })).toHaveCount(0)
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', unpurchasedName).is('deleted_at', null)
    if (error) throw error
    return data?.length ?? -1
  }).toBe(0)
  await page.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: purchasedName }).first()).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: unpurchasedName })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Продукты', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Завершить: всё куплено' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: purchasedName })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: unpurchasedName })).toHaveCount(0)
  await client.auth.signOut()
})
