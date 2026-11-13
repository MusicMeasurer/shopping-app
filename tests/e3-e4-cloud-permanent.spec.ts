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

test('account E3/E4: permanent list archives all or only marked purchases in separate cycles', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()

  // Required E4 account capability. Do not fabricate a default-list substitution.
  await expect(page.getByRole('button', { name: 'Добавить список' }),
    'E4 list creation is absent in authenticated mode').toBeVisible()
  tracePhase('creating permanent list')
  await page.getByRole('button', { name: 'Добавить список' }).click()
  await page.getByLabel('Название списка').fill(name)
  await page.locator('#new-list-kind').selectOption('permanent')
  await page.getByRole('button', { name: 'Создать список' }).click()
  await expect(page.getByRole('button', { name })).toBeVisible()
  // Creation does not implicitly change the active shopping workspace list.
  // Explicitly select the newly created, verified and bound account list.
  tracePhase('selecting permanent list')
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  // Exercise the actual account item queue and completion protocol, not just
  // creation of a button. Use a unique disposable list in the isolated lab.
  tracePhase('adding item')
  const firstItem = 'E4_FIRST_CYCLE_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill(firstItem)
  // A blocked pointer must fail quickly instead of consuming the entire mobile run.
  // Capture real hit-testing geometry before tapping; CSS stacking guesses are
  // insufficient when an overflowing grid physically covers the form.
  console.log('[E4 mobile hit-test]', JSON.stringify(await page.evaluate(() => {
    const selectors = ['nav.lists-grid', 'section[aria-labelledby="list-title"]', '.input-row', 'button[aria-label="Добавить товар"]']
    return selectors.map(selector => {
      const element = document.querySelector(selector)
      if (!element) return { selector, missing: true }
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
      const top = document.elementFromPoint(x, y)
      return { selector, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        position: style.position, zIndex: style.zIndex, overflow: style.overflow,
        hit: top?.outerHTML.slice(0, 240), viewport: { width: innerWidth, height: innerHeight } }
    })
  })))
  // Mobile Chromium retains a focused input and changes its visual viewport;
  // dismiss the virtual keyboard before a genuine pointer click (never force).
  await page.getByLabel('Что нужно купить?').blur()
  await page.getByRole('button', { name: 'Добавить товар' }).click({ timeout: 12000 })
  await expect(page.getByRole('button', { name: 'Завершить: всё куплено' })).toBeVisible()
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
  async function completeList(buttonName: string) {
    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: buttonName, exact: true }).click()
    // Fail with the application's actual completion reason rather than a generic
    // timeout. The server receipt remains mandatory for this acceptance.
    const result = page.getByRole('region', { name: 'Облачный архив' }).getByRole('status').filter({ hasText: /^(Список завершён\.|Не удалось завершить:)/ })
    await expect(result).toBeVisible({ timeout: 20000 })
    await expect(result).toHaveText(/^Список завершён\. Сервер подтвердил операцию/)
  }

  tracePhase('completing first cycle')
  await completeList('Завершить: всё куплено')
  // A permanent list survives completion, but its completed purchase is archived.
  await expect(page.getByRole('button', { name, exact: true }),
    'Permanent list must remain active after completion').toBeVisible()
  await page.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  const archive = page.getByRole('region', { name: 'Облачный архив' })
  const archivedCycles = archive.getByRole('status').locator(':scope > ul > li').filter({
    has: page.locator('strong').filter({ hasText: name }),
  })
  await expect(archivedCycles).toHaveCount(1)
  await expect(archivedCycles.getByText(firstItem, { exact: true })).toBeVisible()
  tracePhase('reloading permanent list')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Облачные списки' })).toBeVisible()
  await expect(page.getByRole('button', { name, exact: true }),
    'Permanent list disappeared after reload').toBeVisible()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  // A completed permanent list must be reusable for a fresh shopping cycle.
  const nextItem = 'E4_SECOND_CYCLE_' + crypto.randomUUID()
  const unmarkedItem = 'E4_UNMARKED_' + crypto.randomUUID()
  for (const item of [nextItem, unmarkedItem]) {
    await page.getByLabel('Что нужно купить?').fill(item)
    await page.getByLabel('Что нужно купить?').press('Enter')
    await expect(page.getByRole('checkbox', { name: item, exact: true })).toBeVisible()
  }
  const marked = page.getByRole('checkbox', { name: nextItem, exact: true })
  const unmarked = page.getByRole('checkbox', { name: unmarkedItem, exact: true })
  // The controlled checkbox updates after the asynchronous local write.
  await marked.click()
  await expect(marked).toBeChecked()
  await expect.poll(async () => {
    const { data: owned } = await client.from('shopping_lists').select('id').eq('name', name).single()
    if (!owned?.id) return {}
    const { data, error } = await client.from('shopping_items').select('name,purchased')
      .eq('list_id', owned.id).is('deleted_at', null)
    if (error) throw error
    return Object.fromEntries((data ?? []).map(item => [item.name, item.purchased]))
  }, { timeout: 30000 }).toEqual({ [nextItem]: true, [unmarkedItem]: false })
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(marked).toBeChecked()
  await expect(unmarked).toBeVisible()
  await expect(unmarked).not.toBeChecked()
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  await expect(archivedCycles).toHaveCount(1)
  await expect(archivedCycles.getByRole('listitem')).toHaveText([firstItem])

  tracePhase('cancelling partial completion')
  const completeMarked = 'Завершить: отмеченные'
  page.once('dialog', dialog => void dialog.dismiss())
  await page.getByRole('button', { name: completeMarked, exact: true }).click()
  await expect(marked).toBeChecked()
  await expect(unmarked).toBeVisible()
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  await expect(archivedCycles).toHaveCount(1)

  tracePhase('completing second cycle with marked items only')
  await completeList(completeMarked)
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(marked).toHaveCount(0)
  await expect(unmarked).toHaveCount(0)
  await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click()

  await expect(archivedCycles).toHaveCount(2)
  const firstCycle = archivedCycles.filter({ has: page.getByText(firstItem, { exact: true }) })
  const secondCycle = archivedCycles.filter({ has: page.getByText(nextItem, { exact: true }) })
  await expect(firstCycle).toHaveCount(1)
  await expect(secondCycle).toHaveCount(1)
  await expect(firstCycle.getByRole('listitem')).toHaveText([firstItem])
  await expect(secondCycle.getByRole('listitem')).toHaveText([nextItem])
  await client.auth.signOut()
})
