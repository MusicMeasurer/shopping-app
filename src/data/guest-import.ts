import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import { fetchCloudListMetadata } from './e4-cloud-list-metadata'
import { fetchCloudArchive } from './cloud-archive'
import { fetchRemoteItems } from './remote-snapshot'

export async function syncGuestImports(
  storage: Storage, client: SupabaseClient, accountId: string, isActive: () => Promise<boolean>,
) {
  for (const batch of await storage.readGuestImports(accountId)) {
    if (!await isActive()) return
    const { data, error } = await client.rpc(batch.collisionMode ? 'import_e4_profile_merge' : 'import_e4_guest_profile', {
      p_operation: batch.operationId,
      p_account: accountId,
      p_snapshot: { lists: batch.lists, items: batch.items, archives: batch.archives, ...(batch.collisionMode ? { collisionMode: batch.collisionMode } : {}) },
    })
    if (error) throw error
    if (!await isActive()) return
    const ids = batch.lists.map(list => data?.lists?.[list.id])
    if (ids.some(id => typeof id !== 'string'))
      throw new Error('Unconfirmed guest import')
    const lists = (await fetchCloudListMetadata(client, accountId)).filter(list => ids.includes(list.id))
    if (lists.length !== new Set(ids).size) throw new Error('Guest import lists are missing from the verified account')
    const items = (await Promise.all(lists.map(list => fetchRemoteItems(client, list.id)))).flat()
    if (batch.removeSource) {
      const archives = await fetchCloudArchive(client)
      if (!Array.isArray(data?.archives) || data.archives.length !== batch.archives.length ||
          data.archives.some((id: string) => !archives.some(row => row.id === id)) ||
          !Array.isArray(data?.items) || data.items.length !== batch.items.length ||
          data.items.some((id: string) => !items.some(row => row.id === id))) throw new Error('Transfer snapshot is not fully confirmed')
      if (!await isActive()) return
      await storage.cacheAccountArchive(accountId, archives)
    }
    if (!await isActive()) return
    const symbols = new Map(ids.map((id, index) => [id, batch.lists[index].symbol]))
    await storage.confirmGuestImport(batch, lists.map(list => ({ ...list, symbol: symbols.get(list.id) })), items.map(row => ({
      version: row.version,
      item: { id: row.id, listId: row.listId, name: row.name, purchased: row.purchased,
        createdAt: Date.parse(row.createdAt), quantity: row.quantity, unit: row.unit },
    })))
  }
}
