import type { SyncEvent, SyncEventBatch, SyncReason, SyncSemantics } from './sync-event-feed'

/** Small, account-scoped evidence retained while a context is being reconciled.
 * It is NOT a durable notification queue; persistence/acknowledgement are stage 3. */
export interface RemovalEvidence {
  position: string
  entity: 'list' | 'item'
  listId: string
  entityId: string
  semantics?: SyncSemantics
}
export interface SyncEvidence {
  accountId: string
  position: string
  caughtUp: boolean
  removals: readonly RemovalEvidence[]
}
function key(entity: string, entityId: string) { return entity + ':' + entityId }

/**
 * Fold evidence only, independently of the current data cache. A newer live
 * row cancels an earlier removal. Masked tombstones without semantics are
 * absence evidence, never proof of a reason. Old complete batches replay
 * idempotently; overlapping or foreign ranges fail closed.
 * A snapshot replaces history; it cannot prove what happened.
 */
export function accumulateSyncEvidence(previous: SyncEvidence | undefined,
  batch: Exclude<SyncEventBatch, { kind: 'unsupported' }>): SyncEvidence {
  if (previous && previous.accountId !== batch.accountId) throw new Error('Foreign semantic evidence')
  if (batch.kind === 'snapshot') return {
    accountId: batch.accountId, position: batch.position, caughtUp: true, removals: [],
  }
  if (previous && BigInt(batch.through) <= BigInt(previous.position)) {
    // Empty poll at the same cursor can establish that the head was reached.
    if (batch.from === previous.position && batch.through === previous.position)
      return { ...previous, caughtUp: batch.head === batch.through }
    return previous
  }
  if (previous && batch.from !== previous.position) throw new Error('Non-contiguous semantic evidence')
  const removals = new Map((previous?.removals ?? []).map(row => [key(row.entity, row.entityId), row]))
  for (const event of batch.events) {
    const c = event.change
    const entityId = c.entity === 'list' ? c.listId : c.itemId
    const k = key(c.entity, entityId)
    if (c.entity === 'list' ? c.metadata !== null : c.item !== null) removals.delete(k)
    else removals.set(k, {
      position: event.position, entity: c.entity, listId: c.listId, entityId,
      ...(event.semantics ? { semantics: event.semantics } : {}),
    })
  }
  return { accountId: batch.accountId, position: batch.through,
    caughtUp: batch.head === batch.through, removals: [...removals.values()] }
}

export interface AvailableList { id: string; name: string; updatedAt?: number }
export interface ActiveSyncContext { accountId: string; listId: string | null; itemId?: string }
export interface ReconciledSyncContext {
  accountId: string
  /** True only after matching account data, including deferred operations, is reconciled. */
  ready: boolean
  lists: readonly AvailableList[]
  items: readonly { id: string; listId: string }[]
  /** Most recent activation first, scoped to the current profile. */
  activity: readonly string[]
}
export interface SyncNotice {
  position: string
  operationId: string
  entity: 'list' | 'item'
  sourceId: string
  sourceName: string
  reason: SyncReason
  targetListId?: string
  targetListName?: string
}
export type ContextFate =
  | { kind: 'wait' | 'unchanged' }
  | { kind: 'recover' | 'merge'; nextListId: string | null; resetViewport: boolean;
      notice?: SyncNotice; itemRemoval?: SyncNotice }

function byId(a: AvailableList, b: AvailableList) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0 }
/** Only used on lost context. Unknown activity timestamps never outrank known ones. */
export function chooseFallbackList(lists: readonly AvailableList[], activity: readonly string[]): string | null {
  const available = new Set(lists.map(list => list.id))
  const remembered = activity.find(id => available.has(id))
  if (remembered) return remembered
  const time = (list: AvailableList) => typeof list.updatedAt === 'number' && Number.isFinite(list.updatedAt)
    ? list.updatedAt : -Infinity
  return [...lists].sort((a, b) => {
    const x = time(a), y = time(b)
    return x === y ? byId(a, b) : x > y ? -1 : 1
  })[0]?.id ?? null
}
function notice(row: RemovalEvidence | undefined, ownOperations: ReadonlySet<string>,
  original?: RemovalEvidence): SyncNotice | undefined {
  if (!row?.semantics || ownOperations.has(row.semantics.operationId)) return undefined
  const s = row.semantics
  const source = original?.semantics ? original : row
  return { position: row.position, operationId: s.operationId, entity: source.entity,
    sourceId: source.entityId, sourceName: source.semantics!.sourceName, reason: s.reason,
    ...(s.reason === 'merged' ? { targetListId: s.targetListId, targetListName: s.targetListName } : {}) }
}

/**
 * Determine navigation and notice candidate from the final, confirmed state,
 * not a partial page or a server mask. No DOM, storage, account deletion,
 * or acknowledgement side effects. Stage 3 owns the presentation boundary:
 * before presentation re-evaluate from the original context; once shown,
 * freeze that notice and evaluate later events from its recipient context.
 */
export function resolveContextFate(
  context: ActiveSyncContext, state: ReconciledSyncContext, evidence: SyncEvidence,
  ownOperations: ReadonlySet<string> = new Set(),
): ContextFate {
  if (context.accountId !== state.accountId || context.accountId !== evidence.accountId)
    throw new Error('Foreign semantic context')
  if (!state.ready || !evidence.caughtUp) return { kind: 'wait' }
  if (context.listId === null) return { kind: 'unchanged' }
  const available = new Map(state.lists.map(list => [list.id, list]))
  const rows = new Map(evidence.removals.map(row => [key(row.entity, row.entityId), row]))
  const itemRow = context.itemId ? rows.get(key('item', context.itemId)) : undefined
  const itemRemoval = itemRow?.listId === context.listId ? notice(itemRow, ownOperations) : undefined
  if (available.has(context.listId)) {
    if (!context.itemId || state.items.some(item => item.id === context.itemId && item.listId === context.listId))
      return { kind: 'unchanged' }
    return { kind: 'recover', nextListId: context.listId, resetViewport: true,
      ...(itemRemoval ? { notice: itemRemoval } : {}) }
  }
  const recover = (n?: SyncNotice): ContextFate => ({
    kind: 'recover', nextListId: chooseFallbackList(state.lists, state.activity), resetViewport: true,
    ...(n ? { notice: n } : {}), ...(itemRemoval ? { itemRemoval } : {}),
  })
  const original = rows.get(key('list', context.listId))
  if (!original?.semantics) return recover()
  let current = original
  const visited = new Set([context.listId])
  while (current.semantics?.reason === 'merged') {
    const target = current.semantics.targetListId
    if (!target || visited.has(target)) return recover()
    visited.add(target)
    const live = available.get(target)
    if (live) {
      const candidate = notice(current, ownOperations, original)
      return { kind: 'merge', nextListId: live.id, resetViewport: false,
        ...(candidate ? { notice: { ...candidate, targetListId: live.id, targetListName: live.name } } : {}),
        ...(itemRemoval ? { itemRemoval } : {}) }
    }
    const next = rows.get(key('list', target))
    if (!next?.semantics || BigInt(next.position) <= BigInt(current.position)) return recover()
    current = next
  }
  return recover(notice(current, ownOperations, original))
}
