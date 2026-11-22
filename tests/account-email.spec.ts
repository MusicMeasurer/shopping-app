import { expect, test, type Page } from '@playwright/test'

const project = 'account-email-test.supabase.co'
const fixturePath = '/__account-email-fixture'
test.use({ serviceWorkers: 'block' })
const email = 'registration@example.test'
const password = 'Test8765'
const emailCode = '012345'
const accountId = '1fc6fe3b-1eab-456c-939f-3e2f0da33528'
const user = { id: accountId, email, aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-19T00:00:00Z' }
const token = (body: object) => Buffer.from(JSON.stringify(body)).toString('base64url')
const session = { access_token: token({ alg: 'HS256', typ: 'JWT' }) + '.' +
    token({ sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user }

async function mockCloud(page: Page, duplicate = false) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
  // Route fake Auth calls to a local endpoint before the browser does DNS.
  // WebKit can resolve a cross-origin hostname before Playwright intercepts it.
  await page.addInitScript(({ project, fixturePath }) => {
    const fetchFromBrowser = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
      if (url.hostname !== project) return fetchFromBrowser(input, init)
      const localUrl = window.location.origin + fixturePath + url.pathname + url.search
      return fetchFromBrowser(input instanceof Request ? new Request(localUrl, input) : localUrl, init)
    }
  }, { project, fixturePath })
  await page.route(`**${fixturePath}/**`, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.slice(fixturePath.length)
    const method = request.method()
    const body = request.postDataJSON() ?? {}
    calls.push({ method, path, body })
    const respond = (json: object, status = 200) => route.fulfill({
      status, json, headers: { 'x-supabase-api-version': '2024-01-01' },
    })
    if (path === '/auth/v1/signup') {
      await (duplicate ? respond({ code: 'user_already_exists', msg: 'User already registered' }, 422) : respond(user))
    } else if (path === '/auth/v1/verify') {
      await (body.token === emailCode ? respond(session) : respond({ code: 'otp_expired', msg: 'Invalid code' }, 403))
    } else if (path === '/auth/v1/token') {
      if (body.password === 'invalid-password') {
        await respond({ code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400)
      } else if (body.password === 'simulate-network-error') {
        await route.abort('failed')
      } else {
        await respond(session)
      }
    } else if (path === '/auth/v1/user') {
      await respond(user)
    } else if (path === '/auth/v1/recover' || path === '/auth/v1/resend' || path === '/auth/v1/logout') {
      await respond({})
    } else if (path === '/rest/v1/rpc/snapshot_e4_account_changes') {
      await respond({ code: 'PGRST202', message: 'Function not found' }, 404)
    } else if (path.startsWith('/rest/v1/')) {
      await respond([])
    } else {
      await respond({}, 404)
    }
  })
  return calls
}

test('confirms a new email code, then the first explicit sign-in keeps the local profile on refusal', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  await page.getByLabel('Что нужно купить?', { exact: false }).fill('Локальный чай')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Локальный чай' })).toBeVisible()
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  const registration = page.getByRole('dialog', { name: 'Регистрация аккаунта' })
  await registration.getByLabel('Email').fill(email)
  const tooShort = password.slice(0, 7)
  await registration.getByLabel('Новый пароль').pressSequentially(tooShort)
  await registration.getByLabel('Повторите пароль').fill(tooShort)
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByText('Не менее 8 символов.')).toBeVisible()
  expect(calls.some(call => call.path === '/auth/v1/signup')).toBe(false)
  await registration.getByLabel('Новый пароль').fill(password)
  await registration.getByLabel('Повторите пароль').fill('different password')
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByRole('alert')).toHaveText('Пароли не совпадают.')
  expect(calls.some(call => call.path === '/auth/v1/signup')).toBe(false)
  await registration.getByLabel('Повторите пароль').fill(password)
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByLabel('Код из письма'),
    'Signup should enter the code screen without an Auth error').toBeVisible()
  const registrationCode = registration.getByLabel('Код из письма')
  const confirmRegistration = registration.getByRole('button', { name: 'Подтвердить код' })
  for (const invalid of ['12345', '01234567', 'a12345']) {
    await registrationCode.fill(invalid)
    await confirmRegistration.click()
    await expect(registration.getByRole('alert')).toHaveText('Введите код из 6 цифр.')
    expect(calls.some(call => call.path === '/auth/v1/verify')).toBe(false)
  }
  await registrationCode.fill('999999')
  await registration.getByRole('button', { name: 'Подтвердить код' }).click()
  await expect(registration.getByRole('alert')).toContainText('Код неверный')
  await registration.getByRole('button', { name: 'Запросить новый код' }).click()
  await expect(registration.getByLabel('Код из письма')).toHaveValue('')
  expect(calls.find(call => call.path === '/auth/v1/resend')?.body).toMatchObject({ email, type: 'signup' })
  await registration.getByLabel('Код из письма').fill(emailCode)
  await registration.getByRole('button', { name: 'Подтвердить код' }).click()
  const signIn = page.getByRole('dialog', { name: 'Вход в аккаунт' })
  await expect(signIn.getByRole('status')).toContainText('Почта подтверждена')
  await expect(signIn.getByLabel('Пароль')).toHaveValue('')
  expect(calls.some(call => call.path.startsWith('/rest/v1/'))).toBe(false)
  expect(calls.find(call => call.path === '/auth/v1/verify')?.body.type).toBe('email')

  await signIn.getByLabel('Пароль').fill(password)
  await signIn.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  const account = page.getByRole('button', { name: /Открыть аккаунт/ })
  await expect(account).toBeVisible()
  await account.click()
  await page.getByRole('group', { name: 'Локальные профили' }).getByRole('button', { name: /Мои покупки/ }).click()
  await expect(page.getByRole('checkbox', { name: 'Локальный чай' })).toBeVisible()
})

test('duplicate registration stays generic and recovery resets the password without opening the workspace', async ({ page }) => {
  const calls = await mockCloud(page, true)
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click()
  const registration = page.getByRole('dialog', { name: 'Регистрация аккаунта' })
  await registration.getByLabel('Email').fill(email)
  await registration.getByLabel('Новый пароль').fill(password)
  await registration.getByLabel('Повторите пароль').fill(password)
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByLabel('Код из письма')).toBeVisible()
  await expect(registration.getByRole('alert')).toHaveCount(0)
  await registration.getByRole('button', { name: 'Вернуться ко входу' }).click()
  await page.getByRole('button', { name: 'Забыли пароль?' }).click()
  const recovery = page.getByRole('dialog', { name: 'Восстановление доступа' })
  await recovery.getByLabel('Email').fill(email)
  await recovery.getByRole('button', { name: 'Запросить код', exact: true }).click()
  await expect(recovery.getByLabel('Новый пароль')).toHaveCount(0)
  const recoveryCode = recovery.getByLabel('Код из письма')
  const confirmRecovery = recovery.getByRole('button', { name: 'Подтвердить код' })
  await recoveryCode.fill('01234567')
  await confirmRecovery.click()
  await expect(recovery.getByRole('alert')).toHaveText('Введите код из 6 цифр.')
  expect(calls.some(call => call.path === '/auth/v1/verify')).toBe(false)
  await recoveryCode.fill(emailCode)
  await confirmRecovery.click()
  await recovery.getByLabel('Новый пароль').fill(password)
  await recovery.getByLabel('Повторите пароль').fill(password)
  await recovery.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Пароль обновлён' })).toBeVisible()
  expect(calls.find(call => call.path === '/auth/v1/verify')?.body).toMatchObject({ type: 'recovery', token: emailCode })
  expect(calls.find(call => call.path === '/auth/v1/user' && call.method === 'PUT')?.body.password).toBe(password)
  expect(calls.some(call => call.path === '/auth/v1/token' || call.path.startsWith('/rest/v1/'))).toBe(false)
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('auth-token')))).toBe(false)
})

test('shows wrong credentials and connectivity errors in the sign-in form and allows retry', async ({ page }) => {
  await mockCloud(page)
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  const panel = page.getByRole('dialog', { name: 'Вход в аккаунт' })
  const form = panel.locator('form')
  await form.getByLabel('Email').fill(email)
  const submit = form.getByRole('button', { name: 'Войти', exact: true })
  await form.getByLabel('Пароль').fill('invalid-password')
  await submit.click()
  await expect(form.getByRole('alert')).toHaveText('Неверный email или пароль.')
  await form.getByLabel('Пароль').fill('simulate-network-error')
  await submit.click()
  await expect(form.getByRole('alert')).toHaveText('Не удалось подключиться. Проверьте интернет и повторите вход.')
  await form.getByLabel('Пароль').fill(password)
  await submit.click()
  const transfer = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  await transfer.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(page.locator('.profile-menu-trigger')).toHaveAttribute('data-profile-mode', 'cloud')
})

test('reopens the signed-in account by its profile row with several empty local profiles', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  const menu = page.locator('.profile-menu-trigger')
  const row = (name: string) => page.locator('.profile-option > button:first-child').filter({ hasText: name })
  await menu.click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  const transfer = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  const remember = transfer.getByRole('checkbox', { name: /Больше не спрашивать/ })
  await transfer.getByRole('button', { name: 'Синхронизировать профиль', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(remember).toBeFocused()
  await expect(remember).toHaveCSS('outline-style', 'solid')
  await remember.tap()
  await expect(remember).toHaveCSS('outline-style', 'none')
  await remember.tap()

  await transfer.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  await menu.click()
  await expect(page.getByRole('button', { name: /Удалить локальный профиль/ })).toHaveCount(0)
  await row('Мои покупки').click()
  for (let i = 0; i < 2; i++) {
    await expect(menu).toHaveAttribute('data-profile-mode', 'local')
    await menu.click()
    await page.getByRole('button', { name: 'Добавить профиль', exact: true }).click()
    const nameDialog = page.getByRole('dialog', { name: 'Имя локального профиля' })
    await expect(nameDialog).toBeVisible()
    await nameDialog.getByRole('button', { name: 'Очистить имя профиля' }).click()
    await expect(nameDialog.getByLabel('Имя профиля', { exact: true })).toHaveValue('')
    await nameDialog.getByLabel('Имя профиля', { exact: true }).fill('Новый профиль ' + i)
    await nameDialog.getByRole('button', { name: 'Сохранить имя' }).click()
    await expect(menu).toContainText('Новый профиль ' + i)
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
  }
  await menu.click()
  await page.getByRole('button', { name: 'Ещё', exact: true }).click()
  await expect(page.getByRole('button', { name: 'В облако', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Вернуться в облачный профиль/ })).toHaveCount(0)
  let profileCalls = 0
  await page.route(`**${fixturePath}/rest/v1/rpc/snapshot_e4_account_changes`, async route => {
    if (++profileCalls <= 2) return route.fulfill({ status: 400, json: { code: 'TEST_FAILURE' } })
    await route.fallback()
  })
  await row(email).click()
  await expect(page.getByRole('alert')).toContainText('Не удалось безопасно открыть')
  await page.getByRole('button', { name: 'Повторить открытие' }).click()
  await expect.poll(() => profileCalls).toBe(2)
  await expect(page.getByRole('alert')).toContainText('Не удалось безопасно открыть')
  await page.getByRole('button', { name: 'Вернуться к локальным профилям' }).click()
  await expect(menu).toContainText('Новый профиль 1')
  await menu.click()
  await expect(page.getByRole('button', { name: 'Зарегистрироваться', exact: true })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill('invalid-password')
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Неверный email или пароль.')
  expect(calls.filter(call => call.path === '/auth/v1/logout')).toHaveLength(0)
  await page.getByRole('button', { name: 'Ещё', exact: true }).click()
  await row(email).click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  await expect(transfer).toHaveCount(0)
  await page.reload()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  await menu.click()
  await row('Новый профиль 1').click()
  await expect(menu).toContainText('Новый профиль 1')
  expect(calls.filter(call => call.path === '/auth/v1/token' || call.path === '/auth/v1/logout')).toHaveLength(2)
})

test('signs into a saved cloud profile using only its password', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  const menu = page.locator('.profile-menu-trigger')
  const panel = page.getByRole('dialog', { name: 'Вход в аккаунт' })
  await menu.click()
  await panel.getByLabel('Email').fill(email)
  await panel.getByLabel('Пароль').fill(password)
  await panel.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  await menu.click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'linked')
  await page.reload()
  await expect(menu).toHaveAttribute('data-profile-mode', 'linked')
  await menu.click()
  await expect(panel.getByLabel('Email', { exact: true })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Зарегистрироваться', exact: true })).toHaveCount(0)
  const signIn = panel.getByRole('button', { name: 'Войти', exact: true })
  const recover = panel.getByRole('button', { name: 'Забыли пароль?', exact: true })
  await expect(recover).toBeVisible()
  expect((await signIn.boundingBox())?.y).toBe((await recover.boundingBox())?.y)
  await expect(signIn).toHaveCSS('background-color', 'rgb(37, 99, 76)')
  await panel.getByLabel('Пароль').fill('invalid-password')
  await signIn.click()
  await expect(panel.getByRole('alert')).toHaveText('Неверный email или пароль.')
  await expect(panel.getByRole('alert')).toHaveCSS('color', 'rgb(156, 34, 34)')
  await panel.getByLabel('Пароль').fill(password)
  await signIn.click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  expect(calls.filter(call => call.path === '/auth/v1/token').map(call => call.body.email)).toEqual([email, email, email])
})

test('syncs once after reconnect and merges with a verified session after ten quick returns', async ({ page }) => {
  const calls = await mockCloud(page)
  const listId = '40000000-0000-4000-8000-000000000001'
  const targetId = '40000000-0000-4000-8000-000000000002'
  const itemId = '50000000-0000-4000-8000-000000000001'
  const movedId = '50000000-0000-4000-8000-000000000002'
  const row = { id: itemId, list_id: listId, name: 'Молоко', purchased: false, version: 1, created_at: '2026-11-22T00:00:00Z' }
  const source = { id: listId, owner_id: accountId, name: 'Продукты', kind: 'permanent', position: 0, revision: 1 }
  const target = { ...source, id: targetId, name: 'Покупки на завтра', position: 1 }
  const snapshot = { position: '1', lists: [source, target], items: [row] }
  let pulls = 0
  let changed = false
  let merged = false
  await page.route(`**${fixturePath}/rest/v1/rpc/*list*`, async route => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON()
    if (path.endsWith('/preview_e4_list_merge'))
      return route.fulfill({ json: { source, target, items: [{ ...row, purchased: true }] } })
    if (!path.endsWith('/merge_e4_personal_lists')) return route.fallback()
    expect(body).toMatchObject({ p_source: listId, p_target: targetId, p_items: [{ name: 'Молоко', purchased: true }] })
    merged = true
    await route.fulfill({ json: { operation_id: body.p_operation, source_id: listId, target_id: targetId } })
  })
  await page.route(`**${fixturePath}/rest/v1/rpc/*account_changes`, async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/snapshot_e4_account_changes')) return route.fulfill({ json: snapshot })
    if (!path.endsWith('/pull_e4_account_changes')) return route.fallback()
    pulls++
    const cursor = route.request().postDataJSON().p_after
    if (merged && cursor === '2') return route.fulfill({ json: [
      { event_position: '3', entity: 'list', list_id: listId, entity_id: listId, deleted: true, snapshot: null },
      { event_position: '4', entity: 'item', list_id: targetId, entity_id: movedId, deleted: false,
        snapshot: { ...row, id: movedId, list_id: targetId, purchased: true } },
    ] })
    await route.fulfill({ json: changed && cursor === '1' ? [
      { event_position: '2', entity: 'item', list_id: listId, entity_id: itemId, deleted: false,
        snapshot: { ...row, purchased: true, version: 2 } },
    ] : [] })
  })
  await page.clock.install()
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Вход в аккаунт' })
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Пароль').fill(password)
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click()
  const decline = page.getByRole('button', { name: 'Не синхронизировать', exact: true })
  const accountButton = page.getByRole('button', { name: 'Открыть аккаунт' })
  await expect(decline.or(accountButton)).toBeVisible()
  if (await decline.isVisible()) await decline.click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeVisible()
  await expect.poll(() => pulls).toBeGreaterThan(0)
  await page.clock.runFor(400)
  const before = pulls
  const authBefore = calls.filter(call => call.path === '/auth/v1/user').length
  for (let index = 0; index < 10; index++) {
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await page.clock.runFor(25)
  }
  await page.clock.runFor(300)
  expect(pulls).toBe(before)
  expect(calls.filter(call => call.path === '/auth/v1/user')).toHaveLength(authBefore)
  await page.context().setOffline(true)
  changed = true
  await page.context().setOffline(false)
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeChecked()
  expect(pulls).toBe(before + 1)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Объединить со списком', exact: true }).click()
  const merge = page.getByRole('dialog', { name: 'Объединить списки' })
  await merge.getByRole('button', { name: target.name, exact: true }).click()
  await expect(merge.getByText(/исчезнет из активных списков/)).toBeVisible()
  await merge.getByRole('button', { name: 'Объединить', exact: true }).click()
  await expect(merge).toBeHidden()
  await expect(page.getByRole('button', { name: source.name, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: target.name, exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeChecked()
  expect(calls.some(call => call.path === '/rest/v1/shopping_items')).toBe(false)
})
