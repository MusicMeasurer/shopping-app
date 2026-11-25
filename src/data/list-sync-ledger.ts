/** One account-scoped source for the state of operations, independent of UI size. */
export type SyncIndicatorState = 'waiting' | 'running' | 'error' | 'success'
export type SyncWorkKind = 'items' | 'lists' | 'feed'
export interface SyncWork {
  id: string
  listIds: readonly string[]
  kind: SyncWorkKind
  phase: 'waiting' | 'running' | 'error'
}
interface ActiveWork extends SyncWork { durable: boolean }
export interface ListIndicatorState {
  state: SyncIndicatorState
  since?: number
  errors: readonly SyncWorkKind[]
}
const priority: Record<SyncIndicatorState, number> = { success: 1, waiting: 2, running: 3, error: 4 }
export class ListSyncLedger {
  private accounts = new Map<string, Map<string, ActiveWork>>()
  private successes = new Map<string, Map<string, number>>()
  private settled = new Map<string, Set<string>>()
  private retries = new Map<string, Map<string, () => Promise<unknown>>>()
  private listeners = new Set<() => void>()
  private revision = 0
  private notificationPending = false
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  version = () => this.revision
  changed() {
    this.revision++
    if (this.notificationPending || !this.listeners.size) return
    this.notificationPending = true
    // Coalesce a multi-item batch or many IndexedDB feed writes into a frame.
    // The snapshot revision is still incremented synchronously.
    setTimeout(() => {
      this.notificationPending = false
      for (const listener of this.listeners) listener()
    }, 16)
  }
  private work(account: string) {
    let rows = this.accounts.get(account)
    if (!rows) { rows = new Map(); this.accounts.set(account, rows) }
    return rows
  }
  private successesFor(account: string) {
    let rows = this.successes.get(account)
    if (!rows) { rows = new Map(); this.successes.set(account, rows) }
    return rows
  }
  private supersede(account: string, listIds: readonly string[]) {
    for (const listId of listIds) this.successes.get(account)?.delete(listId)
  }
  queued(account: string, id: string, listIds: readonly string[], kind: SyncWorkKind) {
    this.supersede(account, listIds)
    this.work(account).set(id, { id, listIds, kind, phase: 'waiting', durable: true })
    this.changed()
  }
  begin(account: string, id: string, listIds: readonly string[], kind: SyncWorkKind, durable = true) {
    if (!listIds.length) return
    this.settled.get(account)?.delete(id)
    this.supersede(account, listIds)
    this.work(account).set(id, { id, listIds, kind, phase: 'running', durable })
    this.changed()
  }
  fail(account: string, id: string) {
    const work = this.accounts.get(account)?.get(id)
    if (!work) return
    this.work(account).set(id, { ...work, phase: 'error' })
    this.supersede(account, work.listIds)
    this.changed()
  }
  cancel(account: string, id: string) {
    this.retries.get(account)?.delete(id)
    if (this.accounts.get(account)?.delete(id)) this.changed()
  }
  registerRetry(account: string, id: string, retry: () => Promise<unknown>) {
    let rows = this.retries.get(account)
    if (!rows) { rows = new Map(); this.retries.set(account, rows) }
    rows.set(id, retry)
  }
  async retryDirect(account: string, listId: string, active: () => boolean) {
    for (const row of [...(this.accounts.get(account)?.values() ?? [])]) {
      if (!active()) return
      if (row.phase === 'error' && !row.durable && row.listIds.includes(listId))
        await this.retries.get(account)?.get(row.id)?.()
    }
  }
  confirm(account: string, id: string, listIds: readonly string[], now = Date.now()) {
    this.accounts.get(account)?.delete(id)
    this.retries.get(account)?.delete(id)
    let settled = this.settled.get(account)
    if (!settled) { settled = new Set(); this.settled.set(account, settled) }
    settled.add(id)
    const successes = this.successesFor(account)
    for (const [list, at] of successes) if (now - at >= 5000) successes.delete(list)
    for (const listId of listIds) successes.set(listId, now)
    this.changed()
  }
  /** A fresh durable inventory prevents obsolete errors or old success from
   * surviving a cancellation, replacement, or a newer locally queued edit. */
  reconcile(account: string, queued: readonly SyncWork[]) {
    const ids = new Set(queued.map(row => row.id))
    for (const id of this.settled.get(account) ?? []) if (!ids.has(id)) this.settled.get(account)?.delete(id)
    for (const [id, work] of this.accounts.get(account) ?? []) {
      if (work.durable && work.phase !== 'running' && !ids.has(id)) this.accounts.get(account)?.delete(id)
    }
    // A success on one operation must not reappear after other work is cancelled.
    for (const row of queued) if (!this.settled.get(account)?.has(row.id)) this.supersede(account, row.listIds)
  }
  reset(account: string) {
    this.accounts.delete(account); this.successes.delete(account); this.settled.delete(account); this.retries.delete(account); this.changed()
  }
  /** Only a confirmed operation starts the five-second success window. No
   * account-wide transport status, timer, or empty poll creates a success. */
  states(account: string, queued: readonly SyncWork[], conflicts: readonly string[], now = Date.now()): Map<string, ListIndicatorState> {
    const result = new Map<string, ListIndicatorState>()
    const set = (listId: string, state: SyncIndicatorState, kind?: SyncWorkKind, since?: number) => {
      const old = result.get(listId)
      const errors = [...new Set([...(old?.errors ?? []), ...(state === 'error' && kind ? [kind] : [])])]
      if (!old || priority[state] > priority[old.state]) result.set(listId, { state, since, errors })
      else if (errors.length !== old.errors.length) result.set(listId, { ...old, errors })
    }
    for (const [list, at] of this.successes.get(account) ?? []) if (now - at < 5000) set(list, 'success', undefined, at)
    const active = this.accounts.get(account)
    for (const row of queued) {
      if (this.settled.get(account)?.has(row.id)) continue
      const live = active?.get(row.id)
      const phase = row.phase === 'error' ? 'error' : live?.phase ?? row.phase
      for (const list of row.listIds) set(list, phase, row.kind)
    }
    for (const row of active?.values() ?? []) {
      for (const list of row.listIds) set(list, row.phase, row.kind)
    }
    for (const list of conflicts) set(list, 'error', 'items')
    return result
  }
  /** Only read/application failures of the shared feed may be cleared by
   * a verified feed check; uncertain mutations require their own receipt. */
  clearFeedErrors(account: string, listId: string) {
    for (const [id, work] of this.accounts.get(account) ?? []) if (!work.durable && work.kind === 'feed' &&
        work.phase === 'error' && work.listIds.includes(listId)) this.accounts.get(account)?.delete(id)
    this.changed()
  }
}
export function syncLedger(storage: object): ListSyncLedger | undefined {
  return (storage as { listSyncLedger?: ListSyncLedger }).listSyncLedger
}
