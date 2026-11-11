import type { PendingItemOperation } from './pending-operations'
import type { RemoteMutation } from './remote-mutation'

/** Never guess whether a legacy upsert was an add or an update. */
export function resolveVersionedMutation(operation: PendingItemOperation): RemoteMutation {
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
