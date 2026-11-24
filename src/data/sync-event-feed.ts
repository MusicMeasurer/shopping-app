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
  | { kind: 'delta'; accountId: string; from: string; through: string; head: string; events: SyncEvent[]; batchThrough?: string }
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
 * Read and validate one page. through is the final position received;
 * batchThrough is the fixed upper limit if further pages remain.
 * Persist each verified page with both positions before requesting another.
 */
export async function readSyncEventPage(
  client: Pick<SupabaseClient, 'rpc'>, accountId: string, cursor: string | undefined,
  isActive: () => boolean, onRequest: () => void = () => {},
  resumeThrough?: string, observedHead?: string,
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
  if (resumeThrough !== undefined && BigInt(position(resumeThrough)) < BigInt(from))
    throw new Error('Invalid saved account feed boundary')
  assertActive()
  onRequest()
  const { data, error } = await client.rpc('pull_e4_account_changes_v2', {
    p_account: accountId, p_after: from, p_limit: pageSize,
    ...(resumeThrough === undefined ? {} : { p_through: resumeThrough }),
  })
  assertActive()
  if (error?.code === 'P0002') return snapshot()
  if (error?.code === 'PGRST202' && resumeThrough === undefined) return { kind: 'unsupported', accountId }
  if (error) throw error
  const page = record(data)
  const head = position(page.head)
  const bound = position(page.through)
  if (BigInt(head) < BigInt(observedHead ?? from) || BigInt(bound) > BigInt(head)
      || BigInt(bound) < BigInt(from) || (resumeThrough === undefined ? bound !== head : bound !== resumeThrough))
    throw new Error('Invalid account feed batch boundary')
  if (!Array.isArray(page.events) || page.events.length > pageSize) throw new Error('Invalid account feed page')
  let after = from
  const events: SyncEvent[] = []
  for (const raw of page.events) {
    const row = record(raw)
    const next = position(row.event_position)
    if (BigInt(next) !== BigInt(after) + 1n || BigInt(next) > BigInt(bound))
      throw new Error('Non-contiguous account feed page')
    if (row.deleted === true && row.snapshot !== null) throw new Error('Deleted entity has a snapshot')
    const change = parseAccountFeedChange(row, accountId)
    const semantics = row.semantics === undefined ? undefined : parseSemantics(row.semantics, change)
    events.push({ position: next, change, ...(semantics ? { semantics } : {}) })
    after = next
  }
  if (after !== bound && page.events.length !== pageSize) throw new Error('Incomplete account feed page')
  return { kind: 'delta', accountId, from, through: after, head, events,
    ...(after !== bound ? { batchThrough: bound } : {}) }
}

/** Read-only full-batch helper. Never returns partial evidence after failure. */
export async function readSyncEventBatch(
  client: Pick<SupabaseClient, 'rpc'>, accountId: string, cursor: string | undefined,
  isActive: () => boolean, onRequest: () => void = () => {},
): Promise<SyncEventBatch> {
  let after = cursor, bound: string | undefined, head: string | undefined
  const events: SyncEvent[] = []
  while (true) {
    const page = await readSyncEventPage(client, accountId, after, isActive, onRequest, bound, head)
    if (page.kind !== 'delta') return page
    events.push(...page.events)
    if (!page.batchThrough) return { ...page, from: cursor!, events }
    after = page.through
    head = page.head
    bound = page.batchThrough
  }
}
