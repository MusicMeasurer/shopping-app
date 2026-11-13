import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage, CloudCompletionIntent } from './storage'
import type { ListId } from '../domain/shopping'
import { inspectCloudCompletion } from './cloud-completion-preflight'
import { sendCloudCompletion, type CompletionMode, type CompletionReceipt } from './cloud-completion-rpc'

/**
 * Durable completion protocol. A committed server receipt can be recovered
 * after a crash by replaying the SAME operation UUID; no new operation is
 * generated on retry. The account fence is checked at every async boundary.
 */
export function createCloudCompletionCoordinator(
  storage: Pick<Storage, 'beginAccountCompletion' | 'readAccountCompletions' | 'commitAccountCompletion' |
    'readAccountItems' | 'readAccountPending' | 'readAccountListMappings' | 'discardRejectedDeletion'>,
  client: Pick<SupabaseClient, 'rpc' | 'from'>,
  accountId: string,
  isActive: () => boolean,
) {
  function assertActive() {
    if (!isActive()) throw new Error('Account changed during completion')
  }
  async function resume(intent: CloudCompletionIntent): Promise<CompletionReceipt> {
    assertActive()
    if (intent.accountId !== accountId) throw new Error('Foreign account completion')
    const pending = await storage.readAccountCompletions(accountId)
    assertActive()
    if (!pending.some(row => JSON.stringify(row) === JSON.stringify(intent)))
      throw new Error('Missing durable completion intent')
    let receipt: CompletionReceipt
    try {
      receipt = await sendCloudCompletion(client, {
        operationId: intent.operationId, listId: intent.remoteListId,
        expectedRevision: intent.expectedRevision, mode: intent.mode,
      })
    } catch (error) {
      // Only explicit server rejections prove that there is no committed deletion to recover.
      if (intent.mode === 'delete_list' && isActive() && error && typeof error === 'object' &&
          'code' in error && error.code === 'P0001' && 'message' in error &&
          (error.message === 'List revision conflict' || error.message === 'List unavailable'))
        await storage.discardRejectedDeletion(intent)
      throw error
    }
    assertActive()
    if (receipt.itemCount !== intent.itemIds.length) throw new Error('Server receipt item count mismatch')
    // Never invent deleted-item versions. Re-read the server's tombstones
    // after a confirmed receipt and require exactly the intended item IDs.
    // Normal item RLS hides tombstones once a one-off list is completed.
    // Use the owner-and-operation-scoped receipt RPC instead.
    const { data: tombstoneRows, error: tombstoneError } = await client.rpc(
      'read_e4_completion_tombstones', { p_operation: intent.operationId })
    if (tombstoneError || !Array.isArray(tombstoneRows))
      throw new Error('Receipt-scoped tombstone verification unavailable; completion retained for retry')
    const tombstones = tombstoneRows.map((row: Record<string, unknown>) => {
      if (typeof row.id !== 'string' || row.list_id !== intent.remoteListId ||
          !Number.isSafeInteger(row.version) || typeof row.deleted_at !== 'string' ||
          !Number.isFinite(Date.parse(row.deleted_at)))
        throw new Error('Invalid receipt-scoped tombstone')
      return { id: row.id, listId: row.list_id, version: row.version as number,
        deletedAt: row.deleted_at }
    })
    assertActive()
    const relevant = tombstones.filter(row => intent.itemIds.includes(row.id))
    if (relevant.length !== intent.itemIds.length ||
        new Set(relevant.map(row => row.id)).size !== intent.itemIds.length)
      throw new Error('Confirmed server tombstones incomplete; completion retained for retry')
    // A local crash before this atomic commit leaves the intent to replay.
    await storage.commitAccountCompletion(intent, receipt.revision, relevant)
    return receipt
  }
  async function begin(localListId: ListId, remoteListId: string, mode: CompletionMode, confirmedMarked?: boolean) {
    assertActive()
    if ((await storage.readAccountCompletions(accountId)).some(row => row.remoteListId === remoteListId))
      throw new Error('Finish recovering the previous completion first')
    const preflight = await inspectCloudCompletion(storage, client, accountId,
      localListId, remoteListId, isActive, mode === 'delete_list')
    assertActive()
    if (!preflight.ready || preflight.revision === null) throw new Error(preflight.reason)
    const items = (await storage.readAccountItems(accountId)).filter(item => item.listId === localListId)
    assertActive()
    if (mode === 'delete_list' && items.some(item => item.purchased) !== confirmedMarked)
      throw new Error('Отметки изменились. Проверьте список и подтвердите удаление заново.')
    const intent: CloudCompletionIntent = {
      operationId: crypto.randomUUID(), accountId, localListId, remoteListId,
      expectedRevision: preflight.revision, mode,
      itemIds: items.map(item => item.id).sort(), createdAt: Date.now(),
    }
    await storage.beginAccountCompletion(intent)
    return resume(intent)
  }
  async function recoverAll(): Promise<CompletionReceipt[]> {
    assertActive()
    const intents = await storage.readAccountCompletions(accountId)
    const receipts: CompletionReceipt[] = []
    for (const intent of intents) receipts.push(await resume(intent))
    return receipts
  }
  return { begin, resume, recoverAll }
}
