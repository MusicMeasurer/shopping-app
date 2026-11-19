import { expect, test, type Page } from '@playwright/test'

const project = 'account-email-test.supabase.co'
const email = 'registration@example.test'
const password = 'a long test password'
const accountId = '1fc6fe3b-1eab-456c-939f-3e2f0da33528'
const user = { id: accountId, email, aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-19T00:00:00Z' }
const token = (body: object) => Buffer.from(JSON.stringify(body)).toString('base64url')
const session = { access_token: token({ alg: 'HS256', typ: 'JWT' }) + '.' +
    token({ sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.test',
  refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user }

async function mockCloud(page: Page, duplicate = false) {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = []
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.hostname === project) console.log(request.method(), url.pathname, request.failure()?.errorText)
  })
  await page.route(`https://${project}/**`, async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    if (method === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
        'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version' } })
      return
    }
    const body = request.postDataJSON() ?? {}
    calls.push({ method, path, body })
    const respond = (json: object, status = 200) => route.fulfill({
      status, json, headers: { 'access-control-allow-origin': '*',
      'access-control-expose-headers': 'x-supabase-api-version', 'x-supabase-api-version': '2024-01-01' },
    })
    if (path === '/auth/v1/signup') {
      await (duplicate ? respond({ code: 'user_already_exists', msg: 'User already registered' }, 422) : respond(user))
    } else if (path === '/auth/v1/verify') {
      await (body.token === '123456' ? respond(session) : respond({ code: 'otp_expired', msg: 'Invalid code' }, 403))
    } else if (path === '/auth/v1/token') {
      await respond(session)
    } else if (path === '/auth/v1/user') {
      await respond(user)
    } else if (path === '/auth/v1/recover' || path === '/auth/v1/resend' || path === '/auth/v1/logout') {
      await respond({})
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
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
  const registration = page.getByRole('dialog', { name: 'Регистрация аккаунта' })
  await registration.getByLabel('Email').fill(email)
  await registration.getByLabel('Новый пароль').fill(password)
  await registration.getByLabel('Повторите пароль').fill('different password')
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByRole('alert')).toHaveText('Пароли не совпадают.')
  expect(calls.some(call => call.path === '/auth/v1/signup')).toBe(false)
  await registration.getByLabel('Повторите пароль').fill(password)
  await registration.getByRole('button', { name: 'Зарегистрироваться' }).click()
  await expect(registration.getByLabel('Код из письма'),
    'Signup should enter the code screen without an Auth error').toBeVisible()
  await registration.getByLabel('Код из письма').fill('999999')
  await registration.getByRole('button', { name: 'Подтвердить код' }).click()
  await expect(registration.getByRole('alert')).toContainText('Код неверный')
  await registration.getByRole('button', { name: 'Запросить новый код' }).click()
  await expect(registration.getByLabel('Код из письма')).toHaveValue('')
  expect(calls.find(call => call.path === '/auth/v1/resend')?.body).toMatchObject({ email, type: 'signup' })
  await registration.getByLabel('Код из письма').fill('123456')
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
  await page.getByRole('button', { name: 'Создать аккаунт' }).click()
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
  await recovery.getByLabel('Код из письма').fill('123456')
  await recovery.getByRole('button', { name: 'Подтвердить код' }).click()
  await recovery.getByLabel('Новый пароль').fill(password)
  await recovery.getByLabel('Повторите пароль').fill(password)
  await recovery.getByRole('button', { name: 'Сохранить пароль' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Пароль обновлён' })).toBeVisible()
  expect(calls.find(call => call.path === '/auth/v1/verify')?.body.type).toBe('recovery')
  expect(calls.find(call => call.path === '/auth/v1/user' && call.method === 'PUT')?.body.password).toBe(password)
  expect(calls.some(call => call.path === '/auth/v1/token' || call.path.startsWith('/rest/v1/'))).toBe(false)
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('auth-token')))).toBe(false)
})
