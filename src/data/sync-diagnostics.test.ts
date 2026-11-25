import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncDiagnostics, syncDiagnosticKey } from './sync-diagnostics'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) } }
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules() })
describe('isolated sync diagnostics', () => {
  it('persists paired stages and duration across instances; exports only a closed schema', () => {
    const saved = storage()
    let now = Date.UTC(2026, 10, 25)
    const trace = createSyncDiagnostics(true, () => saved, () => now)
    const finish = trace.begin('batch-send', { count: 2 })
    now += 500
    finish('ok')
    finish('error')
    const raw = JSON.parse(saved.getItem(syncDiagnosticKey)!)
    raw[0].email = 'secret@example.test'; raw[0].payload = 'secret-token'
    raw[0].code = 'secret_identifier'
    raw.push({ at: now, stage: 'secret-list-name', outcome: 'ok' })
    saved.setItem(syncDiagnosticKey, JSON.stringify(raw))
    const exported = createSyncDiagnostics(true, () => saved, () => now).exportLog()
    const { events, persistent } = JSON.parse(exported)
    expect(persistent).toBe(true)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ stage: 'batch-send', outcome: 'ok', elapsedMs: 500, span: events[0].span })
    expect(exported).not.toContain('secret')
  })
  it('caps storage and discards records older than seven days', () => {
    const saved = storage()
    let now = Date.UTC(2026, 10, 25)
    const trace = createSyncDiagnostics(true, () => saved, () => now)
    for (let i = 0; i < 340; i++) trace.mark('queue', 'ok', { count: i })
    expect(JSON.parse(trace.exportLog()).events).toHaveLength(320)
    expect(JSON.parse(trace.exportLog()).events[0].count).toBe(20)
    now += 8 * 24 * 60 * 60 * 1000
    trace.mark('visible', 'ok')
    expect(JSON.parse(trace.exportLog()).events).toHaveLength(1)
    expect(JSON.parse(saved.getItem(syncDiagnosticKey)!)).toHaveLength(1)
  })
  it('is inert when disabled, and falls back to memory if storage is denied', () => {
    const denied = vi.fn(() => { throw new Error('denied') })
    const disabled = createSyncDiagnostics(false, denied)
    disabled.mark('manual', 'start')
    disabled.begin('session')('ok')
    expect(JSON.parse(disabled.exportLog()).events).toEqual([])
    expect(denied).not.toHaveBeenCalled()
    const active = createSyncDiagnostics(true, denied)
    expect(() => active.begin('session')('timeout')).not.toThrow()
    expect(JSON.parse(active.exportLog())).toMatchObject({ persistent: false, events: [{ stage: 'session', outcome: 'start' }, { stage: 'session', outcome: 'timeout' }] })
  })
  it('observes failure without leaking exception contents or changing the result', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_SYNC_DIAGNOSTICS', 'true')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://gmrqeubhotjpmtwokfeq.supabase.co')
    vi.stubGlobal('localStorage', storage())
    const { traceSync, exportSyncLog } = await import('./sync-diagnostics')
    const value = { error: { status: 503, code: 'unexpected_failure', message: 'private-token' } }
    expect(await traceSync('batch-send', async () => value, {}, row => !row.error)).toBe(value)
    const error = new Error('private-email')
    await expect(traceSync('receipt-store', async () => { throw error })).rejects.toBe(error)
    const log = exportSyncLog()
    expect(JSON.parse(log).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'batch-send', outcome: 'rejected', status: 503, code: 'unexpected_failure' }),
      expect.objectContaining({ stage: 'receipt-store', outcome: 'error' }),
    ]))
    expect(log).not.toContain('private')
  })
  it('records the actual existing session deadline and a successful retry', async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.stubEnv('VITE_SYNC_DIAGNOSTICS', 'true')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://gmrqeubhotjpmtwokfeq.supabase.co')
    vi.stubGlobal('localStorage', storage())
    const { exportSyncLog } = await import('./sync-diagnostics')
    const { createAuthController } = await import('./auth-controller')
    const id = 'd9eb736c-6a8f-4a3c-bdab-cb4604e975e3'
    const session = { access_token: 'private-token', user: { id } }
    let complete!: (id: string | null) => void
    const verify = vi.fn<() => Promise<string | null>>().mockResolvedValue(id)
    const controller = createAuthController({
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ error: null }), signOut: async () => ({ error: null }),
    }, () => {}, undefined, verify)
    await controller.initialize()
    verify.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const stalled = controller.recheckSession(id)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await stalled).toBe(false)
    expect(await controller.recheckSession(id)).toBe(true)
    complete(null)
    await Promise.resolve()
    controller.dispose()
    const log = exportSyncLog()
    expect(JSON.parse(log).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: 'session', outcome: 'timeout', elapsedMs: 20_000 }),
      expect.objectContaining({ stage: 'session', outcome: 'ok' }),
    ]))
    expect(log).not.toContain(id)
    expect(log).not.toContain('private-token')
  })
})
