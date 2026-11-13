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
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible()

  // Required E4 account capability. Do not fabricate a default-list substitution.
  await expect(page.getByRole('button', { name: 'Новый список' }),
    'E4 oneoff creation is absent in authenticated mode').toBeVisible()
  tracePhase('creating oneoff')
  await page.getByRole('button', { name: 'Новый список' }).click()
  await page.getByLabel('Название списка').fill(name)
  await page.locator('#new-list-kind').selectOption('oneoff')
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('button', { name })).toBeVisible()
  // Creation does not implicitly change the active shopping workspace list.
  // Explicitly select the newly created, verified and bound account list.
  tracePhase('selecting oneoff')
  await page.getByRole('button', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  // Exercise the actual account item queue and completion protocol, not just
  // creation of a button. Use a unique disposable list in the isolated lab.
  tracePhase('adding item')
  const secondItem = 'E4_SECOND_' + crypto.randomUUID()
  await page.getByLabel('Что нужно купить?').fill('E4_TEST_ITEM_' + crypto.randomUUID() + '\n' + secondItem + ' 2 л')
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
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('button', { name: 'Завершить: всё куплено' }).click()
  // Fail with the application's actual completion reason rather than a generic
  // timeout. The server receipt remains mandatory for this acceptance.
  await expect.poll(async () => {
    const messages = await page.locator('[role="status"]').allTextContents()
    const completion = messages.find(message => /Список завершён\.|Не удалось завершить:/.test(message))
    return completion ?? ''
  }, { timeout: 20000 }).toMatch(/Список завершён\.|Не удалось завершить:/)
  const completionMessages = await page.locator('[role="status"]').allTextContents()
  const completionMessage = completionMessages.find(message => /Список завершён\.|Не удалось завершить:/.test(message)) ?? ''
  expect(completionMessage, 'Actual completion result: ' + completionMessage).toMatch(/Список завершён\. Сервер подтвердил операцию/)
  await expect(page.getByRole('button', { name }),
    'Completed one-off must disappear from active lists').toHaveCount(0)
  await page.getByRole('button', { name: /^Архив,/ }).click()
  const e4Archive = page.getByRole('region', { name: 'Архив покупок' })
  await expect(e4Archive.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(e4Archive.getByText(secondItem + ' — 2 л')).toBeVisible()
  // Acceptance must survive a fresh application boot, not only React state.
  tracePhase('reloading app')
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Списки покупок' })).toBeVisible()
  await expect(page.getByRole('button', { name, exact: true }),
    'Completed one-off reappeared after reload').toHaveCount(0)
  tracePhase('reopening archive')
  await page.getByRole('button', { name: 'Показать завершённые покупки' }).click()
  await expect(page.getByText(name).last(),
    'Completed one-off archive must persist after reload').toBeVisible()
  await client.auth.signOut()
})
