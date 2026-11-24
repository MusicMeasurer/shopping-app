export interface ResumeConditions {
  force: boolean
  unhealthy: boolean
  pending: boolean
  working: boolean
  deferred: boolean
  lastSuccess?: number
  now: number
}

/** The 30s throttle is for healthy idle workspaces only. */
export function shouldRecoverSync(state: ResumeConditions): boolean {
  if (state.force || state.unhealthy || state.pending || state.working || state.deferred) return true
  if (state.lastSuccess === undefined) return true
  const elapsed = state.now - state.lastSuccess
  return elapsed < 0 || elapsed >= 30_000
}

/** One active recovery and at most one coalesced trailing request. */
export function createSyncRecovery(run: (force: boolean, isCurrent: () => boolean) => Promise<void>) {
  let disposed = false
  let running = false
  let queued: boolean | undefined
  function request(force: boolean) {
    if (disposed) return
    if (running) {
      queued = force || queued === true
      return
    }
    running = true
    void (async () => {
      let next: boolean | undefined = force
      try {
        while (!disposed && next !== undefined) {
          queued = undefined
          try { await run(next, () => !disposed) } catch { /* caller owns the visible error state */ }
          next = queued
        }
      } finally {
        running = false
      }
    })()
  }
  return {
    request,
    running: () => running,
    dispose() { disposed = true; queued = undefined },
  }
}
