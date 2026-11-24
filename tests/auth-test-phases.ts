import { expect, type Page } from '@playwright/test'
import { AUTH_TIMEOUT, UI_TIMEOUT } from './test-timeouts'

// Authentication outcome and button assertions are separate test phases.
// The legacy E3-only workspace has no profile badge; retain the ordinary UI bound.
const integrated = () => process.env.GITHUB_REF_NAME === 'feature/e4-accepted-reintegration'
export async function waitForAuthChoice(page: Page) {
  if (!integrated()) return
  const consent = page.getByRole('dialog', { name: 'Синхронизация локального профиля' })
  const verified = page.locator('.profile-menu-trigger .profile-badge[data-mode="cloud"]')
  await expect.poll(async () => await consent.isVisible() || await verified.isVisible(),
    { timeout: AUTH_TIMEOUT, message: 'Authentication must reach verified profile or transfer consent' }).toBe(true)
}
export async function expectCloudProfile(page: Page) {
  if (integrated())
    await expect(page.locator('.profile-menu-trigger .profile-badge[data-mode="cloud"]'))
      .toBeVisible({ timeout: AUTH_TIMEOUT })
  await expect(page.getByRole('button', { name: 'Открыть аккаунт' })).toBeVisible({ timeout: UI_TIMEOUT })
}
export async function expectLocalProfile(page: Page) {
  if (integrated())
    await expect(page.locator('.profile-menu-trigger .profile-badge[data-mode="local"], .profile-menu-trigger .profile-badge[data-mode="linked"]'))
      .toBeVisible({ timeout: AUTH_TIMEOUT })
  await expect(page.getByRole('button', { name: 'Войти в аккаунт' })).toBeVisible({ timeout: UI_TIMEOUT })
}
