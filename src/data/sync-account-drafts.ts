import type { SupabaseClient } from '@supabase/supabase-js'
import { createCloudList } from './e4-cloud-list-create'
import type { CloudListMetadata } from './e4-cloud-list-metadata'
import type { Storage } from './storage'

export async function syncAccountDrafts(storage: Storage, client: Pick<SupabaseClient, 'rpc'>, accountId: string,
  isActive: () => boolean, attempted = new Set<string>(), onlyListId?: string) {
  const promoted: { draftId: string; localListId: string; remote: CloudListMetadata }[] = []
  let failed = false
  let nameConflict = false
  for (const draft of await storage.readAccountDraftLists(accountId)) {
    if (!isActive()) break
    if ((onlyListId && draft.id !== onlyListId) || draft.nameConflict || attempted.has(draft.operationId)) continue
    attempted.add(draft.operationId)
    try {
      storage.listSyncLedger?.begin(accountId, draft.operationId, [draft.id], 'lists')
      const remote = await createCloudList(client, accountId, draft.operationId, draft.name, draft.kind)
      if (!isActive()) break
      const localListId = await storage.promoteAccountDraft(draft, remote)
      if (localListId) {
        storage.listSyncLedger?.confirm(accountId, draft.operationId, [localListId])
        promoted.push({ draftId: draft.id, localListId, remote })
      } else storage.listSyncLedger?.cancel(accountId, draft.operationId)
    } catch (error) {
      if (!isActive()) break
      if ((error as { code?: string })?.code === '23505') {
        nameConflict = await storage.markAccountDraftNameConflict(draft) || nameConflict
        storage.listSyncLedger?.cancel(accountId, draft.operationId)
        storage.listSyncLedger?.changed()
      } else {
        // Preserve the attempt ID and payload. A network error may hide a receipt.
        failed = true
        storage.listSyncLedger?.fail(accountId, draft.operationId)
      }
    } finally { if (!isActive()) storage.listSyncLedger?.cancel(accountId, draft.operationId) }
  }
  return { promoted, failed, nameConflict }
}
