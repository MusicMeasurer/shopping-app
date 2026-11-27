import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Storage } from '../data/storage'
import type { ListIndicatorState, SyncWork } from '../data/list-sync-ledger'

const empty: SyncWork[] = []
export function useListSyncIndicators(storage: Storage, accountId: string | null, refreshRevision: number,
  draftRevision: number, conflicts: readonly string[], activeListId?: string) {
  const ledger = storage.listSyncLedger
  const revision = useSyncExternalStore(ledger.subscribe, ledger.version, ledger.version)
  const [queue, setQueue] = useState<{ account: string; rows: SyncWork[] }>({ account: '', rows: empty })
  const [, tick] = useState(0)
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    const observed = ledger.version()
    void storage.readListSyncWork(accountId).then(rows => {
      if (cancelled || observed !== ledger.version()) return
      ledger.reconcile(accountId, rows)
      setQueue({ account: accountId, rows })
    }).catch(() => { /* Existing storage/account errors remain authoritative. */ })
    return () => { cancelled = true }
  }, [storage, ledger, accountId, refreshRevision, draftRevision, revision])
  const now = Date.now()
  const states = accountId ? ledger.states(accountId, queue.account === accountId ? queue.rows : empty, conflicts, now, activeListId) : new Map<string, ListIndicatorState>()
  const itemStates = accountId ? ledger.itemStates(accountId, queue.account === accountId ? queue.rows : empty, now) : new Map<string, ListIndicatorState>()
  const deadline = Math.min(...[...states.values(), ...itemStates.values()].flatMap(row => row.state === 'success' && row.since !== undefined ? [row.since + 5000] : []))
  useEffect(() => {
    if (!Number.isFinite(deadline)) return
    const timer = window.setTimeout(() => tick(value => value + 1), Math.max(1, deadline - Date.now()))
    return () => window.clearTimeout(timer)
  }, [deadline])
  return { lists: states, items: itemStates, work: queue.account === accountId ? queue.rows : empty,
    ready: accountId === null || queue.account === accountId, cancellationNotice: accountId ? ledger.cancellationNotice(accountId) : undefined }
}
