import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Hosted coverage for consecutive shopping cycles in a permanent account list.
const url = process.env.E3E4_LAB_URL ?? ''
const key = process.env.E3E4_LAB_PUBLISHABLE_KEY ?? ''
const email = process.env.E3E4_LAB_TEST_EMAIL ?? ''
const password = process.env.E3E4_LAB_TEST_PASSWORD ?? ''
test.beforeAll(() => {
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key || !email || !password)
    throw new Error('Refusing to run outside the established isolated E3 lab')
})

test('account E3/E4: permanent list archives all or marked purchases and skips a cycle without purchases', async ({ page }) => {
  test.setTimeout(300000)
  // The overall limit covers multiple real shopping cycles, not a missing
  // menu. Individual browser actions must fail promptly with their locator.
  page.setDefaultTimeout(12000)
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
    p_operation: probeOperation, p_name: '', p_kind: 'permanent',
  })
  expect(rpcError?.code, 'E4 create_e4_list RPC is missing from the isolated lab; deploy only after security review').not.toBe('PGRST202')
  expect(rpcError, 'E4 RPC preflight must reject an empty list name').not.toBeNull()
  const name = 'E3E4_PERMANENT_' + crypto.randomUUID()
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
    'E4 list creation is absent in authenticated mode').toBeVisible()
  // Establish the initial account snapshot before triggering a second-device update.
  await expect(page.locator('.profile-menu-trigger .profile-status'))
    .toHaveText(/Синхронизировано/, { timeout: 60000 })
  tracePhase('creating a list from a second client while the app is open')
  const createExternal = async (listName: string) => {
    const { error } = await client.rpc('create_e4_list', {
      p_operation: crypto.randomUUID(), p_name: listName, p_kind: 'permanent',
    })
    expect(error).toBeNull()
  }
  const previouslySelected = page.locator('.list-select[aria-pressed="true"]')
  await expect(previouslySelected).toHaveCount(1)
  const previousId = await previouslySelected.locator('..').getAttribute('data-list-id')
  await createExternal(name)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible({ timeout: 60000 })
  await expect(previouslySelected.locator('..')).toHaveAttribute('data-list-id', previousId!)
  await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'false')
  // Discover and bind the existing server-owned list before allowing writes.
  tracePhase('selecting permanent list')
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  // Exercise the actual account item queue and completion protocol, not just
  // creation of a button. Use a unique disposable list in the isolated lab.
  tracePhase('adding item')
  const firstItem = 'E4_FIRST_CYCLE_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill(firstItem)
  await page.getByLabel('Что нужно купить?').blur()
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
  }, { timeout: 30000 }).toBe(1)
  // This diagnostic covers operations on a confirmed item. A visible server
  // row alone does not prove that its local version receipt survived a reload.
  // The separate offline/recovery suites exercise intentionally pending writes.
  async function waitForItemReceipt(itemName: string) {
    const { data: list, error: listError } = await client.from('shopping_lists')
      .select('id').eq('name', name).single()
    expect(listError).toBeNull()
    const { data: item, error: itemError } = await client.from('shopping_items')
      .select('id,version').eq('list_id', list!.id).eq('name', itemName).is('deleted_at', null).single()
    expect(itemError).toBeNull()
    await expect.poll(() => page.evaluate(async ({ account, listId, itemId, version }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('shopping-app')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        const tx = db.transaction(['accountItemVersions', 'accountOperations'], 'readonly')
        const read = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        const [versions, queued] = await Promise.all([
          read(tx.objectStore('accountItemVersions').index('byAccount').getAll(account)),
          read(tx.objectStore('accountOperations').index('byAccount').getAll(account)),
        ])
        const confirmed = versions.find(row => row.itemId === itemId && row.remoteListId === listId)
        return { versionConfirmed: typeof confirmed?.version === 'number' && confirmed.version >= version,
          pending: queued.some(row => (row.operation.itemId ?? row.operation.item?.id) === itemId) }
      } finally { db.close() }
    }, { account: auth.user!.id, listId: list!.id, itemId: item!.id, version: item!.version }),
    { timeout: 30000, message: 'Server item must have its confirmed local version and no pending item operation' })
      .toEqual({ versionConfirmed: true, pending: false })
  }
  await waitForItemReceipt(firstItem)
  async function completeList(buttonName: string) {
    await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
    await page.getByRole('menu', { name: 'Завершение' }).getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: buttonName, exact: true }).click()
    await expect(page.locator('.list-action-notice')).toHaveText('Список завершён.', { timeout: 20000 })
  }

  tracePhase('editing item attributes before archiving')
  const editedItem = 'E4_EDITED_' + crypto.randomUUID()
  async function editFirstItem(current: string, name: string, quantity: string, unit: string) {
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('checkbox', { name: current, exact: false }),
    })
    await row.getByRole('button', { name: 'Изменить ' + current, exact: true }).click()
    const editor = page.getByRole('dialog', { name: 'Редактирование товара' })
    await editor.getByLabel('Название').fill(name)
    await editor.getByLabel('Количество').fill(quantity)
    await editor.getByLabel('Единица измерения').fill(unit)
    const save = editor.getByRole('button', { name: 'Сохранить', exact: true })
    try {
      await save.click()
      await expect(editor).toBeHidden()
    } catch (error) {
      console.log('[editor diagnostic]', { visible: await editor.isVisible(),
        alerts: await editor.getByRole('alert').allTextContents(),
        saveEnabled: await save.isEnabled({ timeout: 1000 }).catch(() => false),
        profileStatus: await page.locator('.profile-menu-trigger .profile-status').textContent({ timeout: 1000 }).catch(() => null) })
      throw error
    }
  }
  const { data: editedList, error: editedListError } = await client.from('shopping_lists')
    .select('id').eq('name', name).single()
  expect(editedListError).toBeNull()
  async function checkItemAttributes(quantity: number | null, unit: string | null) {
    await expect.poll(async () => {
      const { data, error } = await client.from('shopping_items').select('name,quantity,unit')
        .eq('list_id', editedList!.id).is('deleted_at', null)
      if (error) throw error
      return data
    }, { timeout: 30000 }).toEqual([{ name: editedItem, quantity, unit }])
    await waitForItemReceipt(editedItem)
  }
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await editFirstItem(firstItem, editedItem, '2.5', 'кг')
  await checkItemAttributes(2.5, 'кг')
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('checkbox', { name: editedItem + ' · 2.5 кг', exact: true })).toBeVisible()
  await editFirstItem(editedItem, editedItem, '', '')
  await checkItemAttributes(null, null)
  await editFirstItem(editedItem, editedItem, '3', 'л')
  await checkItemAttributes(3, 'л')
  const archivedEditedItem = editedItem + ' — 3 л'

  tracePhase('completing first cycle')
  await completeList('Завершить: всё куплено')
  // A permanent list survives completion, but its completed purchase is archived.
  await expect(page.getByRole('button', { name, exact: true }),
    'Permanent list must remain active after completion').toBeVisible()
  await page.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  const archive = page.getByRole('region', { name: 'Облачный архив' })
  const archivedCycles = archive.getByRole('status').locator(':scope > ul > li').filter({
    has: page.locator('strong').filter({ hasText: name }),
  })
  await expect(archivedCycles).toHaveCount(1)
  await expect(archivedCycles.getByText(archivedEditedItem, { exact: true })).toBeVisible()
  tracePhase('reloading permanent list')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible()
  await expect(page.getByRole('button', { name, exact: true }),
    'Permanent list disappeared after reload').toBeVisible()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  // A completed permanent list must be reusable for a fresh shopping cycle.
  const nextItem = 'E4_SECOND_CYCLE_' + crypto.randomUUID()
  const unmarkedItem = 'E4_UNMARKED_' + crypto.randomUUID()
  for (const item of [unmarkedItem, nextItem]) {
    await page.getByLabel('Что нужно купить?').fill(item)
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect(page.getByRole('checkbox', { name: item, exact: true })).toBeVisible()
  }
  const marked = page.getByRole('checkbox', { name: nextItem, exact: true })
  const unmarked = page.getByRole('checkbox', { name: unmarkedItem, exact: true })
  async function expectCloudMarks(purchased: boolean) {
    await expect.poll(async () => {
      const { data: owned } = await client.from('shopping_lists').select('id').eq('name', name).single()
      if (!owned?.id) return {}
      const { data, error } = await client.from('shopping_items').select('name,purchased')
        .eq('list_id', owned.id).is('deleted_at', null)
      if (error) throw error
      return Object.fromEntries((data ?? []).map(item => [item.name, item.purchased]))
    }, { timeout: 30000 }).toEqual({ [nextItem]: purchased, [unmarkedItem]: false })
  }

  // Measure the fixed user-requested delay from the target item's visibility.
  tracePhase('waiting 2500 ms after the target item appears')
  await page.waitForTimeout(2500)
  tracePhase('marking the new item without reloading')
  await marked.click()
  await expect(marked).toBeChecked()
  await expectCloudMarks(true)
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(marked).toBeChecked()
  await expect(unmarked).toBeVisible()
  await expect(unmarked).not.toBeChecked()
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  await expect(archivedCycles).toHaveCount(1)
  await expect(archivedCycles.getByRole('listitem')).toHaveText([archivedEditedItem])

  tracePhase('cancelling partial completion')
  const completeMarked = 'Завершить: отмеченные'
  await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
  await page.getByRole('menu', { name: 'Завершение' }).getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByRole('button', { name: completeMarked, exact: true }).click()
  await expect(marked).toBeChecked()
  await expect(unmarked).toBeVisible()
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  await expect(archivedCycles).toHaveCount(1)

  tracePhase('completing second cycle with marked items only')
  await completeList(completeMarked)
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(marked).toHaveCount(0)
  await expect(unmarked).toHaveCount(0)
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })

  await expect(archivedCycles).toHaveCount(2)
  const firstCycle = archivedCycles.filter({ has: page.getByText(archivedEditedItem, { exact: true }) })
  const secondCycle = archivedCycles.filter({ has: page.getByText(nextItem, { exact: true }) })
  await expect(firstCycle).toHaveCount(1)
  await expect(secondCycle).toHaveCount(1)
  await expect(firstCycle.getByRole('listitem')).toHaveText([archivedEditedItem])
  await expect(secondCycle.getByRole('listitem')).toHaveText([nextItem])
  tracePhase('completing third cycle without purchases')
  const noPurchaseItem = 'E4_NO_PURCHASE_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill(noPurchaseItem)
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  const noPurchase = page.getByRole('checkbox', { name: noPurchaseItem, exact: true })
  await expect(noPurchase).toBeVisible()
  await expect(noPurchase).not.toBeChecked()

  const { data: source, error: sourceError } = await client.from('shopping_lists')
    .select('id').eq('name', name).single()
  expect(sourceError).toBeNull()
  expect(source?.id).toBeTruthy()

  async function readActiveItems() {
    const { data, error } = await client.from('shopping_items').select('name,purchased')
      .eq('list_id', source!.id).is('deleted_at', null)
    if (error) throw error
    return data
  }

  await expect.poll(readActiveItems, { timeout: 30000 })
    .toEqual([{ name: noPurchaseItem, purchased: false }])
  await completeList('Завершить: ничего не куплено')
  await expect.poll(readActiveItems, { timeout: 30000 }).toEqual([])

  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(noPurchase).toHaveCount(0)
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  await expect(archivedCycles).toHaveCount(2)
  await expect(firstCycle.getByRole('listitem')).toHaveText([archivedEditedItem])
  await expect(secondCycle.getByRole('listitem')).toHaveText([nextItem])
  await expect(archive.getByText(noPurchaseItem, { exact: true })).toHaveCount(0)
  const discardedItem = 'E4_DISCARDED_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill(discardedItem)
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  const discarded = page.getByRole('checkbox', { name: discardedItem, exact: true })
  await expect(discarded).toBeVisible()
  await expect.poll(readActiveItems, { timeout: 30000 }).toEqual([{ name: discardedItem, purchased: false }])

  tracePhase('renaming, changing type and reordering cloud list')
  const otherList = 'E4_ORDER_' + crypto.randomUUID()
  await page.getByRole('button', { name: 'Новый список' }).click()
  await page.getByRole('textbox', { name: 'Название списка', exact: true }).fill(otherList)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  const newList = page.getByRole('dialog', { name: 'Создать список' })
  await page.getByRole('button', { name: otherList, exact: true }).waitFor()
  await page.getByRole('button', { name: 'Новый список' }).click()
  await newList.getByLabel('Название списка').fill(' ' + otherList.toLowerCase() + ' ')
  await newList.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(newList.getByRole('alert')).toHaveText('Список с таким названием уже существует.')
  await newList.getByRole('button', { name: 'Отмена' }).click()
  await expect(page.getByRole('button', { name: otherList, exact: true })).toHaveCount(1)
  const renamed = name + '_RENAMED'
  const metadata = page.getByRole('region', { name: 'Проверенные метаданные облачных списков' })
  const metadataRow = (listName: string) => metadata.getByRole('listitem').filter({ hasText: listName + ' —' })
  await page.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
  await page.getByRole('menuitem', { name: /Переименовать/ }).click()
  const renameList = page.getByRole('dialog', { name: 'Переименовать список' })
  await renameList.getByLabel('Название списка').fill(otherList.toLowerCase())
  await renameList.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(renameList.getByRole('alert')).toHaveText('Список с таким названием уже существует.')
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(1)
  await renameList.getByLabel('Название списка').fill(renamed)
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.getByRole('button', { name: renamed, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Разовый', exact: true }).click()
  await page.getByText('Служебные операции облака', { exact: true }).click()
  await expect(metadataRow(otherList)).toBeVisible()
  await expect(metadataRow(renamed)).toBeVisible()
  await expect(metadataRow(renamed).getByRole('button', { name: 'Сделать постоянным' })).toBeVisible()
  // Relative order of our two lists must change even when another CI run
  // has inserted a list in between.
  const metadataRows = metadata.getByRole('listitem')
  const maxMoves = await metadataRows.count()
  for (let moves = 0; moves < maxMoves; moves++) {
    const currentOrder = await metadataRows.allTextContents()
    if (currentOrder.findIndex(text => text.startsWith(otherList + ' —')) <
        currentOrder.findIndex(text => text.startsWith(renamed + ' —'))) break
    const row = metadataRow(renamed)
    const previous = (await row.textContent())?.match(/позиция (\d+) · версия (\d+)/)?.[0]
    expect(previous).toBeTruthy()
    await row.getByRole('button', { name: 'Ниже', exact: true }).click()
    await expect(row).not.toContainText(previous!)
  }

  const targetButtons = page.getByRole('navigation', { name: 'Списки покупок' })
    .getByRole('button', { name: new RegExp('^(' + renamed + '|' + otherList + ')$') })
  await expect(targetButtons.first()).toHaveAccessibleName(otherList)
  await expect(targetButtons.last()).toHaveAccessibleName(renamed)
  await page.reload()
  await expect(targetButtons.first()).toHaveAccessibleName(otherList)
  await expect(targetButtons.last()).toHaveAccessibleName(renamed)
  await page.getByText('Служебные операции облака', { exact: true }).click()
  await expect(metadataRow(renamed).getByRole('button', { name: 'Сделать постоянным' })).toBeVisible()
  await page.getByRole('button', { name: renamed, exact: true }).click()
  await expect(discarded).toBeVisible()
  await expect.poll(readActiveItems, { timeout: 30000 }).toEqual([{ name: discardedItem, purchased: false }])
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  await expect(archivedCycles).toHaveCount(2)
  await expect(firstCycle.getByRole('listitem')).toHaveText([archivedEditedItem])
  await expect(secondCycle.getByRole('listitem')).toHaveText([nextItem])

  tracePhase('deleting cloud list with marked purchases')
  await discarded.click()
  await expect(discarded).toBeChecked()
  await expect.poll(readActiveItems, { timeout: 30000 }).toEqual([{ name: discardedItem, purchased: true }])

  const deletion = page.getByRole('dialog', { name: 'Удалить список?' })
  const warning = deletion.getByText('Отмеченные товары не попадут в историю покупок и будут удалены без записи в архив.', { exact: false })
  const openDeletion = async () => {
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await page.getByRole('menuitem', { name: /Удалить список/ }).click()
  }
  await openDeletion()
  await expect(warning).toBeVisible()
  await expect(deletion.getByRole('button', { name: 'Завершить отмеченные' })).toBeVisible()
  await deletion.getByRole('button', { name: 'Отмена', exact: true }).click()
  await expect(discarded).toBeChecked()
  await openDeletion()
  await deletion.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0, { timeout: 20000 })
  await expect(page.locator('.list-action-notice')).toHaveText('Список удалён.')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible()
  await expect(page.getByRole('button', { name: renamed, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /^Архив,/ }).click()
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText(archivedEditedItem, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Основные списки', exact: true }).click()
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click({ timeout: 30000 })
  await expect(archivedCycles).toHaveCount(2)
  await expect(firstCycle.getByRole('listitem')).toHaveText([archivedEditedItem])
  await expect(secondCycle.getByRole('listitem')).toHaveText([nextItem])
  await expect(archive.getByText(discardedItem, { exact: true })).toHaveCount(0)

  tracePhase('deleting a cloud list without marked purchases')
  const unmarkedListName = 'E4_UNMARKED_LIST_' + crypto.randomUUID()
  await page.getByRole('button', { name: 'Новый список' }).click()
  await page.getByRole('textbox', { name: 'Название списка', exact: true }).fill(unmarkedListName)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await page.getByRole('button', { name: unmarkedListName, exact: true }).click()
  const uncheckedName = 'E4_UNCHECKED_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill(uncheckedName)
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  const unchecked = page.getByRole('checkbox', { name: uncheckedName, exact: true })
  await expect(unchecked).toBeVisible()
  await expect(unchecked).not.toBeChecked()
  await expect.poll(async () => {
    const { data, error } = await client.from('shopping_items').select('purchased').eq('name', uncheckedName).is('deleted_at', null)
    if (error) throw error
    return data
  }, { timeout: 30000 }).toEqual([{ purchased: false }])
  await openDeletion()
  await expect(deletion).toBeVisible()
  await expect(warning).toHaveCount(0)
  await expect(deletion.getByRole('button', { name: 'Завершить отмеченные' })).toHaveCount(0)
  await deletion.getByRole('button', { name: 'Удалить', exact: true }).click()
  await expect(page.getByRole('button', { name: unmarkedListName, exact: true })).toHaveCount(0, { timeout: 20000 })
  await expect(page.locator('.list-action-notice')).toHaveText('Список удалён.')
  await client.auth.signOut({ scope: 'local' })
})
