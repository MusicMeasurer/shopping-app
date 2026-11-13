import { test, expect, type Page } from '@playwright/test'

// Real browser + real Auth A/B against the pinned disposable Supabase lab.
// Integration runs create private disposable lists for each test account.
const credentials = [
  ['E3_USER_A_EMAIL', 'E3_USER_A_PASSWORD'],
  ['E3_USER_B_EMAIL', 'E3_USER_B_PASSWORD'],
] as const

async function signIn(page: Page, which: 0 | 1) {
  const [emailKey, passwordKey] = credentials[which]
  const email = process.env[emailKey]
  const password = process.env[passwordKey]
  if (!email || !password) throw new Error('Missing existing disposable A/B credentials')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Пароль').fill(password)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: 30000 })
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible({ timeout: 30000 })
}

async function add(page: Page, name: string) {
  const input = page.getByLabel('Что нужно купить?', { exact: false })
  await input.fill(name)
  if (process.env.GITHUB_REF_NAME === 'feature/e4-accepted-reintegration' &&
      await input.evaluate(element => element.tagName === 'INPUT')) await input.press('Enter')
  else await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name })).toBeVisible({ timeout: 15000 })
}

test('real A → B → A isolates local purchases and preserves original guest across reload and offline restart', async ({ page, context }) => {
  test.setTimeout(180000)
  if (process.env.VITE_SUPABASE_URL !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' ||
      !process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) {
    throw new Error('Only pinned disposable lab with publishable key is allowed')
  }
  const integrated = process.env.GITHUB_REF_NAME === 'feature/e4-accepted-reintegration'
  const listA = 'A_LIST_' + crypto.randomUUID()
  const listB = 'B_LIST_' + crypto.randomUUID()
  async function selectAccountList(name: string, create = false) {
    if (!integrated) return
    if (create) {
      await page.getByRole('button', { name: 'Добавить список', exact: true }).click()
      await page.getByLabel('Название списка').fill(name)
      await page.getByRole('button', { name: 'Создать список', exact: true }).click()
    }
    await page.getByRole('button', { name, exact: true }).click()
  }

  async function removeAccountList() {
    if (!integrated) return
    await page.getByRole('button', { name: 'Удалить список', exact: true }).click()
    await page.getByRole('dialog', { name: 'Удалить список?' })
      .getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Облачный архив' })
      .getByRole('status').filter({ hasText: /^Список удалён/ })).toBeVisible({ timeout: 20000 })
  }

  const guest = 'GUEST_LIFECYCLE_' + crypto.randomUUID()
  const itemA = 'A_LIFECYCLE_' + crypto.randomUUID()
  const itemB = 'B_LIFECYCLE_' + crypto.randomUUID()
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('region', { name: 'Настройки приложения' })).toBeVisible()
  await page.getByLabel('Стандартный (3 в ряд)').check()
  await expect(page.locator('nav.lists-grid')).toHaveClass(/standard/)
  await page.getByLabel('Стандартный', { exact: true }).check()
  await expect(page.locator('main.shopping-e4')).toHaveClass(/content-standard/)
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await page.reload()
  await expect(page.locator('nav.lists-grid')).toHaveClass(/standard/)
  await expect(page.locator('main.shopping-e4')).toHaveClass(/content-standard/)
  await page.getByRole('button', { name: 'Новый список' }).click()
  const newListDialog = page.getByRole('dialog', { name: integrated ? 'Создать список' : 'Новый список' })
  await expect(newListDialog).toBeVisible()
  await newListDialog.getByLabel('Название списка', { exact: true }).fill('E4 TEST LIST')
  await newListDialog.getByLabel('Тип списка', { exact: true }).selectOption('permanent')
  await newListDialog.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('button', { name: 'E4 TEST LIST' })).toBeVisible()
  await page.getByRole('button', { name: /Продукты/ }).click()
  await add(page, guest)
  await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await expect(page.getByRole('dialog', { name: 'Вход в аккаунт' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  await signIn(page, 0)
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.account-header-email')).toHaveText(process.env.E3_USER_A_EMAIL!)
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  await expect(page.getByRole('dialog', { name: 'Мой аккаунт' })).toBeVisible()
  await expect(page.locator('.account-full-email')).toHaveText(process.env.E3_USER_A_EMAIL!)
  await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
  await expect(page.getByRole('checkbox', { name: guest })).toHaveCount(0)
  await selectAccountList(listA, true)
  await add(page, itemA)
  await signOut(page)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: itemA })).toHaveCount(0)
  await signIn(page, 1)
  await expect(page.getByRole('checkbox', { name: itemA })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: guest })).toHaveCount(0)
  if (integrated) await expect(page.getByRole('button', { name: listA, exact: true })).toHaveCount(0)
  await selectAccountList(listB, true)
  await add(page, itemB)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: 30000 })
  await selectAccountList(listB)
  await expect(page.getByRole('checkbox', { name: itemB })).toBeVisible()
  await removeAccountList()
  await signOut(page)
  await signIn(page, 0)
  await selectAccountList(listA)
  if (integrated) await expect(page.getByRole('button', { name: listB, exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: itemA })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: itemB })).toHaveCount(0)
  await removeAccountList()
  await signOut(page)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  // Offline restart is exercised for the local guest workspace. Authenticated
  // offline session restoration is a separate acceptance criterion.
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible({ timeout: 20000 })
  await context.setOffline(false)
})
