import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'
import type { RemoteTombstone } from './remote-snapshot'

export interface KnownItemVersion { itemId: string; remoteListId: string; version: number }

/** Read-only classification. No local records are deleted by this planner. */
export function planVersionedTombstones(
  local: readonly Item[],
  versions: readonly KnownItemVersion[],
  tombstones: readonly RemoteTombstone[],
  pending: readonly PendingItemOperation[],
  remoteListId: string,
): { confirmedDeletions: string[]; conflicts: string[]; unknownVersions: string[] } {
  const localById = new Map(local.map(item => [item.id, item]))
  const versionsById = new Map(versions.map(row => [row.itemId, row]))
  if (localById.size !== local.length || versionsById.size !== versions.length) {
    throw new Error('Duplicate local item or version')
  }
  const pendingIds = new Set(pending.map(op =>
    op.kind === 'delete' || op.kind === 'cloud-delete' ? op.itemId : op.item.id))
  const seen = new Set<string>()
  const confirmedDeletions: string[] = []
  const conflicts: string[] = []
  const unknownVersions: string[] = []
  for (const tombstone of tombstones) {
    if (seen.has(tombstone.id)) throw new Error('Duplicate remote tombstone')
    seen.add(tombstone.id)
    if (tombstone.listId !== remoteListId) throw new Error('Tombstone list mismatch')
    const item = localById.get(tombstone.id)
    if (!item && !pendingIds.has(tombstone.id)) continue
    const known = versionsById.get(tombstone.id)
    if (pendingIds.has(tombstone.id) || (known && known.remoteListId !== remoteListId) ||
        (known && known.version > tombstone.version)) {
      conflicts.push(tombstone.id)
    } else if (!known) {
      unknownVersions.push(tombstone.id)
    } else if (item) {
      // Version evidence alone is insufficient to prove the local item was
      // never edited outside the durable queue. Review before applying.
      confirmedDeletions.push(tombstone.id)
    }
  }
  return { confirmedDeletions, conflicts, unknownVersions }
}
