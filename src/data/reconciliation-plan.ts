import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'

/**
 * Conservative reconciliation. Pending local changes always win in the
 * displayed working copy; remote data is never written into IndexedDB here.
 * A separate, explicit commit stage is required before persistence.
 */
export interface ReconciliationPlan {
  visible: Item[]
  remoteOnly: Item[]
  conflicts: string[]
}

export function planReconciliation(
  local: readonly Item[],
  remote: readonly Item[],
  pending: readonly PendingItemOperation[],
): ReconciliationPlan {
  const localById = new Map(local.map(item => [item.id, item]))
  const remoteById = new Map(remote.map(item => [item.id, item]))
  if (localById.size !== local.length || remoteById.size !== remote.length) {
    throw new Error('Duplicate item IDs in reconciliation snapshot')
  }
  const touched = new Set<string>()
  const deleted = new Set<string>()
  for (const operation of pending) {
    const id = operation.kind === 'delete' || operation.kind === 'cloud-delete' ? operation.itemId : operation.item.id
    touched.add(id)
    if (operation.kind === 'delete' || operation.kind === 'cloud-delete') deleted.add(id)
    else deleted.delete(id)
  }
  const visible = new Map(localById)
  const remoteOnly: Item[] = []
  const conflicts: string[] = []
  for (const item of remote) {
    if (touched.has(item.id)) {
      if (localById.has(item.id) || deleted.has(item.id)) conflicts.push(item.id)
      continue
    }
    if (!localById.has(item.id)) {
      visible.set(item.id, item)
      remoteOnly.push(item)
    } else {
      const current = localById.get(item.id)!
      if (current.listId !== item.listId ||
          current.name !== item.name || current.purchased !== item.purchased ||
          current.quantity !== item.quantity || current.unit !== item.unit) {
        // Without a server version for the local copy, overwrite is unsafe.
        conflicts.push(item.id)
      }
    }
  }
  for (const id of deleted) visible.delete(id)
  return { visible: [...visible.values()], remoteOnly, conflicts: [...new Set(conflicts)] }
}
