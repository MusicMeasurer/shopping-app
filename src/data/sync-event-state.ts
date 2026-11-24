import { accumulateSyncEvidence, chooseFallbackList, resolveContextFate, type ActiveSyncContext,
  type ContextFate, type ReconciledSyncContext, type SyncEvidence } from './sync-event-fate'
import type { SyncEventBatch } from './sync-event-feed'

export type SemanticBatch = Exclude<SyncEventBatch, { kind: 'unsupported' }>
type Recovery = Extract<ContextFate, { kind: 'recover' | 'merge' }>
export interface RecoveryCandidate { origin: ActiveSyncContext; fate: Recovery }
export interface AccountSemanticState {
  accountId: string
  activity: string[]
  context?: ActiveSyncContext
  evidence?: SyncEvidence
  batchThrough?: string
  observedHead?: string
  ready?: boolean
  pending?: RecoveryCandidate
  presented?: RecoveryCandidate
  own: { id: string; at: number }[]
}
export const newSemanticState = (accountId: string): AccountSemanticState => ({ accountId, activity: [], own: [] })
const ownRetention = 8 * 24 * 60 * 60 * 1000

export function rememberOwnOperation(state: AccountSemanticState, id: string, now = Date.now()): AccountSemanticState {
  return { ...state, own: [...state.own.filter(row => row.id !== id && now - row.at < ownRetention), { id, at: now }] }
}
export function rememberContext(state: AccountSemanticState, context: ActiveSyncContext): AccountSemanticState {
  if (context.accountId !== state.accountId) throw new Error('Foreign semantic context')
  // Existing UI may select a fallback automatically. Do not overwrite an
  // outstanding notice or the context of a partially received batch.
  if (state.presented || state.pending || (state.evidence && (!state.evidence.caughtUp || state.ready === false))) return state
  const changed = context.listId !== state.context?.listId || context.itemId !== state.context?.itemId
  if (!changed && state.activity[0] === context.listId) return state
  const activity = context.listId === null ? state.activity :
    [context.listId, ...state.activity.filter(id => id !== context.listId)]
  return { ...state, activity, context, ...(changed ? { pending: undefined, evidence: state.evidence
    ? { ...state.evidence, removals: [] } : undefined } : {}) }
}

/** Retain only causal paths relevant to the captured context or an outstanding
 * notice. No unbounded local copy of the server's history. */
export function relevantEvidence(state: AccountSemanticState, evidence: SyncEvidence): SyncEvidence {
  const roots = [state.context, state.pending?.origin, state.presented?.origin].filter(
    (x): x is ActiveSyncContext => !!x)
  const lists = new Set(roots.flatMap(x => x.listId ? [x.listId] : []))
  if (state.presented?.fate.notice?.targetListId) lists.add(state.presented.fate.notice.targetListId)
  if (state.pending?.fate.notice?.targetListId) lists.add(state.pending.fate.notice.targetListId)
  const byList = new Map(evidence.removals.filter(row => row.entity === 'list').map(row => [row.listId, row]))
  for (const listId of lists) {
    const target = byList.get(listId)?.semantics?.targetListId
    if (target) lists.add(target)
  }
  return { ...evidence, removals: evidence.removals.filter(row =>
    row.entity === 'list' ? lists.has(row.listId) : roots.some(root =>
      root.listId === row.listId && root.itemId === row.entityId)) }
}

export function storeSemanticBatch(state: AccountSemanticState, batch: SemanticBatch): AccountSemanticState {
  if (state.accountId !== batch.accountId) throw new Error('Foreign semantic batch')
  const before = state.evidence
  let evidence = accumulateSyncEvidence(before, batch)
  // A snapshot has no new causal history. Keep already received, unresolved
  // evidence; it is not reconstructed from the snapshot.
  if (batch.kind === 'snapshot' && before && (state.context || state.pending || state.presented)) {
    evidence = { ...evidence, removals: before.removals }
  }
  return { ...state, evidence: relevantEvidence(state, evidence),
    batchThrough: batch.kind === 'delta' ? batch.batchThrough : undefined,
    observedHead: batch.kind === 'delta' ? batch.head : undefined, ready: false }
}

export function evaluateSemanticState(state: AccountSemanticState, current: ReconciledSyncContext,
  ownPending: readonly string[] = [], now = Date.now()): AccountSemanticState {
  if (state.accountId !== current.accountId) throw new Error('Foreign semantic state')
  const own = state.own.filter(row => now - row.at < ownRetention)
  if (!state.evidence || !current.ready || !state.evidence.caughtUp) return { ...state, own, ready: false }
  const evidence = state.evidence
  state = { ...state, ready: true }
  const context = state.presented
    ? (state.presented.fate.kind === 'merge' && state.presented.fate.nextListId
      ? { accountId: state.accountId, listId: state.presented.fate.nextListId } : undefined)
    : state.context
  if (!context) return { ...state, own, pending: undefined }
  const fate = resolveContextFate(context, { ...current, activity: state.activity }, evidence,
    new Set([...own.map(row => row.id), ...ownPending]))
  if (fate.kind === 'wait') return { ...state, own }
  if (fate.kind === 'unchanged') return { ...state, own, pending: undefined }
  if (!('nextListId' in fate)) throw new Error('Invalid semantic recovery')
  return { ...state, own, pending: { origin: context, fate } }
}

export function noticeKey(candidate: RecoveryCandidate): string | undefined {
  const n = candidate.fate.notice
  return n ? JSON.stringify([n.position, n.operationId, n.entity, n.sourceId]) : undefined
}
export function presentSemanticNotice(state: AccountSemanticState, expectedKey: string): AccountSemanticState {
  if (state.presented) return state
  if (!state.pending || !expectedKey || noticeKey(state.pending) !== expectedKey || !state.evidence?.caughtUp || !state.ready) return state
  return { ...state, presented: state.pending, pending: undefined }
}

export type Acknowledgement =
  | { kind: 'ignored' | 'wait' }
  | { kind: 'next-notice' }
  | { kind: 'navigate'; nextListId: string | null; resetViewport: boolean }
export function acknowledgeSemanticNotice(state: AccountSemanticState, expectedKey: string,
  current: ReconciledSyncContext): { state: AccountSemanticState; result: Acknowledgement } {
  if (state.accountId !== current.accountId) throw new Error('Foreign semantic acknowledgement')
  const shown = state.presented
  if (!shown || !expectedKey || noticeKey(shown) !== expectedKey) return { state, result: { kind: 'ignored' } }
  if (!current.ready || !state.evidence?.caughtUp) return { state, result: { kind: 'wait' } }
  const available = new Set(current.lists.map(row => row.id))
  const next = state.pending
  if (shown.fate.kind === 'merge' && next?.fate.notice) {
    return { state: { ...state, context: next.origin, presented: undefined },
      result: { kind: 'next-notice' } }
  }
  const preferred = shown.fate.kind === 'merge' ? (next?.fate.nextListId ?? shown.fate.nextListId)
    : shown.fate.notice?.entity === 'item' ? shown.origin.listId : null
  const nextListId = preferred && available.has(preferred) ? preferred
    : chooseFallbackList(current.lists, state.activity)
  const resetViewport = shown.fate.kind !== 'merge' || !!next?.fate.resetViewport ||
    !shown.fate.nextListId || !available.has(shown.fate.nextListId)
  const updated = { ...state, context: { accountId: state.accountId, listId: nextListId },
    pending: undefined, presented: undefined, evidence: { ...state.evidence, removals: [] } }
  return { state: updated, result: { kind: 'navigate', nextListId, resetViewport } }
}

export function consumeSilentRecovery(state: AccountSemanticState, current: ReconciledSyncContext):
  { state: AccountSemanticState; result: Acknowledgement } {
  if (state.accountId !== current.accountId) throw new Error('Foreign semantic recovery')
  const pending = state.pending
  if (state.presented || !pending || pending.fate.notice) return { state, result: { kind: 'ignored' } }
  if (!current.ready || !state.evidence?.caughtUp) return { state, result: { kind: 'wait' } }
  const preferred = pending.fate.kind === 'merge' ? pending.fate.nextListId :
    current.lists.some(row => row.id === pending.origin.listId) ? pending.origin.listId : null
  const nextListId = preferred && current.lists.some(row => row.id === preferred) ? preferred :
    chooseFallbackList(current.lists, state.activity)
  return { state: { ...state, pending: undefined, context: { accountId: state.accountId, listId: nextListId },
    evidence: { ...state.evidence, removals: [] } },
    result: { kind: 'navigate', nextListId, resetViewport: pending.fate.resetViewport } }
}

export function semanticReady(state: AccountSemanticState, deferred: readonly { listId: string; entity: 'list' | 'item'; itemId?: string }[]): boolean {
  const context = state.presented?.fate.notice?.targetListId ?? state.context?.listId
  const relevant = new Set([context, state.context?.listId, ...(state.evidence?.removals.flatMap(row =>
    [row.listId, row.semantics?.targetListId]) ?? [])].filter((x): x is string => !!x))
  return !deferred.some(change => relevant.has(change.listId))
}
