import { UI_TIMEOUT, SERVER_WRITE_TIMEOUT, REMOTE_UPDATE_TIMEOUT } from './test-timeouts'
import { waitForAuthChoice } from './auth-test-phases'
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
  await waitForAuthChoice(page)
  await expect(refuse.or(account)).toBeVisible({ timeout: UI_TIMEOUT })
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
  const syncTimeout = SERVER_WRITE_TIMEOUT
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
      await expect(checkbox(offlinePage, 2)).toBeChecked({ timeout: REMOTE_UPDATE_TIMEOUT })
      await expect(checkbox(onlinePage, 2)).toBeChecked({ timeout: REMOTE_UPDATE_TIMEOUT })
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


// Production incident A, 2026-11-28. Two independent regressions on the
// existing hosted WebKit job; never point them at production.
async function incidentLab() {
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key || !email || !password)
    throw new Error('Refusing to run incident regression outside the disposable lab')
  const client = createClient(url, key, { auth: { persistSession: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.user) throw auth.error ?? new Error('Missing lab identity')
  const accountId = auth.data.user.id
  const fixtures: string[] = []
  async function create(name: string) {
    const { data, error } = await client.rpc('create_e4_list', {
      p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent',
    })
    if (error) throw error
    const id = data.list_id as string
    fixtures.push(id)
    return id
  }
  async function activeList(id: string) {
    const { data, error } = await client.from('shopping_lists').select('id,revision')
      .eq('id', id).eq('owner_id', accountId).is('deleted_at', null).maybeSingle()
    if (error) throw error
    return data
  }
  async function remove(id: string) {
    const row = await activeList(id)
    if (!row) return
    const response = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: id, p_expected_revision: row.revision, p_mode: 'delete_list',
    })
    if (response.error) throw response.error
  }
  async function seed(listId: string, name: string) {
    const id = crypto.randomUUID()
    const { error } = await client.rpc('apply_e4_item_change', {
      p_operation: crypto.randomUUID(), p_list: listId, p_action: 'add', p_item: id,
      p_name: name, p_purchased: false, p_expected_version: null, p_quantity: 1, p_unit: 'л',
    })
    if (error) throw error
    return id
  }
  async function itemRows(listId: string) {
    const { data, error } = await client.from('shopping_items')
      .select('id,name,quantity,purchased').eq('list_id', listId).is('deleted_at', null).order('id')
    if (error) throw error
    return data
  }
  async function cleanup() {
    try { for (const id of fixtures) await remove(id) }
    finally { await client.auth.signOut({ scope: 'local' }) }
  }
  return { client, accountId, create, activeList, remove, seed, itemRows, cleanup }
}

async function incidentLocalQueue(page: Page, account: string, list: string) {
  return page.evaluate(async ({ account, list }) => new Promise<{ requests: number; intents: number }>((resolve, reject) => {
    const open = indexedDB.open('shopping-app')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(['accountCompletionRequests', 'accountCompletions'], 'readonly')
      const requests = tx.objectStore('accountCompletionRequests').getAll()
      const intents = tx.objectStore('accountCompletions').getAll()
      tx.oncomplete = () => {
        const result = {
          requests: requests.result.filter(row => row.accountId === account && row.remoteListId === list).length,
          intents: intents.result.filter(row => row.intent.accountId === account && row.intent.remoteListId === list).length,
        }
        db.close()
        resolve(result)
      }
      tx.onabort = () => { db.close(); reject(tx.error) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
  }), { account, list })
}

test('INC-A1: remote deletion against an offline edit exposes review, converges and permits further writes', async ({ page, context, browser }) => {
  test.setTimeout(180000)
  const lab = await incidentLab()
  const name = 'INC_A1_' + crypto.randomUUID()
  const itemName = 'Молоко конфликт', keepName = 'Контроль остатка'
  let other: Awaited<ReturnType<typeof browser.newContext>> | undefined
  try {
    const id = await lab.create(name)
    const itemId = await lab.seed(id, itemName)
    const keepId = await lab.seed(id, keepName)
    await openList(page, name)
    other = await browser.newContext({ ...devices['iPhone 13'], baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' })
    const online = await other.newPage()
    await openList(online, name)
    for (const p of [page, online]) {
      await expect(p.getByRole('checkbox', { name: itemName + ' · 1 л', exact: true })).toBeVisible()
      await expect(p.getByRole('checkbox', { name: keepName + ' · 1 л', exact: true })).toBeVisible()
    }
    await context.setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
    await editAmount(page, itemName, 2)
    await expect(page.getByRole('checkbox', { name: itemName + ' · 2 л', exact: true })).toBeVisible()
    const { data, error } = await lab.client.from('shopping_items').select('version').eq('id', itemId).single()
    if (error) throw error
    // The attribute RPC supports add/update only. Use the same versioned
    // deletion RPC as the established hosted regression.
    const deletion = await lab.client.rpc('apply_item_change', {
      p_operation: crypto.randomUUID(), p_list: id, p_action: 'delete', p_item: itemId,
      p_name: null, p_purchased: null, p_expected_version: data.version,
    })
    expect(deletion.error).toBeNull()
    await expect.poll(() => lab.itemRows(id), { timeout: SERVER_WRITE_TIMEOUT }).toEqual([
      { id: keepId, name: keepName, quantity: 1, purchased: false },
    ])
    await expect(online.getByRole('checkbox', { name: itemName + ' · 1 л', exact: true })).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    await context.setOffline(false)
    const conflict = page.getByRole('list', { name: 'Конфликты удаления' }).getByRole('button', { name: new RegExp(itemName) })
    await expect(conflict).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(page.locator('.profile-menu-trigger').getByText('Синхронизировано', { exact: false })).not.toBeVisible()
    // Conflict must survive deferral, and the saved offline quantity must still be visible in the decision.
    await conflict.click()
    const review = page.getByRole('dialog', { name: 'Конфликт удаления' })
    await expect(review).toContainText('2 л')
    await review.getByRole('button', { name: 'Позже', exact: true }).click()
    await expect(conflict).toBeVisible()
    await conflict.click()
    await review.getByRole('button', { name: 'Подтвердить удаление', exact: true }).click()
    await expect(review).toHaveCount(0, { timeout: SERVER_WRITE_TIMEOUT })
    await expect(conflict).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    await page.getByRole('checkbox', { name: keepName + ' · 1 л', exact: true }).click()
    await expect.poll(() => lab.itemRows(id), { timeout: SERVER_WRITE_TIMEOUT }).toEqual([
      { id: keepId, name: keepName, quantity: 1, purchased: true },
    ])
    await expect(online.getByRole('checkbox', { name: keepName + ' · 1 л', exact: true })).toBeChecked({ timeout: REMOTE_UPDATE_TIMEOUT })
    for (const p of [page, online]) {
      await expect(p.locator('li[data-item-id]')).toHaveCount(1, { timeout: REMOTE_UPDATE_TIMEOUT })
      await expect(p.getByRole('checkbox', { name: keepName + ' · 1 л', exact: true })).toBeChecked()
      await expect(p.locator('.profile-menu-trigger').getByText('Синхронизировано', { exact: false })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    }
  } finally {
    try { await context.setOffline(false); await other?.close() }
    finally { await lab.cleanup() }
  }
})

test('INC-A2: externally deleted list with a durable unsent deletion does not block the other list after recovery', async ({ page, context }) => {
  test.setTimeout(180000)
  const lab = await incidentLab()
  const suffix = crypto.randomUUID(), lost = 'INC_A2_LOST_' + suffix, keep = 'INC_A2_KEEP_' + suffix
  const keepItem = 'Независимая покупка'
  try {
    const lostId = await lab.create(lost), keepId = await lab.create(keep)
    await lab.seed(lostId, 'Удаляемая покупка')
    const keepItemId = await lab.seed(keepId, keepItem)
    await openList(page, lost)
    await expect(page.getByRole('checkbox', { name: 'Удаляемая покупка · 1 л', exact: true })).toBeVisible()
    await page.getByRole('button', { name: keep, exact: true }).click()
    await expect(page.getByRole('checkbox', { name: keepItem + ' · 1 л', exact: true })).toBeVisible()
    await page.getByRole('button', { name: lost, exact: true }).click()
    await context.setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await page.getByRole('menuitem', { name: /Удалить список/ }).click()
    await page.getByRole('dialog', { name: 'Удалить список?' }).getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect.poll(() => incidentLocalQueue(page, lab.accountId, lostId), { timeout: 5000 }).toEqual({ requests: 1, intents: 0 })
    expect(await lab.activeList(lostId)).not.toBeNull()
    // Equivalent to the administrator's actual incident recovery: a separate,
    // owner-authorized operation, not a forged receipt for the offline request.
    await lab.remove(lostId)
    expect(await lab.activeList(lostId)).toBeNull()
    await context.setOffline(false)
    const notice = page.getByRole('dialog', { name: 'Список удалён' })
    const queueRow = page.getByRole('list', { name: 'Операции со списками' }).getByRole('listitem').filter({ hasText: lost })
    const cancel = queueRow.getByRole('button', { name: 'Отменить операцию', exact: true })
    // A semantic notice may need explicit acknowledgement before a queued action
    // becomes accessible. Accept either safe automatic reconciliation or explicit cancel.
    await expect.poll(async () => {
      if (await notice.isVisible()) return 'notice'
      if ((await incidentLocalQueue(page, lab.accountId, lostId)).requests === 0) return 'cleared'
      if (await cancel.isVisible()) return 'cancel'
      return 'blocked'
    }, { timeout: REMOTE_UPDATE_TIMEOUT }).not.toBe('blocked')
    let acknowledged = false
    if (await notice.isVisible()) {
      await notice.getByRole('button', { name: 'Понятно', exact: true }).click()
      acknowledged = true
    }
    await expect.poll(async () => {
      const q = await incidentLocalQueue(page, lab.accountId, lostId)
      return q.requests === 0 && q.intents === 0 ? 'cleared' : await cancel.isVisible() ? 'cancel' : 'blocked'
    }, { timeout: REMOTE_UPDATE_TIMEOUT }).not.toBe('blocked')
    if (await cancel.isVisible()) {
      // Cancel only an unsent local request; the DB deletion must remain.
      expect((await incidentLocalQueue(page, lab.accountId, lostId)).intents).toBe(0)
      await cancel.click()
    }
    await expect.poll(() => incidentLocalQueue(page, lab.accountId, lostId), { timeout: SERVER_WRITE_TIMEOUT }).toEqual({ requests: 0, intents: 0 })
    await expect(page.getByRole('button', { name: lost, exact: true })).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    // With a deferred removal, the semantic notice is published only after
    // reconciliation, not necessarily before cancellation. Acknowledge it
    // before testing independent shopping actions.
    if (!acknowledged) {
      await expect(notice).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
      await notice.getByRole('button', { name: 'Понятно', exact: true }).click()
    }
    await expect(notice).toHaveCount(0)
    await page.getByRole('button', { name: keep, exact: true }).click()
    await page.getByRole('checkbox', { name: keepItem + ' · 1 л', exact: true }).click()
    await expect.poll(() => lab.itemRows(keepId), { timeout: SERVER_WRITE_TIMEOUT }).toEqual([
      { id: keepItemId, name: keepItem, quantity: 1, purchased: true },
    ])
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: lost, exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: keep, exact: true }).click()
    await expect(page.getByRole('checkbox', { name: keepItem + ' · 1 л', exact: true })).toBeChecked()
    await expect(queueRow).toHaveCount(0)
    await expect(page.locator('.profile-menu-trigger').getByText('Синхронизировано', { exact: false })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    expect(await lab.activeList(lostId)).toBeNull()
    expect(await incidentLocalQueue(page, lab.accountId, lostId)).toEqual({ requests: 0, intents: 0 })
  } finally {
    try { await context.setOffline(false) }
    finally { await lab.cleanup() }
  }
})
