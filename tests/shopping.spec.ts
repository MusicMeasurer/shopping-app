import { test, expect } from '@playwright/test'
test('iPhone: lists, persistence, deletion and offline PWA', async ({ page, context }) => {
  await page.goto('/shopping-app/')
  const input = page.getByLabel('Что нужно купить?')
  const groceries = page.getByRole('button', { name: 'Продукты', exact: true })
  const household = page.getByRole('button', { name: 'Хозяйственные покупки', exact: true })
  await expect(input).toBeEnabled()
  await expect(page.getByText('Списки сохраняются на этом устройстве.', { exact: false })).toBeVisible()
  await input.fill('Молоко')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Молоко' }).click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeChecked()
  await household.click()
  await expect(page.getByText('Здесь начинается ваш список')).toBeVisible()
  await input.fill('Мыло')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Мыло' })).toBeVisible()
  await page.reload()
  await groceries.click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeChecked()
  await household.click()
  await page.getByRole('button', { name: 'Удалить Мыло' }).click()
  await expect(page.getByText('Здесь начинается ваш список')).toBeVisible()
  await page.reload()
  await household.click()
  await expect(page.getByText('Здесь начинается ваш список')).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  const manifest = await page.request.get('/shopping-app/manifest.webmanifest')
  expect((await manifest.json()).start_url).toBe('/shopping-app/')
  await context.setOffline(true)
  await page.reload()
  await groceries.click()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).toBeChecked()
  await page.getByRole('checkbox', { name: 'Молоко' }).click()
  await input.fill('Хлеб')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Хлеб' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Хлеб' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Молоко' })).not.toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('temporary indicator preview preserves static artwork and isolates animation in iPhone WebKit', async ({ page }) => {
  await page.goto('/shopping-app/')
  await expect(page.getByLabel('Что нужно купить?')).toBeEnabled()
  const preview = page.getByRole('group', { name: 'Предварительный просмотр индикаторов' })
  await expect(preview).toBeVisible()
  const icons = preview.locator('svg.sync-preview-icon')
  await expect(icons).toHaveCount(4)
  expect(await icons.evaluateAll(nodes => nodes.map(node => [
    node.getAttribute('data-state'), getComputedStyle(node).animationName, getComputedStyle(node).animationDuration,
  ]))).toEqual([
    ['waiting', 'sync-preview-wait', '2s'],
    ['running', 'sync-preview-spin', '1.8s'],
    ['error', 'sync-preview-error', '3s'],
    ['success', 'sync-preview-success', '7s'],
  ])
  const running = preview.locator('svg[data-state="running"]')
  const geometry = await running.locator('path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))
  expect(geometry).toEqual([
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ])
  await expect.poll(() => running.evaluate(node => getComputedStyle(node).transform)).not.toBe('none')
  expect(await running.locator('path').evaluateAll(nodes => nodes.every(node =>
    getComputedStyle(node).animationName === 'none' && getComputedStyle(node).transform === 'none'
  ))).toBe(true)
  expect(await preview.evaluate(node => node.previousElementSibling?.tagName)).toBe('FOOTER')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => icons.evaluateAll(nodes => nodes.every(node =>
    getComputedStyle(node).animationName === 'none'
  ))).toBe(true)
  expect(await running.locator('path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d')))).toEqual(geometry)
})


test('failed local write reports a temporary notice without misleading reload or a false success', async ({ page }) => {
  await page.goto('/shopping-app/')
  const input = page.getByLabel('Что нужно купить?')
  await expect(input).toBeEnabled()
  await input.fill('Тест сохранения')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  const item = page.getByRole('checkbox', { name: 'Тест сохранения' })
  await expect(item).not.toBeChecked()
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'profileItems' || this.name === 'items') {
        IDBObjectStore.prototype.put = original
        throw new DOMException('Injected local write failure', 'QuotaExceededError')
      }
      return key === undefined ? original.call(this, value) : original.call(this, value, key)
    }
  })
  await item.click()
  const notice = page.locator('.item-write-notice')
  await expect(notice).toContainText('Не удалось сохранить изменение')
  await expect(item).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toHaveCount(0)
  await expect(page.locator('.list-card-sync[data-sync-state="success"]')).toHaveCount(0)
  await expect(notice).toHaveCount(0, { timeout: 8000 })
  await item.click()
  await expect(item).toBeChecked()
})
