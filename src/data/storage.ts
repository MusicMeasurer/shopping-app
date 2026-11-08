import { openDB, type DBSchema } from 'idb'
import { lists as defaults, type Item } from '../domain/shopping'

export interface ShoppingListRecord {
  id: string
  name: string
  symbol: string
  kind: 'permanent' | 'oneoff'
  createdAt: number
}
export interface ArchivedListRecord {
  id: string
  sourceListId: string
  name: string
  kind: 'permanent' | 'oneoff'
  completedAt: number
  items: Item[]
}
interface ShoppingDB extends DBSchema {
  items: { key: string; value: Item }
  lists: { key: string; value: ShoppingListRecord }
  archives: { key: string; value: ArchivedListRecord }
}
export function createStorage(name = 'shopping-app') {
  const database = openDB<ShoppingDB>(name, 3, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('archives')) db.createObjectStore('archives', { keyPath: 'id' })
        // Seed exactly once, including upgrades from v1/v2. Never resurrect deleted defaults.
        if (oldVersion < 3) for (const list of defaults) {
          const store = tx.objectStore('lists')
          void store.get(list.id).then(existing => {
            if (!existing) return store.put({ ...list, kind: 'permanent', createdAt: 0 })
          })
        }
    },
    blocking() { void database.then(db => db.close()) },
  })
  return {
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item) { await (await database).put('items', item) },
    async remove(id: string) { await (await database).delete('items', id) },
    async readLists(): Promise<ShoppingListRecord[]> { return (await database).getAll('lists') },
    async saveList(list: ShoppingListRecord) { await (await database).put('lists', list) },
      async saveItems(items: Item[]): Promise<void> {
        const tx = (await database).transaction('items', 'readwrite')
        for (const item of items) await tx.store.put(item)
        await tx.done
      },
    async readArchives(): Promise<ArchivedListRecord[]> { return (await database).getAll('archives') },
    async deleteList(listId: string): Promise<void> {
      const db = await database
      const tx = db.transaction(['lists', 'items'], 'readwrite')
      const items = await tx.objectStore('items').getAll()
      for (const item of items) if (item.listId === listId) await tx.objectStore('items').delete(item.id)
      await tx.objectStore('lists').delete(listId)
      await tx.done
    },
    async completeList(list: ShoppingListRecord, archiveId: string, completedAt: number): Promise<void> {
      const db = await database
      const tx = db.transaction(['lists', 'items', 'archives'], 'readwrite')
      // Observe abort immediately: a failed request rejects both itself and tx.done.
      const completion = tx.done
      void completion.catch(() => {})
      const allItems = await tx.objectStore('items').getAll()
      const items = allItems.filter(item => item.listId === list.id)
      await tx.objectStore('archives').add({
        id: archiveId, sourceListId: list.id, name: list.name,
        kind: list.kind, completedAt, items,
      })
      for (const item of items) await tx.objectStore('items').delete(item.id)
      if (list.kind === 'oneoff') await tx.objectStore('lists').delete(list.id)
      await completion
    },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
