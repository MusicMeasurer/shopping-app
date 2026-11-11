import type { PendingItemOperation } from './pending-operations'
import type { RemoteMutation } from './remote-mutation'

/** Never guess whether a legacy upsert was an add or an update. */
export function resolveVersionedMutation(operation: PendingItemOperation): RemoteMutation {
  // Previously persisted offline operations can predate the UI-side guard.
  // Do not silently upload only name/purchased and acknowledge lost E4 fields.
  if ((operation.kind === 'cloud-add' || operation.kind === 'cloud-update') &&
      (operation.item.quantity !== undefined ||
        (operation.item.unit !== undefined && operation.item.unit.trim() !== ''))) {
    throw new Error('Queued E4 quantity/unit edit requires a versioned cloud contract')
  }
  switch (operation.kind) {
    case 'cloud-add':
      return {
        kind: 'add', operationId: operation.operationId, listId: operation.remoteListId,
        itemId: operation.itemId, name: operation.item.name, purchased: operation.item.purchased,
      }
    case 'cloud-update':
      return {
        kind: 'update', operationId: operation.operationId, listId: operation.remoteListId,
        itemId: operation.itemId, expectedVersion: operation.expectedVersion,
        name: operation.item.name, purchased: operation.item.purchased,
      }
    case 'cloud-delete':
      return {
        kind: 'delete', operationId: operation.operationId, listId: operation.remoteListId,
        itemId: operation.itemId, expectedVersion: operation.expectedVersion,
      }
    default:
      throw new Error('Legacy operation requires explicit reconciliation before cloud upload')
  }
}
