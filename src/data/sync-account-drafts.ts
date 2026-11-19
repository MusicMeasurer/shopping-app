import type { SupabaseClient } from '@supabase/supabase-js'
import { createCloudList } from './e4-cloud-list-create'
import type { CloudListMetadata } from './e4-cloud-list-metadata'
import type { Storage } from './storage'

export async function syncAccountDrafts(storage: Storage, client: Pick<SupabaseClient, 'rpc'>, accountId: string,
  isActive: () => boolean, attempted = new Set<string>()) {
  const promoted: { draftId: string; localListId: string; remote: CloudListMetadata }[] = []
  let failed = false
  let nameConflict = false
  for (const draft of await storage.readAccountDraftLists(accountId)) {
    if (!isActive()) break
    if (draft.nameConflict || attempted.has(draft.operationId)) continue
    attempted.add(draft.operationId)
    try {
      const remote = await createCloudList(client, accountId, draft.operationId, draft.name, draft.kind)
      if (!isActive()) break
      const localListId = await storage.promoteAccountDraft(draft, remote)
      if (localListId) promoted.push({ draftId: draft.id, localListId, remote })
    } catch (error) {
      if (!isActive()) break
      if ((error as { code?: string })?.code === '23505') {
        nameConflict = await storage.markAccountDraftNameConflict(draft) || nameConflict
      } else {
        // Preserve the attempt ID and payload. A network error may hide a receipt.
        failed = true
      }
    }
  }
  return { promoted, failed, nameConflict }
}
