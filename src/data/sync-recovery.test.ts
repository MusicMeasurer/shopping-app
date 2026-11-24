import { describe, expect, it, vi } from 'vitest'
import { createSyncRecovery, shouldRecoverSync, type ResumeConditions } from './sync-recovery'

const healthy: ResumeConditions = {
  force: false, unhealthy: false, pending: false, working: false, deferred: false,
  lastSuccess: 1000, now: 30_999,
}
describe('resume policy', () => {
  it('skips only healthy idle returns within 30 seconds', () => {
    expect(shouldRecoverSync(healthy)).toBe(false)
    expect(shouldRecoverSync({ ...healthy, now: 31_000 })).toBe(true)
    expect(shouldRecoverSync({ ...healthy, lastSuccess: undefined })).toBe(true)
    expect(shouldRecoverSync({ ...healthy, now: 999 })).toBe(true)
    for (const key of ['force', 'unhealthy', 'pending', 'working', 'deferred'] as const)
      expect(shouldRecoverSync({ ...healthy, [key]: true })).toBe(true)
  })
  it('coalesces busy requests and preserves a forced retry without parallel execution', async () => {
    const seen: boolean[] = []
    let finish!: () => void
    const runner = createSyncRecovery(async force => {
      seen.push(force)
      if (seen.length === 1) await new Promise<void>(resolve => { finish = resolve })
    })
    runner.request(false)
    runner.request(false)
    runner.request(true)
    runner.request(false)
    expect(seen).toEqual([false])
    finish()
    await vi.waitFor(() => expect(runner.running()).toBe(false))
    expect(seen).toEqual([false, true])
  })
  it('disposal cancels a queued request and invalidates a late result', async () => {
    let finish!: () => void
    const run = vi.fn(async (_force: boolean, current: () => boolean) => {
      await new Promise<void>(resolve => { finish = resolve })
      expect(current()).toBe(false)
    })
    const runner = createSyncRecovery(run)
    runner.request(false)
    runner.request(true)
    runner.dispose()
    finish()
    await vi.waitFor(() => expect(runner.running()).toBe(false))
    expect(run).toHaveBeenCalledOnce()
  })
})
