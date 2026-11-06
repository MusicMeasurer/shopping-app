import type { Item } from '../domain/shopping'

/** Stable operation IDs allow retries without creating duplicate remote changes. */
export type PendingItemOperation =
  | { operationId: string; kind: 'upsert'; item: Item }
  | { operationId: string; kind: 'delete'; itemId: string }

export function enqueueOperation(
  queue: readonly PendingItemOperation[],
  operation: PendingItemOperation,
): PendingItemOperation[] {
  const existing = queue.find(entry => entry.operationId === operation.operationId)
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(operation)) {
      throw new Error('Operation ID collision with different payload')
    }
    return [...queue]
  }
  return [...queue, operation]
}

/** Acknowledge only the operation confirmed by the server, not the whole queue. */
export function acknowledgeOperation(
  queue: readonly PendingItemOperation[],
  operationId: string,
): PendingItemOperation[] {
  return queue.filter(entry => entry.operationId !== operationId)
}
