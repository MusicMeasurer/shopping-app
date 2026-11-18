import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import type { ListId } from '../domain/shopping'
import { fetchOwnedCloudLists } from './owned-cloud-lists'

/**
 * Explicitly bind a local list to a server-owned list selected by ID.
 * Discovery is read-only; this function never imports guest items or
 * guesses identity from display names.
 */
export async function bindVerifiedOwnedList(
  storage: Pick<Storage, 'readAccountListMappings' | 'bindAccountList'>,
  client: Pick<SupabaseClient, 'from'>,
  accountId: string,
  localListId: ListId,
  remoteListId: string,
  isActive: () => boolean,
): Promise<void> {
  if (!isActive()) throw new Error('Account changed before list binding')
  const existing = await storage.readAccountListMappings(accountId)
  if (!isActive()) throw new Error('Account changed during list binding')
  const bound = existing.find(row => row.localListId === localListId)
  if (bound && bound.remoteListId !== remoteListId) {
    throw new Error('List is already bound to another cloud list')
  }
  const owned = await fetchOwnedCloudLists(client, accountId)
  if (!isActive()) throw new Error('Account changed during list binding')
  if (!owned.some(list => list.id === remoteListId)) {
    throw new Error('Selected cloud list is not owned by the verified account')
  }
  await storage.bindAccountList(accountId, localListId, remoteListId)
}
