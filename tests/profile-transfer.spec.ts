import { test, expect, type Page } from '@playwright/test'

// Keep RPC fault injection observable; PWA offline/restart is covered separately.
// Requests forwarded by a service worker bypass page.route.
test.use({ actionTimeout: 15000, serviceWorkers: 'block' })

const email = process.env.E3_USER_A_EMAIL!
const password = process.env.E3_USER_A_PASSWORD!
async function openSettings(page: Page) { await page.getByRole('button', { name: 'Настройки', exact: true }).click() }
async function closeSettings(page: Page) { await page.getByRole('dialog', { name: 'Настройки приложения' }).getByRole('button', { name: 'Закрыть', exact: true }).click() }
async function login(page: Page) {
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Пароль', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
}
async function logout(page: Page) {
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  await page.getByRole('button', { name: 'Выйти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible({ timeout: 30000 })
}
async function createList(page: Page, name: string) {
  await page.getByRole('button', { name: 'Новый список', exact: true }).click()
  await page.getByLabel('Название списка', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Создать', exact: true }).click()
  await page.getByRole('button', { name, exact: true }).click()
}
async function add(page: Page, name: string) {
  await page.getByLabel('Что нужно купить?', { exact: false }).fill(name)
  await page.getByLabel('Что нужно купить?', { exact: false }).blur()
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible()
}
for (const mode of ['separate', 'merge'] as const) test(`explicit profile ${mode}: consent, collision, interrupted receipt, archive and source removal`, async ({ page }) => {
  test.setTimeout(180000)
  if (process.env.VITE_SUPABASE_URL !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !email || !password) throw new Error('Disposable lab only')
  const name = 'TRANSFER_' + crypto.randomUUID()
  const guestName = 'Личные_' + crypto.randomUUID()
  const localItem = 'Локальное молоко_' + crypto.randomUUID()
  const cloudItem = 'Облачный хлеб_' + crypto.randomUUID()
  const archivedItem = 'Архив_' + crypto.randomUUID()
  console.log('[transfer]', mode, 'rename independent profile')
  await page.goto('/shopping-app/')
  await openSettings(page)
  await page.getByRole('button', { name: 'Изменить имя профиля' }).click()
  const rename = page.getByRole('dialog', { name: 'Имя локального профиля', exact: true })
  await rename.getByLabel('Имя профиля', { exact: true }).fill(guestName)
  await rename.getByRole('button', { name: 'Сохранить имя' }).click()
  await expect(page.getByLabel('Локальный профиль', { exact: true }).locator('option:checked')).toHaveText(guestName)
  await closeSettings(page)
  await page.reload()
  await openSettings(page)
  await expect(page.getByLabel('Локальный профиль', { exact: true }).locator('option:checked')).toHaveText(guestName)
  await closeSettings(page)
  console.log('[transfer]', mode, 'decline first transfer')
  await login(page)
  await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: 30000 })
  console.log('[transfer]', mode, 'prepare cloud collision')
  await createList(page, name)
  await add(page, cloudItem)
  // Wait for actual receipt, not just optimistic UI.
  await expect.poll(async () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('shopping-app'); r.onsuccess = () => resolve(r.result) })
    const count = await new Promise<number>(resolve => { const r = db.transaction('accountOperations').objectStore('accountOperations').count(); r.onsuccess = () => resolve(r.result) })
    db.close(); return count
  }), { timeout: 30000 }).toBe(0)
  if (mode === 'separate') await createList(page, name + ' (2)')
  console.log('[transfer]', mode, 'inspect local login name')
  await logout(page)
  await openSettings(page)
  await expect(page.getByLabel('Локальный профиль', { exact: true }).locator('option:checked')).toHaveText(email)
  await expect(page.getByRole('button', { name: 'Изменить имя профиля' })).toHaveCount(0)
  await page.getByLabel('Локальный профиль', { exact: true }).selectOption({ label: guestName })
  // Switching profile remounts the workspace and closes Settings.
  await expect(page.getByRole('button', { name: 'Новый список', exact: true })).toBeEnabled()
  console.log('[transfer]', mode, 'prepare guest archive and items')
  await createList(page, name)
  await add(page, archivedItem)
  await page.getByRole('checkbox', { name: archivedItem, exact: true }).click()
  await expect(page.getByRole('checkbox', { name: archivedItem, exact: true })).toBeChecked()
  await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить: отмеченные', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: archivedItem, exact: true })).toHaveCount(0)
  await add(page, localItem)
  let interrupted = false
  await page.route('**/rest/v1/rpc/import_e4_profile_merge', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    if (!interrupted) { const response = await route.fetch(); console.log('[transfer rpc]', mode, response.status()); expect(response.ok()).toBe(true); interrupted = true; await route.abort('failed') }
    else await route.continue()
  })
  console.log('[transfer]', mode, 'consent and collision choice')
  await login(page)
  const consent = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  await expect(consent).toContainText('исходный локальный профиль удалён после успешного переноса')
  await consent.getByRole('button', { name: 'Синхронизировать профиль', exact: true }).click()
  const collision = page.getByRole('dialog', { name: 'Совпадают названия списков', exact: true })
  await expect(collision).toContainText(name)
  await expect.poll(() => collision.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await collision.getByRole('button', { name: mode === 'merge' ? 'Объединить товары' : 'Создать отдельные списки с постфиксом (2)', exact: true }).click()
  try {
    await expect(page.getByText('Перенос локального профиля не завершён.', { exact: false })).toBeVisible({ timeout: 30000 })
  } catch (error) {
    console.log('[transfer state]', mode, { interrupted,
      alerts: await page.getByRole('alert').allTextContents(),
      statuses: (await page.getByRole('status').allTextContents()).map(text => text.slice(0, 500)),
      dialogs: (await page.getByRole('dialog').allTextContents()).map(text => text.slice(0, 500)) })
    throw error
  }
  console.log('[transfer]', mode, 'resume committed import after dropped response')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: 30000 })
  await expect(page.getByRole('dialog', { name: 'Синхронизация локального профиля' })).toHaveCount(0)
  const resultName = mode === 'merge' ? name : name + ' (3)'
  await expect(page.getByRole('button', { name: resultName, exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: resultName, exact: true }).click()
  await expect(page.getByRole('checkbox', { name: localItem, exact: true })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: cloudItem, exact: true })).toHaveCount(mode === 'merge' ? 1 : 0)
  await logout(page)
  await openSettings(page)
  await expect(page.getByLabel('Локальный профиль', { exact: true }).locator('option')).toHaveCount(1)
  await expect(page.getByLabel('Локальный профиль', { exact: true }).locator('option:checked')).toHaveText(email)
  await closeSettings(page)
  await page.getByRole('button', { name: /^Архив,/ }).click()
  await expect(page.getByRole('region', { name: 'Архив покупок' }).getByText(archivedItem, { exact: false })).toBeVisible()
  expect(interrupted).toBe(true)
})
