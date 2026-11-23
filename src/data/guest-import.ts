import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import { fetchCloudListMetadata } from './e4-cloud-list-metadata'
import { fetchCloudArchive } from './cloud-archive'
import { fetchRemoteItems } from './remote-snapshot'

export async function syncGuestImports(
  storage: Storage, client: SupabaseClient, accountId: string, isActive: () => Promise<boolean>, kind?: 'profile' | 'archive',
) {
  for (const batch of await storage.readGuestImports(accountId)) {
    if ((kind === 'archive' && !batch.archiveOnly) || (kind === 'profile' && batch.archiveOnly)) continue
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
    const lists = ids.length ? (await fetchCloudListMetadata(client, accountId)).filter(list => ids.includes(list.id)) : []
    if (lists.length !== new Set(ids).size) throw new Error('Guest import lists are missing from the verified account')
    const items = (await Promise.all(lists.map(async list => {
      const rows = []
      for (let from = 0; ; from += 500) {
        const page = await fetchRemoteItems(client, list.id, false, { from, to: from + 499 })
        rows.push(...page)
        if (page.length < 500) return rows
        if (!await isActive()) throw new Error('Transfer identity changed')
      }
    }))).flat()
    if (batch.removeSource || batch.archiveOnly) {
      const archives = await fetchCloudArchive(client, true)
      if (!Array.isArray(data?.archives) || data.archives.length !== batch.archives.length ||
          data.archives.some((id: string, index: number) => {
            const saved = archives.find(row => row.id === id)
            const source = batch.archives[index]
            return !saved || saved.sourceListName !== source.name || saved.items.length !== source.items.length ||
              source.items.some((item, ordinal) => {
                const archived = saved.items.find(row => row.ordinal === ordinal)
                return !archived || archived.name !== item.name || archived.quantity !== (item.quantity ?? null) || archived.unit !== (item.unit ?? null)
              })
          }) ||
          !Array.isArray(data?.items) || data.items.length !== batch.items.length ||
          data.items.some((id: string) => !items.some(row => row.id === id))) throw new Error('Transfer snapshot is not fully confirmed')
      if (!await isActive()) return
      if (batch.archiveOnly) {
        const confirmed = data.archives.map((id: string) => archives.find(row => row.id === id)!)
        if (new Set(data.archives).size !== batch.archives.length ||
            confirmed.some((row: typeof archives[number], index: number) => Date.parse(row.completedAt) !== batch.archives[index].completedAt))
          throw new Error('Archive transfer is not fully confirmed')
        await storage.confirmGuestImport(batch, [], [], confirmed)
        continue
      }
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
