import { UI_TIMEOUT, AUTH_TIMEOUT, SERVER_WRITE_TIMEOUT, REMOTE_UPDATE_TIMEOUT, INITIAL_SYNC_TIMEOUT } from './test-timeouts'
import { waitForAuthChoice } from './auth-test-phases'
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
  page.setDefaultTimeout(UI_TIMEOUT)
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
  await waitForAuthChoice(page)
  await expect(page.getByRole('button', { name: 'Не синхронизировать', exact: true }).or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
  if (await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).isVisible()) await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })

  // Required E4 account capability. Do not fabricate a default-list substitution.
  await expect(page.getByRole('button', { name: 'Новый список' }),
    'E4 oneoff creation is absent in authenticated mode').toBeVisible()
  tracePhase('creating oneoff')
  await expect(page.getByText('Служебные операции облака', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Привязка и синхронизация', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Облачный архив', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  const account = page.getByRole('dialog', { name: 'Мой аккаунт' })
  await expect(account.locator('.profile-status')).toHaveText(/Синхронизировано/, { timeout: INITIAL_SYNC_TIMEOUT })
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
  await page.getByRole('button', { name: 'Добавить товар' }).click({ timeout: UI_TIMEOUT })
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
  }, { timeout: SERVER_WRITE_TIMEOUT }).toBe(2)
  tracePhase('completing list')
  const completeTrigger = page.getByRole('button', { name: 'Завершить список', exact: true })
  const completeMenu = page.getByRole('menu', { name: 'Завершение' })
  try {
    await completeTrigger.click()
    await expect(completeMenu).toBeVisible()
    await completeMenu.getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
  } catch (error) {
    console.log('[completion menu diagnostic]', await page.evaluate(() => {
      const trigger = document.querySelector<HTMLButtonElement>('.list-toolbar button[aria-label="Завершить список"]')
      return { activeCards: document.querySelectorAll('.list-select[aria-pressed="true"]').length,
        triggerExists: !!trigger, disabled: trigger?.disabled, expanded: trigger?.getAttribute('aria-expanded'),
        menuExists: !!document.querySelector('[role="menu"][aria-label="Завершение"]'),
        itemRows: document.querySelectorAll('main li:has(input[type="checkbox"])').length,
        loading: !!Array.from(document.querySelectorAll('[role="status"]')).find(node => node.textContent === 'Загружаем покупки…'),
        dialogs: document.querySelectorAll('dialog[open], [role="dialog"]').length }
    }))
    throw error
  }
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('button', { name: 'Завершить: всё куплено' }).click()
  await expect(page.locator('.list-action-notice')).toHaveText('Список завершён.', { timeout: SERVER_WRITE_TIMEOUT })
  await expect(page.getByRole('button', { name, exact: true }),
    'Completed one-off must disappear from active lists').toHaveCount(0)
  await page.getByRole('button', { name: /^Архив,/ }).click()
  const e4Archive = page.getByRole('region', { name: 'Архив покупок' })
  await expect(e4Archive.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(e4Archive.getByText(secondItem + ' — 2 л')).toBeVisible()
  // Acceptance must survive a fresh application boot, not only React state.
  tracePhase('reloading app')
  await page.reload()
  await expect(e4Archive.getByRole('heading', { name, exact: true })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })
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
    await waitForAuthChoice(page)
    await expect(declineImport.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
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
      await expect(merge.getByText(/исчезнет из активных списков/)).toBeVisible({ timeout: SERVER_WRITE_TIMEOUT })
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
    await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })
    await expect(queue).toHaveCount(0, { timeout: SERVER_WRITE_TIMEOUT })
    await expect(page.getByRole('button', { name: first, exact: true })).toHaveCount(0)
    await expect(page.locator('.profile-menu-trigger').getByText('Синхронизировано', { exact: false })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })
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
    await waitForAuthChoice(page)
    await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
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
    await expect(itemNotice).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(itemNotice).toContainText('Товар «' + itemName + '» перемещён в архив на другом устройстве.')
    await expect(editor).toHaveCount(0)
    await itemNotice.getByRole('button', { name: 'Понятно', exact: true }).click()
    await expect(itemNotice).toHaveCount(0)
    await expect(page.getByRole('heading', { name: lostName, exact: true })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: itemName, exact: true })).toHaveCount(0)
    await expect.poll(() => captured()).toBe(lostId)
    await remove(lostId)
    const notice = page.getByRole('dialog', { name: 'Список удалён' })
    await expect(notice).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(notice).toContainText('Список «' + lostName + '» удалён на другом устройстве.')
    await expect(page.locator('.list-select').filter({ hasText: lostName })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(notice).toBeVisible()
    await page.reload()
    await expect(notice).toBeVisible({ timeout: AUTH_TIMEOUT })
    await notice.getByRole('button', { name: 'Понятно', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect(page.getByRole('button', { name: keepName, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.reload()
    await expect(page.getByRole('heading', { name: keepName, exact: true })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })
    await expect(notice).toHaveCount(0)
  } finally {
    for (const id of ids) await remove(id)
    await client.auth.signOut({ scope: 'local' })
  }
})

test('remote merge restores the recipient and keeps an already shown notice before later deletion', async ({ page }) => {
  test.setTimeout(180000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  expect(auth.error).toBeNull()
  const account = auth.data.user!.id
  const suffix = crypto.randomUUID()
  const fallbackName = 'SYNC_MERGE_F_' + suffix, firstName = 'SYNC_MERGE_A_' + suffix
  const targetName = 'SYNC_MERGE_B_' + suffix, secondName = 'SYNC_MERGE_C_' + suffix
  const ids: string[] = []
  async function create(name: string) {
    const r = await client.rpc('create_e4_list', { p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent' })
    if (r.error) throw r.error
    const id = r.data.list_id as string
    ids.push(id)
    return id
  }
  async function remove(id: string) {
    const r = await client.from('shopping_lists').select('revision,deleted_at').eq('id', id).maybeSingle()
    if (r.error) throw r.error
    if (!r.data || r.data.deleted_at) return
    const result = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: id, p_expected_revision: r.data.revision, p_mode: 'delete_list',
    })
    if (result.error) throw result.error
  }
  async function merge(source: string, target: string) {
    const preview = await client.rpc('preview_e4_list_merge', { p_source: source, p_target: target })
    if (preview.error) throw preview.error
    expect(preview.data.items).toEqual([])
    const result = await client.rpc('merge_e4_personal_lists', {
      p_operation: crypto.randomUUID(), p_source: source, p_target: target,
      p_source_revision: preview.data.source.revision, p_target_revision: preview.data.target.revision, p_items: [],
    })
    if (result.error) throw result.error
  }
  async function captured() {
    return page.evaluate(account => new Promise<string | null>((resolve, reject) => {
      const open = indexedDB.open('shopping-app')
      open.onerror = () => reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction('accountSyncEvents', 'readonly')
        const request = tx.objectStore('accountSyncEvents').get(account)
        request.onsuccess = () => resolve(request.result?.context?.listId ?? null)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      }
    }), account)
  }
  async function select(name: string, id: string) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect.poll(captured).toBe(id)
  }
  try {
    const fallback = await create(fallbackName), first = await create(firstName)
    const target = await create(targetName), second = await create(secondName)
    await page.goto('/shopping-app/')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
    await waitForAuthChoice(page)
    await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
    if (await decline.isVisible()) await decline.click()
    await select(fallbackName, fallback)
    await select(firstName, first)
    const rail = page.locator('.list-rail')
    await rail.evaluate(el => { el.scrollLeft = el.scrollWidth })
    await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    await merge(first, target)
    const merged = page.getByRole('dialog', { name: 'Списки объединены' })
    await expect(merged).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(merged).toContainText('Список «' + firstName + '» объединён со списком «' + targetName + '» на другом устройстве.')
    await merged.getByRole('button', { name: 'Понятно' }).click()
    await expect(merged).toHaveCount(0)
    await expect(page.getByRole('button', { name: targetName, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    // Establish an explicit fallback, then receive the second merge and delete
    // its recipient while the original notification is still shown.
    await select(fallbackName, fallback)
    await select(secondName, second)
    await merge(second, target)
    await expect(merged).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    const firstText = 'Список «' + secondName + '» объединён со списком «' + targetName + '» на другом устройстве.'
    await expect(merged).toContainText(firstText)
    await remove(target)
    await expect(page.locator('.list-select').filter({ hasText: targetName })).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(merged).toContainText(firstText)
    await merged.getByRole('button', { name: 'Понятно' }).click()
    const removed = page.getByRole('dialog', { name: 'Список удалён' })
    await expect(removed).toBeVisible()
    await expect(removed).toContainText('Список «' + targetName + '» удалён на другом устройстве.')
    await removed.getByRole('button', { name: 'Понятно' }).click()
    await expect(removed).toHaveCount(0)
    await expect(page.getByRole('button', { name: fallbackName, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => rail.evaluate(el => el.scrollLeft)).toBeLessThan(2)
    await expect(merged).toHaveCount(0)
  } finally {
    for (const id of ids) await remove(id)
    await client.auth.signOut({ scope: 'local' })
  }
})

test('SYNC-UI-03: background changes preserve stable scroll anchors, draft, editor and caret', async ({ page }) => {
  test.setTimeout(150000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  expect(auth.error).toBeNull()
  const suffix = crypto.randomUUID()
  const ids: string[] = []
  async function create(name: string) {
    const r = await client.rpc('create_e4_list', { p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent' })
    if (r.error) throw r.error
    ids.push(r.data.list_id)
    return r.data.list_id as string
  }
  async function remove(id: string) {
    const r = await client.from('shopping_lists').select('revision,deleted_at').eq('id', id).maybeSingle()
    if (r.error) throw r.error
    if (!r.data || r.data.deleted_at) return
    const result = await client.rpc('complete_e4_list', {
      p_operation: crypto.randomUUID(), p_list: id, p_expected_revision: r.data.revision, p_mode: 'delete_list',
    })
    if (result.error) throw result.error
  }
  async function seed(list: string, name: string) {
    const id = crypto.randomUUID()
    const r = await client.rpc('apply_e4_item_change', {
      p_operation: crypto.randomUUID(), p_list: list, p_action: 'add', p_item: id,
      p_name: name, p_purchased: false, p_expected_version: null, p_quantity: null, p_unit: null,
    })
    if (r.error) throw r.error
    return id
  }
  async function change(list: string, id: string, action: 'update' | 'delete', name: string) {
    const current = await client.from('shopping_items').select('version').eq('id', id).single()
    if (current.error) throw current.error
    // The attribute RPC accepts add/update only. Deletion uses the
    // versioned base RPC, exactly as applyRemoteMutation does in the app.
    const args = {
      p_operation: crypto.randomUUID(), p_list: list, p_action: action, p_item: id,
      p_name: action === 'delete' ? null : name,
      p_purchased: action === 'delete' ? null : true, p_expected_version: current.data.version,
    }
    const r = action === 'delete' ? await client.rpc('apply_item_change', args) :
      await client.rpc('apply_e4_item_change', { ...args, p_quantity: 3, p_unit: 'л' })
    if (r.error) throw new Error('SYNC-UI-03 remote ' + action + ': ' + r.error.code + ' ' + r.error.message)
  }
  async function caret(locator: ReturnType<typeof page.locator>, value: string) {
    await locator.fill(value)
    await locator.evaluate(node => {
      const input = node as HTMLInputElement | HTMLTextAreaElement
      input.focus()
      input.setSelectionRange(2, 5, 'backward')
      input.dataset.contextProbe = 'original'
    })
  }
  async function expectCaret(locator: ReturnType<typeof page.locator>, value: string) {
    await expect(locator).toHaveValue(value)
    await expect(locator).toBeFocused()
    await expect(locator).toHaveAttribute('data-context-probe', 'original')
    expect(await locator.evaluate(node => {
      const field = node as HTMLInputElement | HTMLTextAreaElement
      return [field.selectionStart, field.selectionEnd, field.selectionDirection]
    })).toEqual([2, 5, 'backward'])
  }
  try {
    const names = Array.from({ length: 7 }, (_, i) => 'SYNC_CTX_' + i + '_' + suffix)
    for (const name of names) await create(name)
    const activeName = names[3], activeId = ids[3]
    const items: { id: string; name: string }[] = []
    for (let i = 0; i < 18; i++) {
      const name = 'Молоко ' + String(i).padStart(2, '0')
      items.push({ name, id: await seed(activeId, name) })
    }
    await page.goto('/shopping-app/')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
    await waitForAuthChoice(page)
    await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
    if (await decline.isVisible()) await decline.click()
    await expect(page.locator('.profile-menu-trigger .profile-status')).toHaveText(/Синхронизировано/, { timeout: INITIAL_SYNC_TIMEOUT })
    const card = page.getByRole('button', { name: activeName, exact: true })
    await card.click()
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    const rail = page.locator('.list-rail')
    const tile = card.locator('..')
    await rail.evaluate((node, id) => {
      const target = Array.from(node.querySelectorAll<HTMLElement>('[data-list-id]')).find(el => el.dataset.listId === id)!
      node.scrollTo({ left: node.scrollLeft + target.getBoundingClientRect().left - node.getBoundingClientRect().left - 4, behavior: 'instant' })
    }, activeId)
    const railLeft = () => tile.evaluate(node => node.getBoundingClientRect().left - node.closest('nav')!.getBoundingClientRect().left)
    await expect.poll(railLeft).toBeLessThan(10)
    await expect.poll(railLeft).toBeGreaterThanOrEqual(-2)
    const left = await railLeft()
    console.log('[SYNC-UI-03] horizontal anchor after remote deletion')
    // Delete a different card before the visible anchor. Do not select it.
    await remove(ids[0])
    await expect(page.getByRole('button', { name: names[0], exact: true })).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    await expect.poll(async () => Math.abs(await railLeft() - left)).toBeLessThanOrEqual(4)
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: activeName, exact: true })).toBeVisible()
    await page.getByLabel('Сортировка товаров').selectOption('name-asc')
    await expect(page.locator('[data-item-id]')).toHaveCount(items.length)
    await page.locator('[data-item-id]').nth(7).evaluate(row => {
      window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - 30, behavior: 'instant' })
    })
    const vertical = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-item-id]'))
        .find(el => el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight)!
      return { id: row.dataset.itemId!, top: row.getBoundingClientRect().top, y: scrollY }
    })
    expect(vertical.y).toBeGreaterThan(100)
    const anchor = page.locator('[data-item-id="' + vertical.id + '"]')
    const top = () => anchor.evaluate(node => node.getBoundingClientRect().top)
    console.log('[SYNC-UI-03] vertical anchor after remote insertion/deletion')
    const insertedName = 'Айсберг'
    const inserted = await seed(activeId, insertedName)
    await expect(page.getByRole('checkbox', { name: insertedName, exact: true })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expect.poll(async () => Math.abs(await top() - vertical.top)).toBeLessThanOrEqual(4)
    await change(activeId, inserted, 'delete', insertedName)
    await expect(page.getByRole('checkbox', { name: insertedName, exact: true })).toHaveCount(0, { timeout: REMOTE_UPDATE_TIMEOUT })
    await expect.poll(async () => Math.abs(await top() - vertical.top)).toBeLessThanOrEqual(4)
    console.log('[SYNC-UI-03] add draft and caret')
    // The add field remains the same element with the same unsaved selection.
    const input = page.locator('#item-name')
    await caret(input, 'Несохранённая покупка')
    await seed(activeId, 'Бананы')
    await expect(page.getByRole('checkbox', { name: 'Бананы', exact: true })).toBeVisible({ timeout: REMOTE_UPDATE_TIMEOUT })
    await expectCaret(input, 'Несохранённая покупка')
    // A remote change of the very item being edited must update its saved
    // data, not the editor draft. Its native dialog must not be recreated.
    console.log('[SYNC-UI-03] editor and caret after remote field changes')
    const item = items[8]
    await page.getByRole('button', { name: 'Изменить ' + item.name, exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Редактирование товара' })
    const field = editor.getByLabel('Название')
    await editor.getByLabel('Единица измерения').fill('уп.')
    await editor.getByLabel('Количество').fill('7')
    await caret(field, 'Мой черновик товара')
    await change(activeId, item.id, 'update', item.name)
    // The underlying DOM is inert while a native modal is open. Inspect the
    // real updated row, not an accessibility locator hidden by that modal.
    const saved = page.locator('[data-item-id="' + item.id + '"]')
    await expect(saved).toContainText(item.name + ' · 3 л', { timeout: REMOTE_UPDATE_TIMEOUT })
    await expect(saved.locator('input[type="checkbox"]')).toBeChecked()
    await expect(editor).toBeVisible()
    await expectCaret(field, 'Мой черновик товара')
    await expect(editor.getByLabel('Количество')).toHaveValue('7')
    await expect(editor.getByLabel('Единица измерения')).toHaveValue('уп.')
    await editor.getByRole('button', { name: 'Отмена', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await expect(input).toHaveValue('Несохранённая покупка')
    await expect(card).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  } finally {
    for (const id of ids) await remove(id)
    await client.auth.signOut({ scope: 'local' })
  }
})

test.describe('list card sync indicators', () => {
  test.use({ serviceWorkers: 'block' })
  test('scopes a held item batch, independent waiting/error/success, retry and both icon sizes', async ({ page }) => {
    test.setTimeout(150000)
    const client = createClient(url, key, { auth: { persistSession: false } })
    const auth = await client.auth.signInWithPassword({ email, password })
    expect(auth.error).toBeNull()
    const names = ['CARD_SYNC_A_', 'CARD_SYNC_B_'].map(prefix => prefix + crypto.randomUUID())
    const ids: string[] = []
    let release!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    let first = true, firstHeld = false, failA = true
    const calls: string[][] = []
    const rpcRoute = '**/rest/v1/rpc/push_e4_account_changes'
    try {
      for (const name of names) {
        const result = await client.rpc('create_e4_list', { p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent' })
        expect(result.error).toBeNull(); ids.push(result.data.list_id)
      }
      await page.goto('/shopping-app/')
      await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
      await page.getByLabel('Email').fill(email)
      await page.getByLabel('Пароль').fill(password)
      await page.getByRole('button', { name: 'Войти', exact: true }).click()
      const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
      await waitForAuthChoice(page)
      await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
      if (await decline.isVisible()) await decline.click()
      await expect(page.locator('.profile-menu-trigger')).toContainText('Синхронизировано', { timeout: INITIAL_SYNC_TIMEOUT })
      const card = (name: string) => page.getByRole('button', { name, exact: true })
      const tile = (id: string) => page.locator('.list-tile').filter({ has: card(names[ids.indexOf(id)]) })
      const indicator = (id: string) => tile(id).locator('.list-card-sync')
      await expect(indicator(ids[0])).toHaveCount(0, { timeout: UI_TIMEOUT })
      await expect(indicator(ids[1])).toHaveCount(0, { timeout: UI_TIMEOUT })
      await page.route(rpcRoute, async route => {
        const body = route.request().postDataJSON() as { p_operations: { list_id: string; operation_id: string }[] }
        const ops = body.p_operations
        if (!ops.some(op => ids.includes(op.list_id))) return route.continue()
        calls.push(ops.map(op => op.list_id))
        if (first && ops.some(op => op.list_id === ids[0])) { first = false; firstHeld = true; await hold }
        if (!failA || !ops.some(op => op.list_id === ids[0])) return route.continue()
        const pass = ops.filter(op => op.list_id !== ids[0])
        let outcomes: { operation_id?: string; receipt?: { operation_id: string } }[] = []
        if (pass.length) {
          const response = await route.fetch({ postData: JSON.stringify({ ...body, p_operations: pass }) })
          if (!response.ok()) return route.fulfill({ response })
          outcomes = await response.json()
        }
        await route.fulfill({ status: 200, json: ops.map(op => op.list_id === ids[0]
          ? { operation_id: op.operation_id, message: 'Injected retryable transport outcome' }
          : outcomes.find(row => (row.operation_id ?? row.receipt?.operation_id) === op.operation_id)) })
      })
      const add = async (name: string) => {
        await page.getByLabel('Что нужно купить?').fill(name)
        await page.getByRole('button', { name: 'Добавить товар' }).click()
      }
      await card(names[0]).click()
      await add('Indicator A')
      await expect.poll(() => firstHeld, { timeout: UI_TIMEOUT }).toBe(true)
      await expect(indicator(ids[0])).toHaveCount(0)
      await expect(indicator(ids[1])).toHaveCount(0)
      await card(names[1]).click()
      await expect(indicator(ids[0])).toHaveAttribute('data-sync-state','running')
      async function checkSize(expected: number) {
        expect(await indicator(ids[0]).evaluate(el => {
          const tile = el.closest('.list-tile')!
          const symbol = tile.querySelector('.list-symbol')!
          const rect = el.getBoundingClientRect(), parent = tile.getBoundingClientRect()
          const art = el.querySelector('.sync-indicator-artwork')!
          const icon = el.querySelector('.sync-indicator-icon')!
          return [parseFloat(getComputedStyle(symbol).fontSize), Math.round(rect.width * 10) / 10,
            Math.abs(rect.x + rect.width / 2 - parent.x - parent.width / 2) < 1,
            Math.abs(rect.y + rect.height / 2 - parent.y - parent.height / 2) < 1,
            getComputedStyle(art).backgroundColor, getComputedStyle(icon).animationName,
            getComputedStyle(icon).animationDuration, tile.querySelector('.list-card-indicators') === null]
        })).toEqual([expected, expected, true, true, 'rgba(255, 255, 255, 0.1)', 'sync-live-spin', '1.8s', true])
      }
      await checkSize(34.5)
      await page.getByRole('button', { name: 'Настройки', exact: true }).click()
      const settings = page.getByRole('dialog', { name: 'Настройки приложения' })
      await settings.getByRole('radio', { name: 'Стандартный (горизонтальная лента)' }).check()
      await settings.getByRole('button', { name: 'Сохранить', exact: true }).click()
      await checkSize(27)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await card(names[1]).click()
      await add('Indicator B')
      await expect(indicator(ids[1])).toHaveCount(0)
      await card(names[0]).click()
      await expect(indicator(ids[0])).toHaveCount(0)
      await expect(indicator(ids[1])).toHaveAttribute('data-sync-state','waiting')
      release()
      await expect(indicator(ids[0])).toHaveAttribute('data-sync-state','error', { timeout: SERVER_WRITE_TIMEOUT })
      await expect(indicator(ids[1])).toHaveAttribute('data-sync-state','success', { timeout: SERVER_WRITE_TIMEOUT })
      await expect(indicator(ids[1])).toHaveCount(0, { timeout: UI_TIMEOUT })
      await card(names[1]).click()
      await expect(card(names[1])).toHaveAttribute('aria-pressed', 'true')
      const beforeSelection = calls.length
      await card(names[0]).locator('.list-symbol').click()
      await expect(card(names[0])).toHaveAttribute('aria-pressed', 'true')
      await expect(indicator(ids[0])).toHaveAttribute('data-sync-state','error')
      expect(calls).toHaveLength(beforeSelection)
      await card(names[1]).click()
      failA = false
      const before = calls.length
      await indicator(ids[0]).click()
      await expect(indicator(ids[0])).toHaveAttribute('data-sync-state','success', { timeout: SERVER_WRITE_TIMEOUT })
      expect(calls.slice(before).flat()).toContain(ids[0])
      expect(calls.slice(before).flat()).not.toContain(ids[1])
      await expect(indicator(ids[0])).toHaveCount(0, { timeout: UI_TIMEOUT })

      // A read of the unchanged server state must not dismiss an unconfirmed
      // direct rename. The card retries the same operation UUID and payload.
      await card(names[0]).click()
      const renameRoute = '**/rest/v1/rpc/apply_e4_list_metadata'
      const attempts: string[] = []
      await page.route(renameRoute, async route => {
        const body = route.request().postDataJSON() as { p_operation: string; p_list: string }
        if (body.p_list !== ids[0]) return route.continue()
        attempts.push(body.p_operation)
        if (attempts.length === 1) return route.fulfill({ status: 503, json: { message: 'Injected rename failure' } })
        return route.continue()
      })
      const renamed = names[0] + '_renamed'
      try {
        await page.getByRole('button', { name: 'Переименовать список', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Переименовать список' })
        await dialog.getByLabel('Название списка').fill(renamed)
        await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click()
        await expect(dialog.getByRole('alert')).toBeVisible({ timeout: SERVER_WRITE_TIMEOUT })
        await dialog.getByRole('button', { name: 'Отмена', exact: true }).click()
        await expect(indicator(ids[0])).toHaveAttribute('data-sync-state','error')
        await indicator(ids[0]).click()
        await expect(card(renamed)).toBeVisible({ timeout: SERVER_WRITE_TIMEOUT })
        expect(attempts).toHaveLength(2)
        expect(attempts[1]).toBe(attempts[0])
      } finally { await page.unroute(renameRoute) }
    } finally {
      release()
      await page.unroute(rpcRoute)
      await page.close()
      for (const id of ids) {
        const row = await client.from('shopping_lists').select('revision,deleted_at').eq('id', id).maybeSingle()
        if (row.error) throw row.error
        if (row.data && !row.data.deleted_at) {
          const result = await client.rpc('complete_e4_list', { p_operation: crypto.randomUUID(), p_list: id,
            p_expected_revision: row.data.revision, p_mode: 'delete_list' })
          if (result.error) throw result.error
        }
      }
      await client.auth.signOut({ scope: 'local' })
    }
  })
})


test.describe('sync diagnostics with intercepted network', () => {
  test.use({ serviceWorkers: 'block' })
test('diagnostic journal distinguishes a delayed session check and a lost committed item response', async ({ page, context }) => {
  test.setTimeout(150000)
  const client = createClient(url, key, { auth: { persistSession: false } })
  const auth = await client.auth.signInWithPassword({ email, password })
  expect(auth.error).toBeNull()
  const name = 'SYNC_TRACE_' + crypto.randomUUID()
  const item = 'TRACE_ITEM_' + crypto.randomUUID()
  const created = await client.rpc('create_e4_list', { p_operation: crypto.randomUUID(), p_name: name, p_kind: 'permanent' })
  expect(created.error).toBeNull()
  const id = created.data.list_id as string
  const journalKey = 'shopping-app:sync-diagnostics:v1'
  const read = () => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]') as
    { at: number; span?: number; stage: string; outcome: string; elapsedMs?: number; count?: number; pending?: boolean }[], journalKey)
  const has = (stage: string, outcome: string) => async () => (await read()).some(row => row.stage === stage && row.outcome === outcome)
  const authRoute = '**/auth/v1/user', pushRoute = '**/rest/v1/rpc/push_e4_account_changes'
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  let held = false, allow = false, committed = false
  const operationIds: string[] = []
  try {
    await page.goto('/shopping-app/')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await waitForAuthChoice(page)
    const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
    await expect(decline.or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: UI_TIMEOUT })
    if (await decline.isVisible()) await decline.click()
    await expect(page.locator('.profile-menu-trigger')).toContainText('Синхронизировано', { timeout: INITIAL_SYNC_TIMEOUT })
    await page.getByRole('button', { name, exact: true }).click()
    await page.bringToFront()
    await expect.poll(() => page.evaluate(() => document.visibilityState), { timeout: UI_TIMEOUT }).toBe('visible')
    // Block service workers only in this intercepted-network scenario, as in
    // the existing conflict/card tests. Drive a real offline/online transition.
    await page.evaluate(key => localStorage.removeItem(key), journalKey)
    await context.setOffline(true)
    await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: UI_TIMEOUT }).toBe(false)
    await expect.poll(has('offline','ok'), { timeout: UI_TIMEOUT }).toBe(true)
    await page.route(authRoute, async route => {
      if (!held) { held = true; await hold }
      return route.continue()
    })
    await context.setOffline(false)
    await expect.poll(() => page.evaluate(() => navigator.onLine), { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(has('online','ok'), { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(has('session','start'), { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(() => held, { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(has('identity','start'), { timeout: UI_TIMEOUT }).toBe(true)
    // Intentional injected latency, not a replacement for a state assertion.
    await new Promise(resolve => setTimeout(resolve, 350))
    release()
    await expect.poll(has('session','ok'), { timeout: AUTH_TIMEOUT }).toBe(true)
    expect((await read()).some(row => row.stage === 'identity' && row.outcome === 'ok' && (row.elapsedMs ?? 0) >= 350)).toBe(true)
    await page.unroute(authRoute)
    await expect(page.locator('.profile-menu-trigger')).toContainText('Синхронизировано', { timeout: INITIAL_SYNC_TIMEOUT })
    await page.route(pushRoute, async route => {
      const body = route.request().postDataJSON() as { p_operations: { operation_id: string; list_id: string }[] }
      const ops = body.p_operations.filter(op => op.list_id === id)
      if (!ops.length) return route.continue()
      operationIds.push(...ops.map(op => op.operation_id))
      if (allow) return route.continue()
      const response = await route.fetch()
      if (response.ok()) {
        const rows = await response.json()
        if (Array.isArray(rows) && rows.some(row => row.receipt)) committed = true
      }
      return route.abort()
    })
    await page.getByLabel('Что нужно купить?').fill(item)
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect.poll(() => committed, { timeout: SERVER_WRITE_TIMEOUT }).toBe(true)
    await expect.poll(async () => (await read()).some(row => row.stage === 'batch-send' && ['error','rejected'].includes(row.outcome)), { timeout: SERVER_WRITE_TIMEOUT }).toBe(true)
    const failed = await read()
    expect(failed.some(row => row.stage === 'receipt-store' && row.outcome === 'ok')).toBe(false)
    expect(failed.some(row => row.stage === 'queue' && row.count === 1)).toBe(true)
    await expect(page.locator('.profile-menu-trigger')).toContainText(/ошибк/i, { timeout: UI_TIMEOUT })
    await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
    const dialog = page.getByRole('dialog', { name: 'Мой аккаунт' })
    allow = true
    await dialog.getByRole('button', { name: 'Повторить синхронизацию' }).click()
    await expect.poll(has('manual','start'), { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(has('receipt-store','ok'), { timeout: SERVER_WRITE_TIMEOUT }).toBe(true)
    await expect.poll(async () => {
      const rows = await read()
      const receipt = rows.findIndex(row => row.stage === 'receipt-store' && row.outcome === 'ok')
      return receipt >= 0 && rows.slice(receipt + 1).some(row => row.stage === 'queue' && row.outcome === 'ok' && row.count === 0)
    }, { timeout: SERVER_WRITE_TIMEOUT }).toBe(true)
    expect(operationIds.length).toBeGreaterThan(1)
    expect(new Set(operationIds).size).toBe(1)
    await expect(dialog.locator('.profile-status')).toHaveText(/Синхронизировано/, { timeout: INITIAL_SYNC_TIMEOUT })
    await dialog.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect.poll(has('visible','ok'), { timeout: UI_TIMEOUT }).toBe(true)
    await expect.poll(async () => {
      const rows = await read()
      const receipt = rows.findIndex(row => row.stage === 'receipt-store' && row.outcome === 'ok')
      return receipt >= 0 && rows.slice(receipt + 1).some(row => row.stage === 'feed-store' && row.outcome === 'ok')
    }, { timeout: REMOTE_UPDATE_TIMEOUT }).toBe(true)
    await page.reload()
    await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible({ timeout: INITIAL_SYNC_TIMEOUT })
    await expect.poll(has('manual','start'), { timeout: UI_TIMEOUT }).toBe(true)
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard blocked for test') } } }))
    await page.getByRole('button', { name: 'Настройки', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Настройки приложения' })
    await settings.getByRole('button', { name: 'Копировать журнал диагностики' }).click()
    const copy = settings.getByRole('textbox', { name: 'Журнал диагностики' })
    await expect(copy).toBeVisible()
    const exported = await copy.inputValue()
    expect(JSON.parse(exported).events).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'manual', outcome: 'start' })]))
    for (const secret of [email, password, auth.data.user!.id, id, name, item, ...operationIds]) expect(exported).not.toContain(secret)
    const { count, error } = await client.from('shopping_items').select('id', { count: 'exact', head: true }).eq('list_id', id).is('deleted_at', null)
    expect(error).toBeNull(); expect(count).toBe(1)
  } catch (error) {
    // This schema is intentionally closed and contains no account/item data.
    console.log('[SYNC-DIAG phase]', JSON.stringify({ online: await page.evaluate(() => navigator.onLine),
      visibility: await page.evaluate(() => document.visibilityState), events: (await read()).slice(-45) }))
    throw error
  } finally {
    release()
    await context.setOffline(false)
    await page.unroute(authRoute)
    await page.unroute(pushRoute)
    await page.close()
    const row = await client.from('shopping_lists').select('revision,deleted_at').eq('id', id).maybeSingle()
    if (row.error) throw row.error
    if (row.data && !row.data.deleted_at) {
      const result = await client.rpc('complete_e4_list', { p_operation: crypto.randomUUID(), p_list: id,
        p_expected_revision: row.data.revision, p_mode: 'delete_list' })
      if (result.error) throw result.error
    }
    await client.auth.signOut({ scope: 'local' })
  }
})
})
