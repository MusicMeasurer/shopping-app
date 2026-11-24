import type { SupabaseClient } from '@supabase/supabase-js'
import { id, position, record, parseAccountFeedChange, parseAccountFeedSnapshot, type AccountFeedChange } from './account-feed'

export type SyncReason = 'deleted' | 'merged' | 'completed' | 'archived'
export interface SyncSemantics {
  operationId: string
  reason: SyncReason
  sourceName: string
  targetListId?: string
  targetListName?: string
}
export interface SyncEvent {
  position: string
  change: AccountFeedChange
  semantics?: SyncSemantics
}
export type SyncEventBatch =
  | { kind: 'delta'; accountId: string; from: string; through: string; head: string; events: SyncEvent[] }
  | { kind: 'snapshot'; accountId: string; position: string; changes: AccountFeedChange[] }
  | { kind: 'unsupported'; accountId: string }

const pageSize = 200

function name(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 120) throw new Error('Invalid semantic name')
  return raw
}
function parseSemantics(raw: unknown, change: AccountFeedChange): SyncSemantics {
  const row = record(raw)
  if (change.entity === 'list' ? change.metadata !== null : change.item !== null)
    throw new Error('Semantics on a live entity')
  const reason = row.event_reason
  if (reason !== 'deleted' && reason !== 'merged' && reason !== 'completed' && reason !== 'archived')
    throw new Error('Unknown semantic reason')
  if (change.entity === 'list' && reason === 'archived') throw new Error('Invalid list archive reason')
  const common: SyncSemantics = { operationId: id(row.operation_id), reason, sourceName: name(row.source_name) }
  if (reason === 'merged') {
    const targetListId = id(row.target_list_id)
    if (change.entity === 'list' && targetListId === change.listId) throw new Error('Self merge')
    return { ...common, targetListId, targetListName: name(row.target_list_name) }
  }
  if (row.target_list_id != null || row.target_list_name != null) throw new Error('Unexpected merge destination')
  return common
}

/**
 * Read one bounded server batch. No cache writes or UI callbacks: stage 3
 * commits changes and semantic evidence together. Never expose partial results
 * after an interrupted page. A snapshot has no reliable operation history.
 * A newer head does not extend this bound; caller drains later batches and
 * defers new notices until the observed head is reached and data reconciled.
 */
export async function readSyncEventBatch(
  client: Pick<SupabaseClient, 'rpc'>, accountId: string, cursor: string | undefined,
  isActive: () => boolean, onRequest: () => void = () => {},
): Promise<SyncEventBatch> {
  id(accountId)
  const assertActive = () => { if (!isActive()) throw new Error('Account changed during feed synchronization') }
  const snapshot = async (): Promise<SyncEventBatch> => {
    assertActive()
    onRequest()
    const { data, error } = await client.rpc('snapshot_e4_account_changes', { p_account: accountId })
    assertActive()
    if (error?.code === 'PGRST202' && cursor === undefined) return { kind: 'unsupported', accountId }
    if (error) throw error
    const { next, changes } = parseAccountFeedSnapshot(data, accountId)
    return { kind: 'snapshot', accountId, position: next, changes }
  }
  if (cursor === undefined) return snapshot()
  const from = position(cursor)
  let after = from
  let through: string | undefined
  let head = from
  const events: SyncEvent[] = []
  while (true) {
    assertActive()
    onRequest()
    const { data, error } = await client.rpc('pull_e4_account_changes_v2', {
      p_account: accountId, p_after: after, p_limit: pageSize,
      ...(through === undefined ? {} : { p_through: through }),
    })
    assertActive()
    if (error?.code === 'P0002') return snapshot()
    if (error?.code === 'PGRST202' && through === undefined) return { kind: 'unsupported', accountId }
    if (error) throw error
    const page = record(data)
    const pageHead = position(page.head)
    const bound = position(page.through)
    if (BigInt(pageHead) < BigInt(head) || BigInt(bound) > BigInt(pageHead)
        || BigInt(bound) < BigInt(after) || (through === undefined ? bound !== pageHead : bound !== through))
      throw new Error('Invalid account feed batch boundary')
    through = bound
    head = pageHead
    if (!Array.isArray(page.events) || page.events.length > pageSize) throw new Error('Invalid account feed page')
    for (const raw of page.events) {
      const row = record(raw)
      const next = position(row.event_position)
      if (BigInt(next) !== BigInt(after) + 1n || BigInt(next) > BigInt(through))
        throw new Error('Non-contiguous account feed page')
      if (row.deleted === true && row.snapshot !== null) throw new Error('Deleted entity has a snapshot')
      const change = parseAccountFeedChange(row, accountId)
      const semantics = row.semantics === undefined ? undefined : parseSemantics(row.semantics, change)
      events.push({ position: next, change, ...(semantics ? { semantics } : {}) })
      after = next
    }
    if (after === through) return { kind: 'delta', accountId, from, through, head, events }
    if (page.events.length !== pageSize) throw new Error('Incomplete account feed page')
  }
}
