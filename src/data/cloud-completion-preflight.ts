import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import type { ListId } from '../domain/shopping'
import { fetchRemoteItems } from './remote-snapshot'

/**
 * Read-only, fail-closed preflight for a future E4 cloud completion.
 * This does NOT authorize the completion: the server still checks revision.
 * Never use it to erase local items or acknowledge queued operations.
 */
export async function inspectCloudCompletion(
  storage: Pick<Storage, 'readAccountListMappings' | 'readAccountPending' | 'readAccountItems'>,
  client: Pick<SupabaseClient, 'from'>,
  accountId: string,
  localListId: ListId,
  remoteListId: string,
  isActive: () => boolean,
): Promise<{ ready: boolean; reason: string; revision: number | null }> {
  const blocked = (reason: string) => ({ ready: false, reason, revision: null })
  if (!isActive()) return blocked('Аккаунт изменился')
  const [mappings, pending, local] = await Promise.all([
    storage.readAccountListMappings(accountId),
    storage.readAccountPending(accountId),
    storage.readAccountItems(accountId),
  ])
  if (!isActive()) return blocked('Аккаунт изменился')
  if (!mappings.some(m => m.localListId === localListId && m.remoteListId === remoteListId))
    return blocked('Нет подтверждённой привязки списка')
  // Legacy deletes cannot be assigned to a list reliably. Fail closed.
  if (pending.some(p => p.kind === 'delete' ||
    (p.kind === 'upsert' && p.item.listId === localListId) ||
    (p.kind.startsWith('cloud-') && p.remoteListId === remoteListId)))
    return blocked('Есть неотправленные изменения')
  const { data, error } = await client.from('shopping_lists')
    .select('id,owner_id,revision,deleted_at')
    .eq('id', remoteListId)
    .eq('owner_id', accountId)
    .is('deleted_at', null)
  if (error || !Array.isArray(data) || data.length !== 1) return blocked('Облачный список недоступен')
  const row = data[0] as Record<string, unknown>
  if (row.id !== remoteListId || row.owner_id !== accountId ||
      !Number.isSafeInteger(row.revision) || (row.revision as number) < 0)
    return blocked('Неверная ревизия облачного списка')
  const remote = await fetchRemoteItems(client, remoteListId)
  if (!isActive()) return blocked('Аккаунт изменился')
  const localItems = local.filter(item => item.listId === localListId)
  if (remote.length === 0) return blocked('Пустой облачный список')
  // A cloud-only item or an unmatched local item must be reconciled before
  // completion. Compare purchase flags and names, not only item counts.
  const remoteById = new Map(remote.map(item => [item.id, item]))
  if (remoteById.size !== remote.length || localItems.length !== remote.length ||
      localItems.some(item => {
        const r = remoteById.get(item.id)
        return !r || r.name !== item.name || r.purchased !== item.purchased
      })) return blocked('Локальный и облачный списки расходятся')
  // Recheck revision after remote item read; a concurrent server mutation
  // is still possible and will be rejected by the completion RPC.
  const { data: latest, error: latestError } = await client.from('shopping_lists')
    .select('id,owner_id,revision,deleted_at')
    .eq('id', remoteListId)
    .eq('owner_id', accountId)
    .is('deleted_at', null)
  if (latestError || !Array.isArray(latest) || latest.length !== 1 ||
      latest[0].revision !== row.revision || !isActive())
    return blocked('Облачный список изменился во время проверки')
  return { ready: true, reason: '', revision: row.revision as number }
}
