import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

// Real UI, real Supabase Auth and one pre-existing disposable fixture list.
// Test creates one uniquely named item and removes it in finally. No production.
test('bound account queues an offline add across browser restart and syncs after reconnect', async ({ page, context }) => {
  test.setTimeout(180000)
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  const email = process.env.E3_USER_A_EMAIL
  const password = process.env.E3_USER_A_PASSWORD
  if (url !== 'https://gmrqeubhotjpmtwokfeq.supabase.co' || !key?.startsWith('sb_publishable_') || !email || !password) {
    throw new Error('Pinned disposable lab and existing account A credentials required')
  }
  const api = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: authError } = await api.auth.signInWithPassword({ email, password })
  if (authError) throw authError
  const { data: lists, error: listsError } = await api.from('shopping_lists').select('id,name').eq('name', 'SHOPPINGAPP_HTTP_TEST_A')
  if (listsError) throw listsError
  expect(lists?.length).toBe(1)
  const listId = lists![0].id as string
  const name = 'OFFLINE_BROWSER_' + crypto.randomUUID()
  let itemId: string | null = null
  let afterRestartId: string | null = null
  const afterRestartName = 'OFFLINE_AFTER_RESTART_' + crypto.randomUUID()
  try {
    await page.goto('/shopping-app/')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Пароль').fill(password)
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(page.getByText('Вы вошли в аккаунт')).toBeVisible({ timeout: 30000 })
    await page.getByRole('button', { name: 'Загрузить мои облачные списки' }).click()
    await expect(page.getByRole('option', { name: 'SHOPPINGAPP_HTTP_TEST_A' })).toBeAttached()
    await page.getByLabel('Локальный список').selectOption('groceries')
    await page.getByLabel('Облачный список').selectOption({ label: 'SHOPPINGAPP_HTTP_TEST_A' })
    await page.getByRole('button', { name: 'Привязать' }).click()
    await expect(page.getByText('Продукты: облачный список привязан', { exact: false })).toBeVisible({ timeout: 20000 })
    await context.setOffline(true)
    await page.getByLabel('Что нужно купить?', { exact: false }).fill(name)
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect(page.getByRole('checkbox', { name })).toBeVisible({ timeout: 15000 })
    // No remote mutation can succeed while browser networking is disabled.
    const { data: before, error: beforeError } = await api.from('shopping_items').select('id').eq('list_id', listId).eq('name', name).is('deleted_at', null)
    if (beforeError) throw beforeError
    expect(before).toHaveLength(0)
    await page.reload()
    await expect(page.getByText('Локальный профиль: нет сети.', { exact: false })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('checkbox', { name })).toBeVisible()
    await page.getByLabel('Что нужно купить?', { exact: false }).fill(afterRestartName)
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect(page.getByRole('checkbox', { name: afterRestartName })).toBeVisible()
    // Reconnection must reverify server identity before uploading queued edits.
    await context.setOffline(false)
    // Connectivity event must reverify the account and drain the durable queue
    // without requiring another page reload or manual cloud action.
    await expect(page.getByText('Вы вошли в аккаунт')).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('checkbox', { name })).toBeVisible({ timeout: 20000 })
    await expect.poll(async () => {
      const { data, error } = await api.from('shopping_items').select('id').eq('list_id', listId).eq('name', name).is('deleted_at', null)
      if (error) throw error
      itemId = data?.[0]?.id ?? null
      return data?.length ?? 0
    }, { timeout: 30000 }).toBe(1)
    await expect.poll(async () => {
      const { data, error } = await api.from('shopping_items').select('id').eq('list_id', listId).eq('name', afterRestartName).is('deleted_at', null)
      if (error) throw error
      afterRestartId = data?.[0]?.id ?? null
      return data?.length ?? 0
    }, { timeout: 30000 }).toBe(1)
  } finally {
    await context.setOffline(false)
    if (!itemId) {
      const { data } = await api.from('shopping_items').select('id').eq('list_id', listId).eq('name', name).is('deleted_at', null)
      itemId = data?.[0]?.id ?? null
    }
    for (const cleanupId of [itemId, afterRestartId]) {
      if (!cleanupId) continue
      const { data: row } = await api.from('shopping_items').select('version').eq('id', cleanupId).single()
      if (row) {
        const { error } = await api.rpc('apply_item_change', {
          p_operation: crypto.randomUUID(), p_list: listId, p_action: 'delete', p_item: cleanupId,
          p_name: null, p_purchased: null, p_expected_version: row.version,
        })
        if (error) throw error
      }
    }
    await api.auth.signOut()
  }
})
