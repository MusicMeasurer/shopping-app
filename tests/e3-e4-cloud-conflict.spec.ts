import { devices, expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const url = process.env.E3E4_LAB_URL ?? ''
const key = process.env.E3E4_LAB_PUBLISHABLE_KEY ?? ''
const email = process.env.E3E4_LAB_TEST_EMAIL ?? ''
const password = process.env.E3E4_LAB_TEST_PASSWORD ?? ''

test.use({ serviceWorkers: 'block' })

async function openList(page: Page, listName: string) {
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  const refuse = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
  const account = page.getByRole('button', { name: 'Открыть аккаунт' })
  await expect(refuse.or(account)).toBeVisible({ timeout: 30000 })
  if (await refuse.isVisible()) await refuse.click()
  await page.getByRole('button', { name: listName, exact: true }).click()
  await expect(page.getByRole('heading', { name: listName, exact: true })).toBeVisible()
}

async function editAmount(page: Page, item: string, amount: number) {
  await page.getByRole('button', { name: 'Изменить ' + item, exact: true }).click()
  const editor = page.getByRole('dialog', { name: 'Редактирование товара' })
  await editor.getByLabel('Количество').fill(String(amount))
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(editor).toHaveCount(0)
}

test('two WebKit sessions retain a newer offline amount and a later cloud purchase mark', async ({ page: offlinePage, context, browser }) => {
  test.setTimeout(180000)
  const syncTimeout = 30000
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key || !email || !password)
    throw new Error('Refusing to run outside the established isolated E3 lab')

  const client = createClient(url, key, { auth: { persistSession: false } })
  const { error: authError } = await client.auth.signInWithPassword({ email, password })
  expect(authError).toBeNull()
  const listName = 'E4_AMOUNT_CONFLICT_' + crypto.randomUUID()
  const { data: created, error: createError } = await client.rpc('create_e4_list', {
    p_operation: crypto.randomUUID(), p_name: listName, p_kind: 'permanent',
  })
  expect(createError).toBeNull()
  const listId: string = created.list_id
  expect(listId).toBeTruthy()
  const item = 'Молоко'
  const checkbox = (page: Page, amount: number) =>
    page.getByRole('checkbox', { name: item + ' · ' + amount + ' л', exact: true })
  const liveItem = async () => {
    const { data, error } = await client.from('shopping_items')
      .select('quantity,purchased,version,field_changed_at').eq('list_id', listId).eq('name', item)
      .is('deleted_at', null).maybeSingle()
    if (error) throw error
    return data
  }

  try {
    const { error: seedError } = await client.rpc('apply_e4_item_change', {
      p_operation: crypto.randomUUID(), p_list: listId, p_action: 'add', p_item: crypto.randomUUID(),
      p_name: item, p_purchased: false, p_expected_version: null, p_quantity: 1, p_unit: 'л',
    })
    expect(seedError).toBeNull()
    await openList(offlinePage, listName)
    await expect(checkbox(offlinePage, 1)).toBeVisible()

    const otherContext = await browser.newContext({
      ...devices['iPhone 13'], baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block',
    })
    try {
      const onlinePage = await otherContext.newPage()
      await openList(onlinePage, listName)
      await expect(checkbox(onlinePage, 1)).toBeVisible()
      await expect(checkbox(onlinePage, 1)).not.toBeChecked()
      await context.setOffline(true)
      await expect.poll(() => offlinePage.evaluate(() => navigator.onLine), {
        message: 'The first device must be offline while the second device edits the item',
      }).toBe(false)

      await editAmount(onlinePage, item, 3)
      await expect.poll(liveItem, {
        timeout: syncTimeout,
        message: 'The online device must commit the first quantity change',
      }).toMatchObject({ quantity: 3, purchased: false })
      await expect(checkbox(offlinePage, 1)).toBeVisible()
      const firstCloudEdit = await liveItem()
      const serverAmountTime = Date.parse(firstCloudEdit!.field_changed_at.amount)
      expect(Number.isFinite(serverAmountTime)).toBe(true)
      await expect.poll(() => Date.now()).toBeGreaterThan(serverAmountTime)

      await editAmount(offlinePage, item, 2)
      await expect(checkbox(offlinePage, 2)).toBeVisible()
      await expect(checkbox(offlinePage, 2)).not.toBeChecked()
      await checkbox(onlinePage, 3).click()
      await expect.poll(liveItem, {
        timeout: syncTimeout,
        message: 'The online purchase mark must reach the server before reconnect',
      }).toMatchObject({
        quantity: 3, purchased: true, field_changed_at: { amount: firstCloudEdit!.field_changed_at.amount },
      })

      await context.setOffline(false)
      await expect.poll(liveItem, {
        timeout: syncTimeout,
        message: 'Reconnect must preserve the offline quantity and the online purchase mark together',
      }).toMatchObject({ quantity: 2, purchased: true })
      await expect(checkbox(offlinePage, 2)).toBeChecked({ timeout: syncTimeout })
      await expect(checkbox(onlinePage, 2)).toBeChecked({ timeout: syncTimeout })
    } finally {
      await otherContext.close()
    }
  } finally {
    await context.setOffline(false)
    const { data: list, error: cleanupReadError } = await client.from('shopping_lists')
      .select('revision').eq('id', listId).single()
    expect(cleanupReadError).toBeNull()
    const { error: cleanupError } = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: listId, p_expected_revision: list?.revision, p_mode: 'delete_list',
    })
    expect(cleanupError).toBeNull()
    await client.auth.signOut({ scope: 'local' })
  }
})
