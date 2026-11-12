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
    'readAccountItems' | 'readAccountPending' | 'readAccountListMappings'>,
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
    const receipt = await sendCloudCompletion(client, {
      operationId: intent.operationId, listId: intent.remoteListId,
      expectedRevision: intent.expectedRevision, mode: intent.mode,
    })
    assertActive()
    // A local crash before this atomic commit leaves the intent to replay.
    await storage.commitAccountCompletion(intent, receipt.revision)
    return receipt
  }
  async function begin(localListId: ListId, remoteListId: string, mode: CompletionMode) {
    assertActive()
    if ((await storage.readAccountCompletions(accountId)).some(row => row.remoteListId === remoteListId))
      throw new Error('Finish recovering the previous completion first')
    const preflight = await inspectCloudCompletion(storage, client, accountId,
      localListId, remoteListId, isActive)
    assertActive()
    if (!preflight.ready || preflight.revision === null) throw new Error(preflight.reason)
    const items = (await storage.readAccountItems(accountId)).filter(item => item.listId === localListId)
    assertActive()
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
