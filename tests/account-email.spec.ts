import { AUTH_TIMEOUT, UI_TIMEOUT } from './test-timeouts'
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

async function mockCloud(page: Page, duplicate = false, deletion = { removed: false }) {
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
    if (path === '/functions/v1/private-registration') {
      await respond({ result: body.action === 'request' ? 'accepted'
        : body.code === emailCode && !duplicate ? 'created' : 'invalid' })
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
    } else if (path === '/rest/v1/rpc/account_deletion_installation_status') {
      await route.fulfill({ json: deletion.removed && body.p_account === accountId ? 'deleted' : 'active' })
    } else if (path === '/rest/v1/rpc/register_account_deletion_installation' || path === '/rest/v1/rpc/acknowledge_account_deletion_installation') {
      await route.fulfill({ json: true })
    } else if (path === '/rest/v1/rpc/request_account_deletion') {
      await respond({ status: 'requested', id: 'deletion-challenge', expiresAt: '2026-11-23T02:00:00Z' })
    } else if (path === '/rest/v1/rpc/confirm_account_deletion') {
      if (body.p_code !== emailCode) await route.fulfill({ json: 'invalid' })
      else {
        deletion.removed = true
        await route.abort('failed')
      }
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
  expect(calls.some(call => call.path === '/functions/v1/private-registration')).toBe(false)
  await registration.getByLabel('Новый пароль').fill(password)
  await registration.getByLabel('Повторите пароль').fill('different password')
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByRole('alert')).toHaveText('Пароли не совпадают.')
  expect(calls.some(call => call.path === '/functions/v1/private-registration')).toBe(false)
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
    expect(calls.some(call => call.body.action === 'confirm')).toBe(false)
  }
  await registrationCode.fill('999999')
  await registration.getByRole('button', { name: 'Подтвердить код' }).click()
  await expect(registration.getByRole('alert')).toContainText('Код неверный')
  await registration.getByRole('button', { name: 'Запросить новый код' }).click()
  await expect(registration.getByLabel('Код из письма')).toHaveValue('')
  expect(calls.filter(call => call.body.action === 'request').map(call => call.body)).toEqual([
    { action: 'request', email }, { action: 'request', email },
  ])
  await registration.getByLabel('Код из письма').fill(emailCode)
  await registration.getByRole('button', { name: 'Подтвердить код' }).click()
  const signIn = page.getByRole('dialog', { name: 'Вход в аккаунт' })
  await expect(signIn.getByRole('status')).toContainText('Почта подтверждена')
  await expect(signIn.getByLabel('Пароль')).toHaveValue('')
  expect(calls.some(call => call.path.startsWith('/rest/v1/') || call.path.startsWith('/auth/v1/'))).toBe(false)
  expect(calls.filter(call => call.body.action === 'confirm').at(-1)?.body).toEqual({ action: 'confirm', email, password, code: emailCode })

  await signIn.getByLabel('Пароль').fill(password)
  await signIn.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  const account = page.getByRole('button', { name: /Открыть аккаунт/ })
  await expect(account).toBeVisible()
  await account.click()
  await page.getByRole('group', { name: 'Локальные профили' }).getByRole('button', { name: 'Локальный профиль Мои покупки', exact: true }).click()
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
  await expect(registration.getByText('Проверьте почту и введите код подтверждения.')).toBeVisible()
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
  expect(calls.some(call => call.path === '/auth/v1/token' ||
    call.path.startsWith('/rest/v1/'))).toBe(false)
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
  const decline = transfer.getByRole('button', { name: 'Не синхронизировать', exact: true })
  await expect(decline).toBeFocused()
  await expect(decline).toHaveCSS('outline-style', 'none')
  await expect(remember).toHaveCSS('outline-style', 'none')
  await transfer.getByRole('button', { name: 'Синхронизировать профиль', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(remember).toBeFocused()
  await expect(remember).toHaveCSS('outline-style', 'solid')
  await expect(remember).toHaveCSS('outline-color', 'rgb(37, 99, 76)')
  await remember.tap()
  await expect(remember).toHaveCSS('outline-style', 'none')
  await remember.tap()

  await transfer.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(menu).toHaveAttribute('data-profile-mode', 'cloud')
  await menu.click()
  await expect(page.getByRole('button', { name: 'Удалить локальный профиль «Мои покупки»', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: `Удалить локальный профиль «${email}»`, exact: true })).toBeVisible()
  for (let i = 0; i < 2; i++) {
    if (i > 0) await menu.click()
    await page.getByRole('button', { name: 'Добавить профиль', exact: true }).click()
    const nameDialog = page.getByRole('dialog', { name: 'Имя локального профиля' })
    await expect(nameDialog).toBeVisible()
    await nameDialog.getByRole('button', { name: 'Очистить имя профиля' }).click()
    await expect(nameDialog.getByLabel('Имя профиля', { exact: true })).toHaveValue('')
    await nameDialog.getByLabel('Имя профиля', { exact: true }).fill('Новый профиль ' + i)
    await nameDialog.getByRole('button', { name: 'Сохранить имя' }).click()
    await expect(menu).toContainText('Новый профиль ' + i)
    await expect(menu).toHaveAttribute('data-profile-mode', 'local')
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
  // The throttle applies only to a healthy, idle workspace, not startup
  // requests that are still settling. Confirm the archive and sync state
  // before measuring the unchanged zero-extra-requests budget.
  const profileStatus = page.locator('.profile-menu-trigger [data-sync]')
  await page.getByRole('button', { name: /^Архив,/ }).click()
  await expect(page.getByRole('button', { name: 'Показать завершённые покупки', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Основные списки' }).click()
  await expect(profileStatus).toHaveAttribute('data-sync', 'synced')
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

test('deletes the cloud workspace after a lost confirmation response and keeps local purchases', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  await page.getByLabel('Что нужно купить?', { exact: false }).fill('Покупка локального профиля')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Покупка локального профиля' })).toBeVisible()
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  const account = page.getByRole('button', { name: /Открыть аккаунт/ })
  await account.click()
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Удаление облачного аккаунта' })
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  expect(calls.some(call => call.path.endsWith('/request_account_deletion'))).toBe(false)
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  await dialog.getByLabel(/Напомнить мне по почте/).check()
  await dialog.getByRole('button', { name: 'Отправить код' }).click()
  const code = dialog.getByLabel('Код подтверждения')
  await code.fill('222222')
  await dialog.getByRole('button', { name: 'Удалить аккаунт безвозвратно' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Код неверный')
  await code.fill(emailCode)
  await dialog.getByRole('button', { name: 'Удалить аккаунт безвозвратно' }).click()
  await expect(page.getByText('Облачный аккаунт удалён.', { exact: false })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Покупка локального профиля' })).toBeVisible()
  const acknowledgment = () => calls.find(call => call.path.endsWith('/acknowledge_account_deletion_installation'))
  await expect.poll(() => !!acknowledgment()).toBe(true)
  const registration = calls.find(call => call.path.endsWith('/register_account_deletion_installation'))
  expect(acknowledgment()?.body).toEqual(registration?.body)
  expect(calls.find(call => call.path.endsWith('/request_account_deletion'))?.body).toEqual({ p_remind: true })
  await page.reload()
  await expect(account).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: 'Покупка локального профиля' })).toBeVisible()
})

test('recovers an interrupted deleted-account sign-out without reloading Safari', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => { sessionStorage.setItem('test-copied-auth-trace', value) },
    } })
  })
  let signOutRequests = 0
  await page.route(`**${fixturePath}/auth/v1/logout**`, async route => {
    signOutRequests++
    if (signOutRequests === 1) return route.fulfill({ status: 500, json: { code: 'unexpected_failure', msg: 'private@example.test token=secret' } })
    await route.fulfill({ status: 200, json: {} })
  })
  await page.goto('/shopping-app/')
  await page.getByLabel('Что нужно купить?', { exact: false }).fill('Оставить в локальном профиле')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await page.getByRole('button', { name: /Открыть аккаунт/ }).click()
  await page.getByRole('button', { name: 'Удалить аккаунт', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Удаление облачного аккаунта' })
  await dialog.getByRole('button', { name: 'Отправить код' }).click()
  await dialog.getByLabel('Код подтверждения').fill(emailCode)
  await dialog.getByRole('button', { name: 'Удалить аккаунт безвозвратно' }).click()

  const retry = page.getByRole('button', { name: 'Повторить выход', exact: true })
  const localItem = page.getByRole('checkbox', { name: 'Оставить в локальном профиле' })
  await expect(retry).toBeVisible({ timeout: AUTH_TIMEOUT })
  await expect(page.getByRole('alert')).toContainText('Не удалось завершить выход')
  await expect(page.getByRole('button', { name: /Открыть аккаунт/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Скопировать диагностику входа' }).click()
  await expect(page.getByText('Диагностика скопирована без личных данных.')).toBeVisible()
  const exported = await page.evaluate(() => sessionStorage.getItem('test-copied-auth-trace') ?? '')
  const trace = JSON.parse(exported)
  expect(trace.events.filter((event: { stage: string }) => event.stage.startsWith('signout_'))).toEqual(expect.arrayContaining([
    expect.objectContaining({ stage: 'signout_local_requested' }),
    // auth-js 2.119.0 classifies HTTP 500 as retryable and drops the server code.
    expect.objectContaining({ stage: 'signout_sdk_error', code: 'http_500' }),
  ]))
  for (const secret of [email, password, accountId, session.access_token, session.refresh_token,
    'private@example.test', 'token=secret']) expect(exported).not.toContain(secret)
  await retry.click()
  expect(signOutRequests).toBe(2)
  await expect(page.getByText('Облачный аккаунт удалён.', { exact: false })).toBeVisible()
  await expect(localItem).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/confirm_account_deletion'))).toHaveLength(1)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Оставить в локальном профиле' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Открыть аккаунт/ })).toHaveCount(0)
})

test('reports generic Auth 500 as server error without inventing a deletion', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.route(`**${fixturePath}/functions/v1/private-registration`, route =>
    route.fulfill({ status: 500, json: { code: 'unexpected_failure', message: 'Database error saving new user' } }))
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Регистрация аккаунта' })
  await dialog.getByLabel('Email').fill('unrelated@example.test')
  await dialog.getByLabel('Новый пароль').fill(password)
  await dialog.getByLabel('Повторите пароль').fill(password)
  await dialog.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Сервер не смог выполнить регистрацию')
  await expect(dialog.getByRole('alert')).not.toContainText('24 часа')
  await expect(dialog.getByLabel('Код из письма')).toHaveCount(0)
  expect(calls.some(call => call.path.startsWith('/auth/v1/') || call.path.startsWith('/rest/v1/'))).toBe(false)
})

test('recovers a temporary installation registration failure before linking the local profile', async ({ page }) => {
  const calls = await mockCloud(page)
  let attempts = 0
  await page.route(`**${fixturePath}/rest/v1/rpc/register_account_deletion_installation`, route => {
    attempts++
    if (attempts === 1) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } })
    expect(route.request().postDataJSON()).toMatchObject({
      p_account: accountId, p_device: expect.any(String), p_proof: expect.any(String),
    })
    return route.fulfill({ json: true })
  })
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Покупки сохранены')
  await expect(page.getByRole('dialog', { name: 'Синхронизация локального профиля' })).toHaveCount(0)
  const transfer = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  await expect(transfer).toBeVisible({ timeout: AUTH_TIMEOUT })
  await transfer.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(page.locator('.profile-menu-trigger')).toHaveAttribute('data-profile-mode', 'cloud')
  expect(attempts).toBeGreaterThanOrEqual(2)
  expect(calls.filter(call => call.path === '/auth/v1/token')).toHaveLength(1)
})

test('reopens a signed-out linked account on the first restart after offline local edits', async ({ page }) => {
  await mockCloud(page)
  await page.goto('/shopping-app/')
  const profile = page.locator('.profile-menu-trigger')
  await page.getByRole('button', { name: /Войти в аккаунт/ }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
    .getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  await profile.click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'linked')

  // Edit the linked local copy, reload Safari once, then sign in immediately.
  // Before this fix the server could accept credentials while the local
  // controller remained in guest state until a second page restart.
  await page.getByRole('button', { name: 'Новый список', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Создать список' })
  await create.getByLabel('Название списка').fill('Локальный список после выхода')
  await create.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Локальный список после выхода', exact: true })).toBeVisible()
  await page.getByLabel('Что нужно купить?', { exact: false }).fill('Сохранить локально после выхода')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Сохранить локально после выхода' })).toBeVisible()
  await page.reload()
  await expect(profile).toHaveAttribute('data-profile-mode', 'linked')
  await expect(page.getByRole('checkbox', { name: 'Сохранить локально после выхода' })).toBeVisible()
  await profile.click()
  // The linked profile displays its own verified account login and password.
  await expect(page.locator('.account-full-email')).toHaveText(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: AUTH_TIMEOUT })
  await expect(profile).toContainText(email)
  await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toHaveCount(0)
})


test('deletes a separate local profile from the cloud menu without changing the authorized account', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  const profile = page.locator('.profile-menu-trigger')
  await page.getByLabel('Что нужно купить?', { exact: false }).fill('Не переносить активную покупку')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await profile.click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  await profile.click()
  const remove = page.getByRole('button', { name: 'Удалить локальный профиль «Мои покупки»', exact: true })
  await remove.click()
  const dialog = page.getByRole('dialog', { name: 'Удаление профиля' })
  await expect(dialog).toContainText('Все списки и товары')
  await expect(dialog.getByRole('checkbox', { name: 'Сохранить архив' })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Отмена' }).click()
  if (!(await page.locator('#profile-menu').isVisible())) await profile.click()
  await expect(remove).toBeVisible()
  await remove.click()
  await dialog.getByRole('button', { name: 'Удалить профиль', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(remove).toHaveCount(0)
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  await expect(profile).toContainText(email)
  expect(calls.filter(call => call.path === '/auth/v1/logout')).toHaveLength(0)
  await page.reload()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  await profile.click()
  await expect(remove).toHaveCount(0)
  expect(calls.filter(call => call.path === '/auth/v1/logout')).toHaveLength(0)
})


for (const failLogout of [false, true]) test(`removing the authorized local copy requires confirmed logout (failure=${failLogout})`, async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  const profile = page.locator('.profile-menu-trigger')
  await profile.click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  await profile.click()
  const remove = page.getByRole('button', { name: `Удалить локальный профиль «${email}»`, exact: true })
  await expect(remove).toBeEnabled()
  const readProfiles = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('shopping-app')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<{ cloudAccountId: string | null }[]>((resolve, reject) => {
        const request = db.transaction('localProfileRegistry').objectStore('localProfileRegistry').get('device')
        request.onsuccess = () => resolve(request.result.registry.profiles)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
  page.once('dialog', dialog => void dialog.dismiss())
  await remove.click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  expect(calls.filter(call => call.path === '/auth/v1/logout')).toHaveLength(0)
  expect((await readProfiles()).some(row => row.cloudAccountId === accountId)).toBe(true)
  let logoutObserved = false
  await page.route(`**${fixturePath}/auth/v1/logout**`, async route => {
    // Confirm that the local copy still exists when the logout request arrives.
    expect((await readProfiles()).some(row => row.cloudAccountId === accountId)).toBe(true)
    logoutObserved = true
    if (failLogout) await route.fulfill({ status: 400, json: { code: 'unexpected_failure', msg: 'Test logout failure' } })
    else await route.fallback()
  })
  page.once('dialog', dialog => void dialog.accept())
  await remove.click()
  if (failLogout) {
    await expect(page.getByRole('alert')).toContainText('Локальная копия не удалена')
    await expect(page.getByRole('button', { name: 'Повторить выход' })).toBeVisible()
    expect((await readProfiles()).some(row => row.cloudAccountId === accountId)).toBe(true)
  } else {
    await expect(profile).toHaveAttribute('data-profile-mode', 'local')
    await expect(profile).toContainText('Мои покупки')
    expect((await readProfiles()).some(row => row.cloudAccountId === accountId)).toBe(false)
    await page.reload()
    await expect(profile).toHaveAttribute('data-profile-mode', 'local')
    await profile.click()
    await expect(remove).toHaveCount(0)
  }
  expect(logoutObserved).toBe(true)
  expect(calls.filter(call => call.path === '/rest/v1/rpc/request_account_deletion')).toHaveLength(0)
})


test('recovers archive identity failure through common retry and resume without reload', async ({ page }) => {
  const calls = await mockCloud(page)
  await page.goto('/shopping-app/')
  const profile = page.locator('.profile-menu-trigger')
  await profile.click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud')
  const archive = page.getByRole('button', { name: /^Архив,/ })
  await archive.click()
  const load = page.getByRole('button', { name: 'Показать завершённые покупки', exact: true })
  await expect(load).toBeEnabled()
  await expect(profile.locator('[data-sync]')).toHaveAttribute('data-sync', 'synced')
  let fail = true
  await page.route(`**${fixturePath}/auth/v1/user**`, async route => {
    if (fail) await route.abort('failed')
    else await route.fallback()
  })
  // A temporary client-side failure must not be treated as sign-out.
  await load.click()
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText('Аккаунт не подтверждён', { exact: true })).toBeVisible()
  await expect(profile.locator('[data-sync]')).toHaveAttribute('data-sync', 'error')
  fail = false
  const start = calls.length
  await page.getByRole('region', { name: 'Ошибка синхронизации' }).getByRole('button', { name: 'Повторить', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText('Аккаунт не подтверждён', { exact: true })).toHaveCount(0)
  await expect(profile.locator('[data-sync]')).toHaveAttribute('data-sync', 'synced')
  expect(calls.slice(start).some(call => call.path === '/auth/v1/user')).toBe(true)
  expect(calls.slice(start).some(call => call.path === '/rest/v1/e4_archive_completions')).toBe(true)
  await expect(load).toBeVisible()
  // Reproduce another temporary error within the healthy 30s interval;
  // visibility alone must trigger the same recovery, without online/reload.
  fail = true
  await load.click()
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText('Аккаунт не подтверждён', { exact: true })).toBeVisible()
  fail = false
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText('Аккаунт не подтверждён', { exact: true })).toHaveCount(0)
  await expect(profile.locator('[data-sync]')).toHaveAttribute('data-sync', 'synced')
  await expect(load).toBeVisible()
  expect(calls.filter(call => call.path === '/auth/v1/logout')).toHaveLength(0)
})
