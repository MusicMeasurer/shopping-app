import { expect, test } from '@playwright/test'

test('the clean build separates same-origin storage and works offline', async ({ page, context }) => {
  test.skip(process.env.VITE_STORAGE_NAMESPACE !== 'shopping-clean', 'Requires the clean build')
  await page.addInitScript(() => { localStorage.setItem('shopping-card-size', 'standard') })
  await page.goto('/shopping-app/')
  const items = page.getByLabel('Что нужно купить? (можно несколько строк)', { exact: true })
  await expect(items).toBeEnabled()
  await expect(page.getByRole('button', { name: /Войти в аккаунт/ })).toBeVisible()

  const storage = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map(database => database.name),
    sharedPreferences: localStorage.getItem('shopping-card-size'),
    cleanWorkspaceKeys: Object.keys(localStorage).filter(key => key.startsWith('shopping-clean:shopping-workspace:')),
  }))
  expect(storage.databases).toContain('shopping-clean:shopping-app')
  expect(storage.databases).not.toContain('shopping-app')
  expect(storage.sharedPreferences).toBe('standard')
  expect(storage.cleanWorkspaceKeys.length).toBeGreaterThan(0)

  await items.fill('Проверка чистовой сборки')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  const item = page.getByRole('checkbox', { name: 'Проверка чистовой сборки', exact: true })
  await expect(item).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(item).toBeVisible()
})
