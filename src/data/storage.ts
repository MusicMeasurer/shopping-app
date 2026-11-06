import { openDB, type DBSchema } from 'idb'
import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'

interface ScopedOperation {
  key: string
  accountId: string
  operation: PendingItemOperation
}
interface ScopedItem { key: string; accountId: string; item: Item }
interface ShoppingDB extends DBSchema {
  items: { key: string; value: Item }
  accountItems: { key: string; value: ScopedItem; indexes: { byAccount: string } }
  pendingOperations: { key: string; value: PendingItemOperation }
  accountOperations: { key: string; value: ScopedOperation; indexes: { byAccount: string } }
}
function accountKey(accountId: string, operationId: string): string {
  if (!accountId.trim() || !operationId.trim()) throw new Error('Account and operation IDs are required')
  return JSON.stringify([accountId, operationId])
}
export function createStorage(name = 'shopping-app') {
  const database = openDB<ShoppingDB>(name, 4, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) db.createObjectStore('items', { keyPath: 'id' })
      if (oldVersion < 2) db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
      if (oldVersion < 3) {
        const store = db.createObjectStore('accountOperations', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (oldVersion < 4) {
        const store = db.createObjectStore('accountItems', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
    },
    blocking() { void database.then(db => db.close()) },
  })
  return {
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item) { await (await database).put('items', item) },
    async remove(id: string) { await (await database).delete('items', id) },
    // Guest items remain in the original store until explicit migration.
    async readAccountItems(accountId: string): Promise<Item[]> {
      accountKey(accountId, 'check')
      const rows = await (await database).getAllFromIndex('accountItems', 'byAccount', accountId)
      return rows.map(row => row.item)
    },
    async saveAccountItem(accountId: string, item: Item): Promise<void> {
      const key = accountKey(accountId, item.id)
      await (await database).put('accountItems', { key, accountId, item })
    },
    async removeAccountItem(accountId: string, itemId: string): Promise<void> {
      await (await database).delete('accountItems', accountKey(accountId, itemId))
    },
    // Unassigned operations remain local until an explicit guest-data migration.
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
    async readAccountPending(accountId: string): Promise<PendingItemOperation[]> {
      accountKey(accountId, 'check')
      const records = await (await database).getAllFromIndex('accountOperations', 'byAccount', accountId)
      return records.map(record => record.operation)
    },
    async enqueueAccountPending(accountId: string, operation: PendingItemOperation): Promise<void> {
      const key = accountKey(accountId, operation.operationId)
      const db = await database
      const tx = db.transaction('accountOperations', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && JSON.stringify(existing.operation) !== JSON.stringify(operation)) {
        await tx.done
        throw new Error('Operation ID collision with different payload')
      }
      if (!existing) await tx.store.add({ key, accountId, operation })
      await tx.done
    },
    async acknowledgeAccountPending(accountId: string, operationId: string): Promise<void> {
      await (await database).delete('accountOperations', accountKey(accountId, operationId))
    },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
