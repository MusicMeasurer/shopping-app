import { markSync, traceSync } from './sync-diagnostics'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAccountSync, serializeAccountItemFlush } from './account-sync'
import { PendingOperationMissingError, type CloudPendingOperation } from './pending-operations'
import { parseRemoteMutationReceipt, remoteMutationPayload } from './remote-mutation'
import type { Storage } from './storage'
import { syncLedger } from './list-sync-ledger'
import { resolveVersionedMutation } from './versioned-mutation'
import { flushItemCancellations } from './item-cancellation'


/** Keep dependent edits to one item in separate waves. Independent items get individual receipts. */
export function flushAccountBatch(
  storage: Storage, client: SupabaseClient, accountId: string, isActive: () => boolean, onReconciled: () => void,
  onlyListId?: string, onlyItemId?: string,
) {
  return serializeAccountItemFlush(storage, accountId, async () => {
    const ledger = syncLedger(storage)
    const blocked = new Set<string>()
    const reconciled = new Set<string>()
    let failure: unknown = await flushItemCancellations(storage,client,accountId,isActive,onReconciled,onlyListId,onlyItemId)
    while (isActive()) {
      const pending = await storage.readSyncableAccountPending(accountId)
      markSync('queue', 'ok', { count: pending.length })
      if (!isActive()) return
      const items = new Set<string>()
      const batch: CloudPendingOperation[] = []
      for (const operation of pending) {
        if (onlyListId && (!('localListId' in operation) || operation.localListId !== onlyListId)) continue
        if (operation.kind === 'upsert' || operation.kind === 'delete') {
          failure ??= new Error('Legacy operation requires explicit reconciliation before cloud upload')
          continue
        }
        if (onlyItemId && operation.itemId !== onlyItemId) continue
        if (items.has(operation.itemId) || blocked.has(operation.itemId)) continue
        items.add(operation.itemId)
        batch.push(operation)
        if (batch.length === 50) break
      }
      if (!batch.length) break
      const claims = await traceSync('batch-claim', () => Promise.all(batch.map(async operation => {
        try { return await storage.claimAccountPending(accountId, operation.operationId) }
        catch (error) { if (error instanceof PendingOperationMissingError) return undefined; throw error }
      })), { count: batch.length })
      if (!isActive()) return
      const claimed = claims.filter((op): op is CloudPendingOperation =>
        op !== undefined && op.kind !== 'upsert' && op.kind !== 'delete')
      if (!claimed.length) continue
      const mutations = claimed.map(resolveVersionedMutation)
      const unresolved = new Set(claimed.map(op => op.operationId))
      for (const op of claimed) ledger?.begin(accountId, op.operationId, [op.localListId], 'items', true, undefined, [op.itemId])
      try {
      const { data, error } = await traceSync('batch-send', () => client.rpc('push_e4_account_changes', { p_account: accountId, p_operations: mutations.map(remoteMutationPayload) }), { count: mutations.length }, result => !result.error)
      if (!isActive()) return
      if (error) throw error
      if (!Array.isArray(data) || data.length !== mutations.length) {
        markSync('receipt-validate', 'rejected')
        throw new Error('Invalid operation batch response')
      }
      for (const [index, mutation] of mutations.entries()) {
        if (!isActive()) return
        const outcome = data[index]
        if (outcome?.receipt !== undefined) {
          const receipt = await traceSync('receipt-validate', async () => parseRemoteMutationReceipt(outcome.receipt, mutation.operationId))
          await traceSync('receipt-store', () => storage.commitAccountReceipt(accountId, receipt.operationId, mutation.listId, mutation.itemId, receipt.itemVersion))
          unresolved.delete(mutation.operationId)
          continue
        }
        if (outcome?.operation_id !== mutation.operationId || typeof outcome.message !== 'string')
          throw new Error('Batch outcome does not match the operation')
        markSync('batch-rejected', 'rejected')
        const operation = claimed[index]
        const sync = createAccountSync(storage, client, {
          accountId, isActive, localListId: operation.localListId, remoteListId: operation.remoteListId, onReconciled,
        })
        if (!reconciled.has(mutation.itemId) && await sync.handleRejected(claimed[index], outcome)) {
          reconciled.add(mutation.itemId)
          unresolved.delete(mutation.operationId)
        } else {
          blocked.add(mutation.itemId)
          await storage.markAccountItemSyncFailed(accountId, mutation.operationId)
          unresolved.delete(mutation.operationId)
          failure ??= new Error(outcome.message)
        }
      }
      } catch (error) {
        for (const id of unresolved) if (isActive()) {
          try { await storage.markAccountItemSyncFailed(accountId,id) } catch { ledger?.fail(accountId,id) }
        }
        throw error
      } finally {
        if (!isActive()) for (const id of unresolved) ledger?.cancel(accountId, id)
      }
    }
    if (failure) throw failure
  })
}
