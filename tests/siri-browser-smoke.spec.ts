import { test, expect } from '@playwright/test'

test('mobile browser: shopping workspace remains functional before Siri enrollment', async ({ page }) => {
  await page.goto('/shopping-app/')
  const input = page.getByLabel('Что нужно купить?')
  await expect(input).toBeVisible()
  await input.fill('Тест Siri: молоко')
  await page.getByRole('button', { name: 'Добавить товар' }).click()
  await expect(page.getByRole('checkbox', { name: 'Тест Siri: молоко' })).toBeVisible()
  await page.getByRole('button', { name: 'Хозяйственные покупки' }).click()
  await expect(page.getByText('Здесь начинается ваш список')).toBeVisible()
  await page.getByRole('button', { name: 'Продукты' }).click()
  await expect(page.getByRole('checkbox', { name: 'Тест Siri: молоко' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Тест Siri: молоко' })).toBeVisible()
})
