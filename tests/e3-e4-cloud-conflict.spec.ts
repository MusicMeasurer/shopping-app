import { devices, expect, test, webkit, type Page } from '@playwright/test'
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

test('Chromium and WebKit retain a newer offline amount and a later cloud purchase mark', async ({ page: chromium, context }) => {
  test.setTimeout(180000)
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
    await openList(chromium, listName)
    await expect(checkbox(chromium, 1)).toBeVisible()

    const otherBrowser = await webkit.launch()
    try {
      const otherContext = await otherBrowser.newContext({ ...devices['iPhone 13'],
        baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' })
      const safari = await otherContext.newPage()
      await openList(safari, listName)
      await expect(checkbox(safari, 1)).toBeVisible()
      await expect(checkbox(safari, 1)).not.toBeChecked()
      await context.setOffline(true)

      await editAmount(safari, item, 3)
      await expect.poll(liveItem).toMatchObject({ quantity: 3, purchased: false })
      const firstCloudEdit = await liveItem()
      const serverAmountTime = Date.parse(firstCloudEdit!.field_changed_at.amount)
      expect(Number.isFinite(serverAmountTime)).toBe(true)
      await expect.poll(() => Date.now()).toBeGreaterThan(serverAmountTime)

      await editAmount(chromium, item, 2)
      await expect(checkbox(chromium, 2)).toBeVisible()
      await expect(checkbox(chromium, 2)).not.toBeChecked()
      await checkbox(safari, 3).click()
      await expect.poll(liveItem).toMatchObject({
        quantity: 3, purchased: true, field_changed_at: { amount: firstCloudEdit!.field_changed_at.amount },
      })

      const conflict = chromium.waitForResponse(async response => {
        if (!response.url().endsWith('/rest/v1/rpc/apply_e4_item_change') || response.ok()) return false
        const payload = await response.json()
        return payload.message === 'Version conflict'
      })
      await context.setOffline(false)
      await conflict
      await expect.poll(liveItem, { timeout: 30000 }).toMatchObject({ quantity: 2, purchased: true })
      await expect(checkbox(chromium, 2)).toBeChecked({ timeout: 30000 })
      await expect(checkbox(safari, 2)).toBeChecked({ timeout: 30000 })
    } finally {
      await otherBrowser.close()
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
