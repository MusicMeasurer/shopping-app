import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { AUTH_TIMEOUT, INITIAL_SYNC_TIMEOUT, LOCAL_SAVE_TIMEOUT } from '../../../tests/test-timeouts'

const scope = '/shopping-app-preview/integration/'
const project = 'security-rollout-fixture.supabase.co'
const account = '1fc6fe3b-1eab-456c-939f-3e2f0da33528'
const queued = { key: 'rollout-fixture', accountId: 'c945f939-b304-4850-a718-04b461d071cf', operation: { operationId: 'offline-operation' } }
const user = { id: account, email: 'rollout@example.test', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '2026-11-26T00:00:00Z' }
const jwtPart = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url')
const session = {
  access_token: [jwtPart({ alg: 'HS256' }), jwtPart({ sub: account, exp: Math.floor(Date.now() / 1000) + 3600 }), 'test'].join('.'),
  refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, user,
}
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.txt': 'text/plain',
}

async function browserStorage(page: Page, seed = false) {
  return page.evaluate(async ({ seed, queued }) => {
    const open = indexedDB.open('shopping-app')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const tx = db.transaction(['installationIdentity', 'accountOperations'], seed ? 'readwrite' : 'readonly')
      const operations = tx.objectStore('accountOperations')
      if (seed) operations.add(queued)
      const identity = tx.objectStore('installationIdentity').get('device')
      const pending = operations.get(queued.key)
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onabort = tx.onerror = () => reject(tx.error)
      })
      return { version: db.version, identity: identity.result, pending: pending.result }
    } finally { db.close() }
  }, { seed, queued })
}

test('updates an installed PWA and uses a compatible pause build after cutover', async ({ page, context }) => {
  test.setTimeout(90_000)
  const fixture = process.env.SECURITY_ROLLOUT_FIXTURE
  if (!fixture) throw new Error('SECURITY_ROLLOUT_FIXTURE is required')
  let deployed = 'legacy'
  let upgradedServer = false
  const calls: Array<{ path: string; body: Record<string, unknown>; status: number }> = []
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    res.setHeader('Cache-Control', 'no-store')
    if (path.startsWith('/fixture-api/')) {
      let raw = ''
      for await (const chunk of req) raw += chunk
      const body = raw ? JSON.parse(raw) : {}
      const route = path.slice('/fixture-api'.length)
      let status = 200
      let data: unknown = []
      if (route === '/auth/v1/token') data = session
      else if (route === '/auth/v1/user') data = user
      else if (route === '/rest/v1/rpc/snapshot_e4_account_changes') {
        status = 404
        data = { code: 'PGRST202', message: 'Fixture uses empty metadata' }
      } else if (/\/(registration_email_status|account_deletion_status|acknowledge_account_deletion|register_account_deletion_device)$/.test(route) || route === '/auth/v1/signup') {
        status = upgradedServer ? 403 : 200
        data = upgradedServer ? { code: '42501', message: 'Disabled' }
          : route.endsWith('/registration_email_status') ? 'available' : route.endsWith('/register_account_deletion_device')
            ? true : route.endsWith('/account_deletion_status') ? false : {}
      } else if (route.endsWith('/account_deletion_installation_status')) data = 'active'
      else if (route.endsWith('/register_account_deletion_installation')) data = true
      else if (route === '/functions/v1/private-registration') data = { result: 'accepted' }
      calls.push({ path: route, body, status })
      res.writeHead(status, { 'Content-Type': 'application/json', 'x-supabase-api-version': '2024-01-01' })
      res.end(JSON.stringify(data))
      return
    }
    if (!path.startsWith(scope)) { res.writeHead(404).end(); return }
    const relative = path.slice(scope.length) || 'index.html'
    try {
      const body = await readFile(join(fixture, deployed, relative))
      res.writeHead(200, { 'Content-Type': types[extname(relative)] ?? 'application/octet-stream' })
      res.end(body)
    } catch { res.writeHead(404).end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No fixture server')
    const url = `http://127.0.0.1:${address.port}${scope}`
    await context.addInitScript(project => {
      const fetchFromBrowser = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
        if (url.hostname !== project) return fetchFromBrowser(input, init)
        const local = window.location.origin + '/fixture-api' + url.pathname + url.search
        return fetchFromBrowser(input instanceof Request ? new Request(local, input) : local, init)
      }
    }, project)
    const revision = page.locator('html')
    const localItem = page.getByRole('checkbox', { name: 'Локальная покупка до обновления' })
    const profile = page.locator('.profile-menu-trigger')
    async function install(label: string) {
      deployed = label
      await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update() }).catch(error => {
        if (!String(error).includes('Execution context was destroyed')) throw error
      })
      await expect(revision).toHaveAttribute('data-rehearsal-revision', label, { timeout: INITIAL_SYNC_TIMEOUT })
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: AUTH_TIMEOUT })
      const manifest = await page.evaluate(async () => {
        const link = document.querySelector<HTMLLinkElement>('link[rel=manifest]')
        const info = await fetch(link!.href).then(response => response.json())
        return [info.id, info.scope, info.start_url, new URL((await navigator.serviceWorker.ready).scope).pathname]
      })
      expect(manifest).toEqual([scope, scope, scope, scope])
      const served = (await (await page.request.get(url + 'revision.txt')).text()).trim()
      expect(served).toMatch(/^[0-9a-f]{40}$/)
      expect(served).toBe((await readFile(join(fixture, label, 'revision.txt'), 'utf8')).trim())
    }

    await page.goto(url)
    await expect(revision).toHaveAttribute('data-rehearsal-revision', 'legacy')
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, { timeout: AUTH_TIMEOUT })
    await page.getByLabel('Что нужно купить?', { exact: false }).fill('Локальная покупка до обновления')
    await page.getByRole('button', { name: 'Добавить товар' }).click()
    await expect(localItem).toBeVisible()
    await profile.click()
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Пароль', { exact: true }).fill('fixture-password')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await page.getByRole('button', { name: 'Не синхронизировать', exact: true }).click()
    await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: AUTH_TIMEOUT })
    await expect.poll(() => calls.some(call => call.path.endsWith('/register_account_deletion_device'))).toBe(true)
    await profile.click()
    await page.getByRole('button', { name: 'Выйти', exact: true }).click()
    await expect(profile).toHaveAttribute('data-profile-mode', 'linked')
    const original = await browserStorage(page, true)
    expect(original.identity).toBeTruthy()
    expect(original.pending).toEqual(queued)
    upgradedServer = true

    await context.setOffline(true)
    await page.reload()
    await expect(revision).toHaveAttribute('data-rehearsal-revision', 'legacy')
    expect(await browserStorage(page)).toEqual(original)
    await context.setOffline(false)
    await install('candidate')
    await expect.poll(() => calls.find(call => call.path.endsWith('/account_deletion_installation_status'))?.body,
      { timeout: AUTH_TIMEOUT }).toMatchObject({ p_account: account, p_device: original.identity.id, p_proof: original.identity.proof })
    expect(await browserStorage(page)).toEqual(original)

    await install('paused')
    await expect(profile).toHaveAttribute('data-profile-mode', 'linked')
    await profile.click()
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Забыли пароль?' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Зарегистрироваться' })).toHaveCount(0)
    expect(await browserStorage(page)).toEqual(original)
    await page.getByLabel('Пароль', { exact: true }).fill('fixture-password')
    await page.getByRole('button', { name: 'Войти', exact: true }).click()
    await expect(profile).toHaveAttribute('data-profile-mode', 'cloud', { timeout: AUTH_TIMEOUT })
    await expect.poll(() => calls.find(call => call.path.endsWith('/register_account_deletion_installation'))?.body,
      { timeout: AUTH_TIMEOUT }).toMatchObject({ p_account: account, p_device: original.identity.id, p_proof: original.identity.proof })

    await install('candidate')
    await context.setOffline(true)
    await page.reload()
    await expect(revision).toHaveAttribute('data-rehearsal-revision', 'candidate', { timeout: LOCAL_SAVE_TIMEOUT })
    expect(await browserStorage(page)).toEqual(original)
  } finally {
    const close = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    server.closeAllConnections()
    await close
  }
})
