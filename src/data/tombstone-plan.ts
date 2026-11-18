import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'
import type { RemoteTombstone } from './remote-snapshot'

/**
 * Read-only deletion review. A server tombstone is not permission to delete
 * local work: both pending changes and stale confirmed versions need review.
 */
export function planTombstones(
  local: readonly Item[],
  tombstones: readonly RemoteTombstone[],
  pending: readonly PendingItemOperation[],
): { localCandidates: string[]; pendingConflicts: string[] } {
  const ids = new Set<string>()
  const localIds = new Set(local.map(item => item.id))
  const pendingIds = new Set(pending.map(op =>
    op.kind === 'delete' || op.kind === 'cloud-delete' ? op.itemId : op.item.id))
  const localCandidates: string[] = []
  const pendingConflicts: string[] = []
  for (const tombstone of tombstones) {
    if (ids.has(tombstone.id)) throw new Error('Duplicate remote tombstones')
    ids.add(tombstone.id)
    if (!localIds.has(tombstone.id) && !pendingIds.has(tombstone.id)) continue
    if (pendingIds.has(tombstone.id)) pendingConflicts.push(tombstone.id)
    else localCandidates.push(tombstone.id)
  }
  return { localCandidates, pendingConflicts }
}
