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
  // Binding is asynchronous. Do not add an item until IndexedDB mapping is committed
  // and the cloud completion toolbar confirms the account list is bound.
  await expect(page.getByRole('button', { name: 'Завершить: отмеченные' })).toBeVisible()
  const rpcEvents: { status: number; code: string; message: string }[] = []
  page.on('response', async response => {
    if (!response.url().includes('/rest/v1/rpc/apply_item_change')) return
    const body = await response.json().catch(() => ({})) as { code?: string; message?: string }
    rpcEvents.push({ status: response.status(), code: body.code ?? '', message: (body.message ?? '').slice(0, 180) })
  })
  await page.getByLabel('Что нужно купить?').fill(prefix)
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: prefix })).toBeVisible()
  // Diagnostic only: account-scoped IndexedDB state and sanitized RPC status.
  const localDiagnostic = async () => page.evaluate(async ({ ownerId, listId, prefix }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shopping-app')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const read = (name: string) => new Promise<any[]>((resolve, reject) => {
      const tx = db.transaction(name, 'readonly')
      const request = tx.objectStore(name).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const [mappings, operations, items] = await Promise.all([
        read('accountListMappings'), read('accountOperations'), read('accountItems'),
      ])
      return {
        mappings: mappings.filter(row => row.accountId === ownerId).map(row => ({
          localListId: row.localListId, matchesRemote: row.remoteListId === listId,
        })),
        operations: operations.filter(row => row.accountId === ownerId).map(row => ({
          kind: row.operation?.kind, localListId: row.operation?.localListId ?? row.operation?.item?.listId,
          matchesRemote: row.operation?.remoteListId === listId,
        })),
        testItems: items.filter(row => row.accountId === ownerId && row.item?.name === prefix).map(row => ({
          localListId: row.item.listId, purchased: row.item.purchased,
        })),
      }
    } finally { db.close() }
  }, { ownerId, listId, prefix })
  console.log('E3E4 local diagnostic after add:', JSON.stringify(await localDiagnostic()))
  // Observe manual retry status if auto-flush failed, without assuming a positive count.
  await page.getByRole('button', { name: 'Отправить подготовленные изменения' }).click()
  await expect(page.getByRole('button', { name: 'Отправить подготовленные изменения' })).toBeEnabled()
  const syncMessage = (await page.locator('body').innerText()).match(/Отправлено изменений: \\d+|Нет подготовленных изменений\\.|Отправка не завершена\\.[^\\n]*/)?.[0] ?? 'No visible sync result'
  console.log('E3E4 sync diagnostic:', syncMessage)
  console.log('E3E4 local diagnostic after retry:', JSON.stringify(await localDiagnostic()))
  console.log('E3E4 RPC diagnostic:', JSON.stringify(rpcEvents))
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('id').eq('list_id', listId).eq('name', prefix).is('deleted_at', null)
    if (error) throw error
    return data?.length ?? 0
  }, { timeout: 20000, message: 'Item not synchronized; manual sync status: ' + syncMessage }).toBe(1)
  await page.getByRole('checkbox', { name: prefix }).click()
  await expect(page.getByRole('checkbox', { name: prefix })).toBeChecked()
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('purchased').eq('list_id', listId).eq('name', prefix).is('deleted_at', null)
    if (error) throw error
    return data?.[0]?.purchased
  }, { timeout: 20000, message: 'Purchase flag not synchronized after automatic account flush' }).toBe(true)
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
