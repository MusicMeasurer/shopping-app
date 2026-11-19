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
  // Explicitly retain independent guest data in this regression.
  await expect(page.getByRole('button', { name: 'Не синхронизировать', exact: true }).or(page.getByRole('button', { name: 'Открыть аккаунт' }))).toBeVisible({ timeout: 30000 })
  if (await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).isVisible()) await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
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
  const guestList = integrated ? 'GUEST_LIST_' + crypto.randomUUID() : 'E4 TEST LIST'
  const listA = 'A_LIST_' + crypto.randomUUID()
  const listB = 'B_LIST_' + crypto.randomUUID()
  async function selectAccountList(name: string, create = false) {
    if (!integrated) return
    if (create) {
      await page.getByRole('button', { name: 'Новый список', exact: true }).click()
      await page.getByRole('textbox', { name: 'Название списка', exact: true }).fill(name)
      await page.getByRole('button', { name: 'Создать', exact: true }).click()
    }
    await page.getByRole('button', { name, exact: true }).click()
  }

  async function openCloudArchive() {
    const archive = page.getByRole('region', { name: 'Облачный архив' })
    await archive.getByRole('button', { name: 'Показать завершённые покупки' }).click()
    return archive.getByRole('status').filter({ has: page.locator('ul, p') })
  }

  async function waitForCloudWrites() {
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('shopping-app')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<number>((resolve, reject) => {
          const request = db.transaction('accountOperations').objectStore('accountOperations').count()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        db.close()
      }
    }), { timeout: 30000 }).toBe(0)
  }

  async function removeAccountList(name: string) {
    if (!integrated) return
    await waitForCloudWrites()
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await page.getByRole('menuitem', { name: /Удалить список/ }).click()
    await page.getByRole('dialog', { name: 'Удалить список?' })
      .getByRole('button', { name: 'Удалить', exact: true }).click()
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0, { timeout: 20000 })
  }

  const archivedGuest = 'GUEST_ARCHIVE_' + crypto.randomUUID()
  const guest = 'GUEST_LIFECYCLE_' + crypto.randomUUID()
  const itemA = 'A_LIFECYCLE_' + crypto.randomUUID()
  const itemB = 'B_LIFECYCLE_' + crypto.randomUUID()
  await page.goto('/shopping-app/')
  await page.getByRole('button', { name: 'Настройки' }).click()
  await expect(page.getByRole('dialog', { name: 'Настройки приложения' })).toBeVisible()
  await page.getByLabel('Стандартный (горизонтальная лента)').check()
  await page.getByLabel('Стандартный', { exact: true }).check()
  await page.getByRole('dialog', { name: 'Настройки приложения' }).getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('nav.lists-grid')).toHaveClass(/standard/)
  await expect(page.locator('main.shopping-e4')).toHaveClass(/content-standard/)
  await page.reload()
  await expect(page.locator('nav.lists-grid')).toHaveClass(/standard/)
  await expect(page.locator('main.shopping-e4')).toHaveClass(/content-standard/)
  await page.getByRole('button', { name: 'Новый список' }).click()
  const newListDialog = page.getByRole('dialog', { name: integrated ? 'Создать список' : 'Новый список' })
  await expect(newListDialog).toBeVisible()
  await newListDialog.getByLabel('Название списка', { exact: true }).fill(guestList)
  await newListDialog.getByLabel('Тип списка', { exact: true }).selectOption('permanent')
  if (integrated) await newListDialog.getByRole('button', { name: 'Инструменты', exact: true }).click()
  await newListDialog.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('button', { name: guestList, exact: true })).toBeVisible()
  await page.getByRole('button', { name: integrated ? guestList : 'Продукты', exact: true }).click()
  if (integrated) {
    await add(page, archivedGuest)
    await page.getByRole('checkbox', { name: archivedGuest, exact: true }).click()
    await expect(page.getByRole('checkbox', { name: archivedGuest, exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
    await page.getByRole('menu', { name: 'Завершение' }).getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
    await page.getByRole('button', { name: 'Завершить: отмеченные' }).click()
    await expect(page.getByRole('checkbox', { name: archivedGuest, exact: true })).toHaveCount(0)
  }
  await add(page, guest)
  if (integrated) await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
  await expect(page.getByRole('dialog', { name: 'Вход в аккаунт' })).toBeVisible()
  await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  await signIn(page, 0)
  if (integrated) await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toHaveAttribute('data-profile-mode', 'cloud')
  await expect(page.locator(integrated ? '.profile-button-name' : '.account-header-email')).toHaveText(process.env.E3_USER_A_EMAIL!)
  await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
  await expect(page.getByRole('dialog', { name: 'Мой аккаунт' })).toBeVisible()
  await expect(page.locator('.account-full-email')).toHaveText(process.env.E3_USER_A_EMAIL!)
  await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
  await expect(page.getByRole('checkbox', { name: guest })).toHaveCount(0)
  if (integrated) await expect(page.getByRole('button', { name: guestList, exact: true })).toHaveCount(0)
  await selectAccountList(listA, true)
  await add(page, itemA)
  if (integrated) {
    // Deletion is tested on a fully synced profile. Local visibility alone
    // does not prove that the cloud receipt has been committed to IndexedDB.
    await waitForCloudWrites()
    const activeCard = page.getByRole('button', { name: listA, exact: true })
    const product = page.getByRole('checkbox', { name: itemA })
    // A resume event with temporary connectivity loss keeps the selected screen.
    await context.setOffline(true)
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(activeCard).toHaveAttribute('aria-pressed', 'true')
    await expect(product).toBeVisible()
    await context.setOffline(false)
    // A cold restart can verify again, then restore the same selected list.
    await page.reload()
    await expect(activeCard).toHaveAttribute('aria-pressed', 'true', { timeout: 30000 })
    await expect(product).toBeVisible()

    await page.getByRole('button', { name: 'Открыть аккаунт' }).click()
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Повторить выход' })).toBeEnabled({ timeout: 15000 })
    await expect(product).toHaveCount(0)
    await context.setOffline(false)
    await page.reload()
    await expect(page.getByText('Предыдущий выход не завершён.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Повторить выход' }).click()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible({ timeout: 30000 })
    await page.reload()
    await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible({ timeout: 30000 })
  } else {
    await signOut(page)
  }
  if (integrated) {
    await selectAccountList(listA)
    const listStatus = page.locator('.list-heading-status')
    await expect(listStatus.getByRole('img', { name: /синхронизация приостановлена/ })).toBeVisible()
    await expect(listStatus.getByText('Войдите для синхронизации')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: itemA })).toBeVisible()
    await page.getByRole('button', { name: /^Архив,/ }).click()
    const cachedArchive = page.getByRole('region', { name: 'Архив покупок' })
    await expect(cachedArchive.getByText(archivedGuest, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Основные списки' }).click()
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    page.once('dialog', dialog => void dialog.accept())
    await page.getByRole('button', { name: /^Удалить локальный профиль «/ }).click()
    await expect(page.locator('.profile-button-name')).toHaveText('Мои покупки')
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await expect(page.locator('.profile-option > button:first-child')).toHaveCount(0)
    await page.getByRole('button', { name: 'Закрыть окно аккаунта' }).click()
    await expect(page.getByRole('button', { name: listA, exact: true })).toHaveCount(0)
  }
  await selectAccountList(guestList)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: itemA })).toHaveCount(0)
  await signIn(page, 1)
  await expect(page.getByRole('checkbox', { name: itemA })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: guest })).toHaveCount(0)
  if (integrated) {
    await expect(page.getByRole('button', { name: listA, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: guestList, exact: true })).toHaveCount(0)
    const archive = await openCloudArchive()
    await expect(archive).toBeVisible()
    await expect(archive.getByText(archivedGuest, { exact: true })).toHaveCount(0)
  }
  await selectAccountList(listB, true)
  await add(page, itemB)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: 30000 })
  await selectAccountList(listB)
  await expect(page.getByRole('checkbox', { name: itemB })).toBeVisible()
  await removeAccountList(listB)
  await signOut(page)
  await signIn(page, 0)
  if (integrated) await expect((await openCloudArchive()).getByText(archivedGuest, { exact: true })).toHaveCount(0)
  await selectAccountList(listA)
  if (integrated) await expect(page.getByRole('button', { name: listB, exact: true })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: itemA })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: itemB })).toHaveCount(0)
  await removeAccountList(listA)
  if (integrated) {
    await expect(page.getByRole('button', { name: guestList, exact: true })).toHaveCount(0)
  }
  await signOut(page)
  if (integrated) {
    await expect(page.getByRole('button', { name: 'Действия со списком', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Новый список' })).toBeEnabled()
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Удалить список/ })).toBeDisabled()
    await page.getByRole('button', { name: 'Закрыть меню' }).click({ position: { x: 4, y: 4 } })
    await page.getByRole('button', { name: 'Войти в аккаунт' }).click()
    await page.getByRole('group', { name: 'Локальные профили' }).getByRole('button', { name: /Мои покупки/ }).click()
    await expect(page.getByRole('button', { name: 'Новый список' })).toBeEnabled()
    await page.getByRole('button', { name: 'Действия со списком', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: /Удалить список/ })).toBeEnabled()
    await page.getByRole('button', { name: 'Закрыть меню' }).click({ position: { x: 4, y: 4 } })
  }
  await selectAccountList(guestList)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible()
  // Offline restart is exercised for the local guest workspace. Authenticated
  // offline session restoration is a separate acceptance criterion.
  await context.setOffline(true)
  await page.reload()
  await selectAccountList(guestList)
  await expect(page.getByRole('checkbox', { name: guest })).toBeVisible({ timeout: 20000 })
  await context.setOffline(false)
})

test('E4: local workspaces preserve one session, remembered transfer opt-out, and linked account switching', async ({ page }) => {
  test.skip(process.env.GITHUB_REF_NAME !== 'feature/e4-accepted-reintegration', 'Requires the integrated profile menu')
  test.setTimeout(150000)
  if (process.env.VITE_SUPABASE_URL !== 'https://gmrqeubhotjpmtwokfeq.supabase.co')
    throw new Error('Only the pinned disposable lab is allowed')
  const [emailA, passwordA] = credentials[0].map(key => process.env[key])
  const [emailB] = credentials[1].map(key => process.env[key])
  if (!emailA || !emailB || !passwordA) throw new Error('Missing disposable account credentials')
  const profile = page.locator('.profile-menu-trigger')
  const localProfiles = page.getByRole('group', { name: 'Локальные профили' })
  const dialog = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  const sessionWrites: string[] = []
  page.on('request', request => {
    if (request.method() !== 'POST') return
    const url = new URL(request.url())
    if (url.pathname === '/auth/v1/logout' || url.searchParams.get('grant_type') === 'password')
      sessionWrites.push(url.pathname + url.search)
  })

  await page.goto('/shopping-app/')
  await profile.click()
  await page.getByLabel('Email').fill(emailA)
  await page.getByLabel('Пароль').fill(passwordA)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await dialog.getByLabel('Больше не спрашивать для этого профиля').check()
  await dialog.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: 30000 })
  await page.getByRole('button', { name: 'Настройки', exact: true }).click()
  await page.getByLabel('Стандартный (горизонтальная лента)').check()
  await page.getByRole('dialog', { name: 'Настройки приложения' }).getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('nav.list-rail')).toHaveClass(/standard/)

  await profile.click()
  await localProfiles.getByRole('button', { name: /Мои покупки/ }).first().click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'local')
  await expect(page.locator('nav.list-rail')).toHaveClass(/large/)
  await page.reload()
  await expect(profile).toHaveAttribute('data-profile-mode', 'local')
  await profile.click()
  await expect(page.getByLabel('Не спрашивать о синхронизации этого профиля')).toBeChecked()
  await page.getByRole('button', { name: /Вернуться в облачный профиль/ }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: 30000 })
  await expect(dialog).toHaveCount(0)
  expect(sessionWrites).toHaveLength(1)
  await expect(page.locator('nav.list-rail')).toHaveClass(/standard/)

  await profile.click()
  await localProfiles.getByRole('button', { name: /Мои покупки/ }).first().click()
  await profile.click()
  const skipTransfer = page.getByLabel('Не спрашивать о синхронизации этого профиля')
  await skipTransfer.uncheck()
  await expect(skipTransfer).toBeEnabled()
  await expect(skipTransfer).not.toBeChecked()
  await page.getByRole('button', { name: /Вернуться в облачный профиль/ }).click()
  await dialog.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: 30000 })
  await signOut(page)
  await signIn(page, 1)
  await expect(profile).toContainText(emailB)

  await profile.click()
  await localProfiles.getByRole('button', { name: `Войти в облачный профиль «${emailA}»`, exact: true }).click()
  await expect(page.getByLabel('Email')).toHaveValue(emailA)
  await page.getByLabel('Пароль').fill(passwordA)
  await page.getByRole('button', { name: 'Войти', exact: true }).click()
  await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: 30000 })
  await expect(profile).toContainText(emailA)
  expect(sessionWrites.slice(-2)).toEqual(['/auth/v1/logout?scope=local', '/auth/v1/token?grant_type=password'])
  await signOut(page)
})

test('E4: a list created and completed after sign-out is archived on re-entry', async ({ page }) => {
  test.skip(process.env.GITHUB_REF_NAME !== 'feature/e4-accepted-reintegration', 'Requires the integrated profile menu')
  test.setTimeout(120000)
  if (process.env.VITE_SUPABASE_URL !== 'https://gmrqeubhotjpmtwokfeq.supabase.co')
    throw new Error('Only the pinned disposable lab is allowed')
  const name = 'OFFLINE_LIST_' + crypto.randomUUID()
  const item = 'OFFLINE_ITEM_' + crypto.randomUUID()
  await page.goto('/shopping-app/')
  await signIn(page, 1)
  await signOut(page)
  await page.getByRole('button', { name: 'Новый список', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Создать список' })
  await create.getByLabel('Название списка').fill(name)
  await create.getByLabel('Тип списка').selectOption('oneoff')
  await create.getByRole('button', { name: 'Создать', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await add(page, item)
  await page.getByRole('button', { name: 'Завершить список', exact: true }).click()
  await page.getByRole('menu', { name: 'Завершение' }).getByRole('menuitem', { name: 'Завершить список', exact: true }).click()
  await page.getByRole('button', { name: 'Завершить: всё куплено' }).click()
  const queue = page.getByRole('list', { name: 'Операции со списками' })
  await expect(queue).toContainText('ожидает синхронизации')
  await page.reload()
  await expect(queue).toContainText('ожидает синхронизации')
  await signIn(page, 1)
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0, { timeout: 45000 })
  await page.getByRole('button', { name: /^Архив,/ }).click()
  const archive = page.getByRole('region', { name: 'Архив покупок' })
  await expect(archive.getByText(item, { exact: true })).toBeVisible({ timeout: 30000 })
})
