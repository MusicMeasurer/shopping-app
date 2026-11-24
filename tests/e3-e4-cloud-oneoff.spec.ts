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
  test.setTimeout(180000)
  const tracePhase = (name: string) => console.log('[E4 acceptance phase]', name)
  page.on('console', message => { if (message.type() === 'error') console.log('[browser console]', message.text()) })
  page.on('pageerror', error => console.log('[browser pageerror]', error.message))
  page.on('requestfailed', request => console.log('[browser requestfailed]', request.method(), request.url(), request.failure()?.errorText))
  test.info().annotations.push({ type: 'diagnostic', description: 'Phase trace in job logs; last phase before timeout identifies blocker' })
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error } = await client.auth.signInWithPassword({ email, password })
  expect(error).toBeNull()
  expect(auth.user).not.toBeNull()
  // Verify server readiness before browser interaction. A missing RPC is a
  // deployment blocker, not a browser rendering defect. This intentionally
  // remains a failing acceptance test until the isolated lab is provisioned.
  const probeOperation = crypto.randomUUID()
  const { error: rpcError } = await client.rpc('create_e4_list', {
    p_operation: probeOperation, p_name: '', p_kind: 'oneoff',
  })
  expect(rpcError?.code, 'E4 create_e4_list RPC is missing from the isolated lab; deploy only after security review').not.toBe('PGRST202')
  expect(rpcError, 'E4 RPC preflight must reject an empty list name').not.toBeNull()
  const name = 'E3E4_ONEOFF_' + crypto.randomUUID()
  tracePhase('opening app')
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  // Explicitly retain independent guest data in this regression.
  await expect(page.getByRole('button', { name: 'Не синхронизировать', exact: true }).or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: 30000 })
  if (await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).isVisible()) await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: 30000 })

  // Required E4 account capability. Do not fabricate a default-list substitution.
  await expect(page.getByRole('button', { name: 'Новый список' }),
    'E4 oneoff creation is absent in authenticated mode').toBeVisible()
  tracePhase('creating oneoff')
  await expect(page.getByText('Служебные операции облака', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Привязка и синхронизация', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Облачный архив', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  const account = page.getByRole('dialog', { name: 'Мой аккаунт' })
  await expect(account.locator('.profile-status')).toHaveText(/Синхронизировано/, { timeout: 60000 })
  await expect(account.getByRole('button', { name: 'Повторить синхронизацию' })).toHaveCount(0)
  await account.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
  await page.getByRole('button', { name: 'Новый список' }).click()
  await page.getByRole('textbox', { name: 'Название списка', exact: true }).fill(name)
  await page.locator('#new-list-kind').selectOption('oneoff')
  await page.getByRole('dialog').getByRole('button', { name: 'Подарок', exact: true }).click()
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  // Successful user creation selects the newly verified, bound list.
  // Do not click the card: that would hide a selection regression.
  const cardSymbol = page.locator('.list-tile')
    .filter({ has: page.getByRole('button', { name, exact: true }) }).locator('.list-symbol')
  await expect(cardSymbol).toHaveText('🎁')
  tracePhase('verifying automatic selection of oneoff')
  const newCard = page.getByRole('button', { name, exact: true })
  await expect(newCard).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect.poll(() => newCard.evaluate(button => {
    const item = button.getBoundingClientRect()
    const viewport = button.closest('nav')!.getBoundingClientRect()
    return item.left >= viewport.left - 1 && item.right <= viewport.right + 1
  })).toBe(true)
  // Exercise the actual account item queue and completion protocol, not just
  // creation of a button. Use a unique disposable list in the isolated lab.
  tracePhase('adding item')
  const secondItem = 'E4_SECOND_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill('E4_TEST_ITEM_' + crypto.randomUUID() + '\n' + secondItem + ' 2 л')
  // Keep the editor focused and use a normal pointer click to verify hit testing.
  await page.getByRole('button', { name: 'Добавить товар' }).click({ timeout: 12000 })
  await expect(page.getByRole('button', { name: 'Завершить список', exact: true })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('checkbox') }).first()).toBeVisible()
  // The account sync must confirm the queued item before completion.
  tracePhase('waiting for remote item')
  await expect.poll(async () => {
    const { data } = await client.from('shopping_lists').select('id').eq('name', name).single()
    if (!data?.id) return 0
    const { count } = await client.from('shopping_items').select('id', { count: 'exact', head: true })
      .eq('list_id', data.id).is('deleted_at', null)
    return count ?? 0
  }, { timeout: 30000 }).toBe(2)
  tracePhase('completing list')
  await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
  await page.getByRole('menu', { name: 'Завершение' }).getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('button', { name: 'Завершить: всё куплено' }).click()
  await expect(page.locator('.list-action-notice')).toHaveText('Список завершён.', { timeout: 20000 })
  await expect(page.getByRole('button', { name, exact: true }),
    'Completed one-off must disappear from active lists').toHaveCount(0)
  await page.getByRole('button', { name: /^Архив,/ }).click()
  const e4Archive = page.getByRole('region', { name: 'Архив покупок' })
  await expect(e4Archive.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(e4Archive.getByText(secondItem + ' — 2 л')).toBeVisible()
  // Acceptance must survive a fresh application boot, not only React state.
  tracePhase('reloading app')
  await page.reload()
  await expect(e4Archive.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: 30000 })
  await page.getByRole('button', { name: 'Основные списки', exact: true }).click()
  await expect(page.getByRole('button', { name, exact: true }),
    'Completed one-off reappeared after reload').toHaveCount(0)
  await client.auth.signOut({ scope: 'local' })
})

test.describe('queued cloud list operations', () => {
  test.use({ serviceWorkers: 'block' })

  test('a lost deletion response leaves the other list usable and is recovered after restart', async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/shopping-app/')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    const declineImport = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
    await expect(declineImport.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: 30000 })
    if (await declineImport.isVisible()) await declineImport.click()

    const first = 'QUEUE_A_' + crypto.randomUUID()
    const second = 'QUEUE_B_' + crypto.randomUUID()
    for (const name of [first, second]) {
      await page.getByRole('button', { name: 'Новый список' }).click()
      await page.getByLabel('Название списка', { exact: true }).fill(name)
      await page.getByRole('button', { name: 'Создать', exact: true }).click()
      await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    }

    // Cancel and a server-rejected duplicate must not change the selected list.
    const selected = page.getByRole('button', { name: second, exact: true })
    const newList = page.getByRole('button', { name: 'Новый список' })
    await newList.click()
    const createDialog = page.getByRole('dialog', { name: 'Создать список' })
    await createDialog.getByLabel('Название списка').fill(first)
    await createDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await newList.click()
    await createDialog.getByLabel('Название списка').fill(first)
    await createDialog.getByRole('button', { name: 'Создать', exact: true }).click()
    await expect(createDialog.getByRole('alert')).toBeVisible()
    await expect(selected).toHaveAttribute('aria-pressed', 'true')
    await createDialog.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(page.getByRole('heading', { name: second, exact: true })).toBeVisible()

    await page.getByRole('button', { name: first, exact: true }).click()
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Объединить со списком', exact: true }).click()
    const merge = page.getByRole('dialog', { name: 'Объединить списки' })
    const authCheck = '**/auth/v1/user'
    let checks = 0
    await page.route(authCheck, async route => {
      if (++checks === 1) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } })
      return route.continue()
    })
    try {
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await merge.getByRole('button', { name: second, exact: true }).click()
      await expect(merge.getByText(/исчезнет из активных списков/)).toBeVisible({ timeout: 15000 })
      expect(checks).toBeGreaterThan(1)
      await merge.getByRole('button', { name: 'Отмена', exact: true }).click()
    } finally {
      await page.unroute(authCheck)
    }

    let releaseResponse!: () => void
    const holdResponse = new Promise<void>(resolve => { releaseResponse = resolve })
    let lostResponse = false
    await page.route('**/rest/v1/rpc/complete_e4_list', async route => {
      if (lostResponse) return route.continue()
      lostResponse = true
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await holdResponse
      await route.abort()
    })
    async function deleteList(name: string) {
      await page.getByRole('button', { name: name, exact: true }).click()
      await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
      await page.getByRole('menuitem', { name: /Удалить список/ }).click()
      await page.getByRole('dialog', { name: 'Удалить список?' }).getByRole('button', { name: 'Удалить', exact: true }).click()
    }
    try {
      await deleteList(first)
      await expect.poll(() => lostResponse).toBe(true)
      await expect(page.getByText('Удаляем «' + first + '»…')).toBeVisible()
      await deleteList(second)
      await expect(page.getByText('«' + second + '» ожидает синхронизации')).toBeVisible()
    } finally {
      releaseResponse()
    }
    const queue = page.getByRole('list', { name: 'Операции со списками' })
    await expect(queue.getByRole('alert')).toContainText('Не удалось подтвердить удаление')
    await expect(page.getByRole('button', { name: second, exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: 30000 })
    await expect(queue).toHaveCount(0, { timeout: 30000 })
    await expect(page.getByRole('button', { name: first, exact: true })).toHaveCount(0)
    await expect(page.locator('.profile-menu-trigger').getByText('Синхронизировано', { exact: false })).toBeVisible({ timeout: 30000 })
  })
})

test('remote item archival and active-list deletion are acknowledged once and survive restart', async ({ page }) => {
  test.setTimeout(180000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const { data: auth, error } = await client.auth.signInWithPassword({ email, password })
  expect(error).toBeNull()
  const accountId = auth.user!.id
  const suffix = crypto.randomUUID()
  const keepName = 'SYNC_UI_KEEP_' + suffix, lostName = 'SYNC_UI_LOST_' + suffix
  const ids: string[] = []
  async function create(name: string) {
    const { data, error } = await client.rpc('create_e4_list', {
      p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent',
    })
    if (error) throw error
    const id = data.list_id as string
    ids.push(id)
    return id
  }
  async function remove(id: string) {
    const { data, error } = await client.from('shopping_lists').select('revision,deleted_at').eq('id', id).maybeSingle()
    if (error) throw error
    if (!data || data.deleted_at) return
    const response = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: id, p_expected_revision: data.revision, p_mode: 'delete_list',
    })
    if (response.error) throw response.error
  }
  async function captured(field: 'listId' | 'itemId' = 'listId') {
    return page.evaluate(async ({ account, field }) => new Promise<string | null>((resolve, reject) => {
      const open = indexedDB.open('shopping-app')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('accountSyncEvents', 'readonly')
        const request = tx.objectStore('accountSyncEvents').get(account)
        request.onsuccess = () => resolve(request.result?.context?.[field] ?? null)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      }
    }), { account: accountId, field })
  }
  try {
    const keepId = await create(keepName), lostId = await create(lostName)
    const itemId = crypto.randomUUID(), itemName = 'SYNC_UI_ITEM_' + suffix
    const seed = await client.rpc('apply_e4_item_change', {
      p_operation: crypto.randomUUID(), p_list: lostId, p_action: 'add', p_item: itemId,
      p_name: itemName, p_purchased: true, p_expected_version: null, p_quantity: null, p_unit: null,
    })
    expect(seed.error).toBeNull()
    await page.goto('/shopping-app/')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
    await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: 30000 })
    if (await decline.isVisible()) await decline.click()
    await page.getByRole('button', { name: keepName, exact: true }).click()
    await expect.poll(() => captured()).toBe(keepId)
    await page.getByRole('button', { name: lostName, exact: true }).click()
    await expect.poll(() => captured()).toBe(lostId)
    await page.getByRole('button', { name: 'Изменить ' + itemName, exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Редактирование товара' })
    await editor.getByLabel('Название').fill('Несохранённый черновик')
    await expect.poll(() => captured('itemId')).toBe(itemId)
    const current = await client.from('shopping_lists').select('revision').eq('id', lostId).single()
    expect(current.error).toBeNull()
    const archive = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: lostId, p_expected_revision: current.data!.revision, p_mode: 'archive_purchased',
    })
    expect(archive.error).toBeNull()
    const itemNotice = page.getByRole('dialog', { name: 'Товар в архиве' })
    await expect(itemNotice).toBeVisible({ timeout: 45000 })
    await expect(itemNotice).toContainText('Товар «' + itemName + '» перемещён в архив на другом устройстве.')
    await expect(editor).toHaveCount(0)
    await itemNotice.getByRole('button', { name: 'Понятно', exact: true }).click()
    await expect(itemNotice).toHaveCount(0)
    await expect(page.getByRole('heading', { name: lostName, exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: itemName, exact: true })).toHaveCount(0)
    await expect.poll(() => captured()).toBe(lostId)
    await remove(lostId)
    const notice = page.getByRole('dialog', { name: 'Список удалён' })
    await expect(notice).toBeVisible({ timeout: 45000 })
    await expect(notice).toContainText('Список «' + lostName + '» удалён на другом устройстве.')
    await expect(page.locator('.list-select').filter({ hasText: lostName })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(notice).toBeVisible()
    await page.reload()
    await expect(notice).toBeVisible({ timeout: 30000 })
    await notice.getByRole('button', { name: 'Понятно', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByRole('button', { name: keepName, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect(page.getByRole('heading', { name: keepName, exact: true })).toBeVisible({ timeout: 30000 })
    await expect(notice).toHaveCount(0)
  } finally {
    for (const id of ids) await remove(id)
    await client.auth.signOut({ scope: 'local' })
  }
})
