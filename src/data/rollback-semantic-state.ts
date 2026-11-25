import type { AccountFeedChange } from './account-feed'
import type { AccountSemanticState } from './sync-event-state'

const entityKey = (entity: 'list' | 'item', id: string) => entity + ':' + id

/** A compatibility bridge for the emergency legacy UI/feed. Retain previously
 * received notices and their verified evidence; v1 cannot prove new causes.
 * Never synthesize semantic history or declare a v2 batch complete. */
export function suspendRollbackSemantics(state: AccountSemanticState, expected: string | undefined,
  position: string, changes: readonly AccountFeedChange[]): AccountSemanticState {
  const previous = state.evidence
  const retain = !!(state.pending || state.presented || previous?.removals.length)
  if (!retain) {
    if (!state.context && !previous && !state.batchThrough && !state.observedHead && !state.ready) return state
    return { ...state, context: undefined, evidence: undefined, batchThrough: undefined, observedHead: undefined, ready: false }
  }
  const trusted = previous?.accountId === state.accountId && previous.position === expected ? previous : undefined
  const changed = new Set(changes.map(change => entityKey(change.entity,
    change.entity === 'list' ? change.listId : change.itemId)))
  const removals = trusted?.removals.filter(row => !changed.has(entityKey(row.entity, row.entityId)))
  if (trusted && trusted.position === position && !trusted.caughtUp && removals?.length === trusted.removals.length &&
      !state.ready && !state.batchThrough && !state.observedHead) return state
  return { ...state, evidence: trusted ? { ...trusted, position, caughtUp: false, removals: removals! } : undefined,
    batchThrough: undefined, observedHead: undefined, ready: false }
}
