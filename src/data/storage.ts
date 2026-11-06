import { openDB, type DBSchema } from 'idb'
import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'

interface ShoppingDB extends DBSchema {
  items: { key: string; value: Item }
  pendingOperations: { key: string; value: PendingItemOperation }
}

export function createStorage(name = 'shopping-app') {
  const database = openDB<ShoppingDB>(name, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('items', { keyPath: 'id' })
      if (oldVersion < 2) db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
    },
    blocking() { void database.then(db => db.close()) },
  })
  return {
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item) { await (await database).put('items', item) },
    async remove(id: string) { await (await database).delete('items', id) },
    async readPending(): Promise<PendingItemOperation[]> {
      return (await database).getAll('pendingOperations')
    },
    async enqueuePending(operation: PendingItemOperation): Promise<void> {
      const db = await database
      const tx = db.transaction('pendingOperations', 'readwrite')
      const existing = await tx.store.get(operation.operationId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(operation)) {
        await tx.done
        throw new Error('Operation ID collision with different payload')
      }
      if (!existing) await tx.store.add(operation)
      await tx.done
    },
    async acknowledgePending(operationId: string): Promise<void> {
      await (await database).delete('pendingOperations', operationId)
    },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
