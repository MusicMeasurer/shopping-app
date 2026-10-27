import { openDB, type DBSchema } from 'idb'
import type { Item } from '../domain/shopping'
interface ShoppingDB extends DBSchema { items: { key: string; value: Item } }
export function createStorage(name = 'shopping-app') {
  const database = openDB<ShoppingDB>(name, 1, {
    upgrade(db) { db.createObjectStore('items', { keyPath: 'id' }) },
    blocking() { void database.then(db => db.close()) },
  })
  return {
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item) { await (await database).put('items', item) },
    async remove(id: string) { await (await database).delete('items', id) },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
