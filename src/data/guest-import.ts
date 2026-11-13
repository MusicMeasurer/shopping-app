import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import { fetchCloudListMetadata } from './e4-cloud-list-metadata'
import { fetchRemoteItems } from './remote-snapshot'

export async function syncGuestImports(
  storage: Storage, client: SupabaseClient, accountId: string, isActive: () => Promise<boolean>,
) {
  for (const batch of await storage.readGuestImports(accountId)) {
    if (!await isActive()) return
    const { data, error } = await client.rpc('import_e4_guest_profile', {
      p_operation: batch.operationId,
      p_account: accountId,
      p_snapshot: { lists: batch.lists, items: batch.items, archives: batch.archives },
    })
    if (error) throw error
    if (!await isActive()) return
    const ids = batch.lists.map(list => data?.lists?.[list.id])
    if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length)
      throw new Error('Unconfirmed guest import')
    const lists = (await fetchCloudListMetadata(client, accountId)).filter(list => ids.includes(list.id))
    const items = (await Promise.all(lists.map(list => fetchRemoteItems(client, list.id)))).flat()
    if (!await isActive()) return
    await storage.confirmGuestImport(batch, lists, items.map(row => ({
      version: row.version,
      item: { id: row.id, listId: row.listId, name: row.name, purchased: row.purchased,
        createdAt: Date.parse(row.createdAt), quantity: row.quantity, unit: row.unit },
    })))
  }
}
