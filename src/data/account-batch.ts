import type { SupabaseClient } from '@supabase/supabase-js'
import { createAccountSync, serializeAccountItemFlush } from './account-sync'
import type { CloudPendingOperation } from './pending-operations'
import { parseRemoteMutationReceipt, type RemoteMutation } from './remote-mutation'
import type { Storage } from './storage'
import { syncLedger } from './list-sync-ledger'
import { resolveVersionedMutation } from './versioned-mutation'

function payload(mutation: RemoteMutation) {
  return {
    operation_id: mutation.operationId, item_id: mutation.itemId, list_id: mutation.listId, kind: mutation.kind,
    ...(mutation.kind !== 'add' ? { expected_version: mutation.expectedVersion } : {}),
    ...(mutation.kind !== 'delete' ? {
      name: mutation.name, purchased: mutation.purchased,
      ...(mutation.attributes ? { quantity: mutation.attributes.quantity, unit: mutation.attributes.unit } : {}),
    } : {}),
    ...(mutation.kind === 'add' && mutation.createdAt !== undefined
      ? { created_at: new Date(mutation.createdAt).toISOString() } : {}),
  }
}

/** Keep dependent edits to one item in separate waves. Independent items get individual receipts. */
export function flushAccountBatch(
  storage: Storage, client: SupabaseClient, accountId: string, isActive: () => boolean, onReconciled: () => void,
  onlyListId?: string,
) {
  return serializeAccountItemFlush(storage, accountId, async () => {
    const ledger = syncLedger(storage)
    const blocked = new Set<string>()
    const reconciled = new Set<string>()
    let failure: Error | undefined
    while (isActive()) {
      const pending = await storage.readSyncableAccountPending(accountId)
      if (!isActive()) return
      const items = new Set<string>()
      const batch: CloudPendingOperation[] = []
      for (const operation of pending) {
        if (onlyListId && (!('localListId' in operation) || operation.localListId !== onlyListId)) continue
        if (operation.kind === 'upsert' || operation.kind === 'delete') {
          failure ??= new Error('Legacy operation requires explicit reconciliation before cloud upload')
          continue
        }
        if (items.has(operation.itemId) || blocked.has(operation.itemId)) continue
        items.add(operation.itemId)
        batch.push(operation)
        if (batch.length === 50) break
      }
      if (!batch.length) break
      const claimed = await Promise.all(batch.map(operation => storage.claimAccountPending(accountId, operation.operationId)))
      if (!isActive()) return
      const mutations = claimed.map(resolveVersionedMutation)
      const unresolved = new Set(batch.map(op => op.operationId))
      for (const op of batch) ledger?.begin(accountId, op.operationId, [op.localListId], 'items')
      try {
      const { data, error } = await client.rpc('push_e4_account_changes', { p_account: accountId, p_operations: mutations.map(payload) })
      if (!isActive()) return
      if (error) throw error
      if (!Array.isArray(data) || data.length !== mutations.length) throw new Error('Invalid operation batch response')
      for (const [index, mutation] of mutations.entries()) {
        if (!isActive()) return
        const outcome = data[index]
        if (outcome?.receipt !== undefined) {
          const receipt = parseRemoteMutationReceipt(outcome.receipt, mutation.operationId)
          await storage.commitAccountReceipt(accountId, receipt.operationId, mutation.listId, mutation.itemId, receipt.itemVersion)
          unresolved.delete(mutation.operationId)
          continue
        }
        if (outcome?.operation_id !== mutation.operationId || typeof outcome.message !== 'string')
          throw new Error('Batch outcome does not match the operation')
        const operation = batch[index]
        const sync = createAccountSync(storage, client, {
          accountId, isActive, localListId: operation.localListId, remoteListId: operation.remoteListId, onReconciled,
        })
        if (!reconciled.has(mutation.itemId) && await sync.handleRejected(claimed[index], outcome)) {
          reconciled.add(mutation.itemId)
          unresolved.delete(mutation.operationId)
        } else {
          blocked.add(mutation.itemId)
          ledger?.fail(accountId, mutation.operationId)
          unresolved.delete(mutation.operationId)
          failure ??= new Error(outcome.message)
        }
      }
      } catch (error) {
        for (const id of unresolved) if (isActive()) ledger?.fail(accountId, id)
        throw error
      } finally {
        if (!isActive()) for (const id of unresolved) ledger?.cancel(accountId, id)
      }
    }
    if (failure) throw failure
  })
}
