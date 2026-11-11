import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'
import type { RemoteItem, fetchRemoteItems } from './remote-snapshot'
import type { RemoteMutation, RemoteMutationReceipt, applyRemoteMutation } from './remote-mutation'
import { drainConfirmedQueue } from './confirmed-queue'
import { planReconciliation } from './reconciliation-plan'

type ReadRemote = typeof fetchRemoteItems
type SendRemote = typeof applyRemoteMutation

/**
 * Headless sync coordinator. Does not mutate local item snapshots: the caller
 * must explicitly persist a reviewed reconciliation plan. The queue is scoped
 * to the verified account and drained only while that account stays active.
 */
export interface SyncDependencies {
  accountId: string
  listId: string
  isActive: () => boolean
  readLocal: () => Promise<Item[]>
  readPending: () => Promise<PendingItemOperation[]>
  acknowledge: (operationId: string) => Promise<void>
  commitReceipt?: (mutation: RemoteMutation, receipt: RemoteMutationReceipt) => Promise<void>
  fetch: () => ReturnType<ReadRemote>
  send: (mutation: RemoteMutation) => ReturnType<SendRemote>
  resolveMutation: (operation: PendingItemOperation) => RemoteMutation
}

export interface SyncPreview {
  visible: Item[]
  remoteOnly: Item[]
  conflicts: string[]
  pendingCount: number
}

function asLocalItem(remote: RemoteItem, resolveList: (remoteListId: string) => Item['listId']): Item {
  return {
    id: remote.id,
    listId: resolveList(remote.listId),
    name: remote.name,
    purchased: remote.purchased,
    createdAt: Date.parse(remote.createdAt),
  }
}

export function createSyncCoordinator(
  dependencies: SyncDependencies,
  resolveList: (remoteListId: string) => Item['listId'],
) {
  if (!dependencies.accountId.trim() || !dependencies.listId.trim()) {
    throw new Error('Verified account and remote list are required')
  }
  let running = false
  function assertActive() {
    if (!dependencies.isActive()) throw new Error('Account changed during synchronization')
  }
  return {
    async preview(): Promise<SyncPreview> {
      assertActive()
      const [local, pending, remote] = await Promise.all([
        dependencies.readLocal(), dependencies.readPending(), dependencies.fetch(),
      ])
      assertActive()
      const plan = planReconciliation(local, remote.map(item => asLocalItem(item, resolveList)), pending)
      return { ...plan, pendingCount: pending.length }
    },
    async flush(): Promise<number> {
      if (running) throw new Error('Synchronization already running')
      assertActive()
      running = true
      try {
        const confirmed = new Map<string, { mutation: RemoteMutation; receipt: RemoteMutationReceipt }>()
        return await drainConfirmedQueue(
          dependencies.readPending,
          async operation => {
            assertActive()
            const mutation = dependencies.resolveMutation(operation)
            if (mutation.operationId !== operation.operationId || mutation.listId !== dependencies.listId) {
              throw new Error('Operation is not bound to the active list')
            }
            const receipt = await dependencies.send(mutation)
            if (receipt.operationId !== mutation.operationId) throw new Error('Server receipt operation mismatch')
            confirmed.set(operation.operationId, { mutation, receipt })
          },
          async operationId => {
            const result = confirmed.get(operationId)
            if (!result) throw new Error('Missing confirmed server receipt')
            if (dependencies.commitReceipt) {
              await dependencies.commitReceipt(result.mutation, result.receipt)
            } else {
              await dependencies.acknowledge(operationId)
            }
            confirmed.delete(operationId)
          },
          dependencies.isActive,
        )
      } finally {
        running = false
      }
    },
  }
}
