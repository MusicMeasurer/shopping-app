import { openDB, type DBSchema } from 'idb'
import type { Item } from '../domain/shopping'
import type { PendingItemOperation, CloudPendingOperation } from './pending-operations'

interface ScopedListMapping { key: string; accountId: string; localListId: string; remoteListId: string }
interface ScopedOperation {
  key: string
  accountId: string
  operation: PendingItemOperation
}
interface ScopedVersion { key: string; accountId: string; itemId: string; remoteListId: string; version: number }
interface ScopedItem { key: string; accountId: string; item: Item }
interface ShoppingDB extends DBSchema {
  items: { key: string; value: Item }
  accountItems: { key: string; value: ScopedItem; indexes: { byAccount: string } }
  pendingOperations: { key: string; value: PendingItemOperation }
  accountOperations: { key: string; value: ScopedOperation; indexes: { byAccount: string } }
  accountListMappings: { key: string; value: ScopedListMapping; indexes: { byAccount: string } }
  accountItemVersions: { key: string; value: ScopedVersion; indexes: { byAccount: string } }
}
function accountKey(accountId: string, operationId: string): string {
  if (!accountId.trim() || !operationId.trim()) throw new Error('Account and operation IDs are required')
  return JSON.stringify([accountId, operationId])
}
export function createStorage(name = 'shopping-app') {
  const database = openDB<ShoppingDB>(name, 6, {
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
      if (oldVersion < 5) {
        const store = db.createObjectStore('accountListMappings', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (oldVersion < 6) {
        const store = db.createObjectStore('accountItemVersions', { keyPath: 'key' })
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
    async readAccountListMappings(accountId: string): Promise<ScopedListMapping[]> {
      accountKey(accountId, 'check')
      return (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
    },
    async bindAccountList(accountId: string, localListId: string, remoteListId: string): Promise<void> {
      if (!localListId.trim() || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(remoteListId)) {
        throw new Error('Invalid list mapping')
      }
      const key = accountKey(accountId, localListId)
      const db = await database
      const tx = db.transaction('accountListMappings', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && existing.remoteListId !== remoteListId) {
        await tx.done
        throw new Error('List mapping cannot be silently replaced')
      }
      if (!existing) await tx.store.add({ key, accountId, localListId, remoteListId })
      await tx.done
    },
    /** Persist an account edit and its cloud operation in one IndexedDB transaction. */
    async saveAccountEdit(accountId: string, operation: CloudPendingOperation): Promise<void> {
      if (!operation.itemId.trim() || !operation.localListId.trim() ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.remoteListId) ||
          (operation.kind !== 'cloud-add' && (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < 0)) ||
          (operation.kind !== 'cloud-delete' && (operation.item.id !== operation.itemId || operation.item.listId !== operation.localListId))) {
        throw new Error('Invalid account edit operation')
      }
      const key = accountKey(accountId, operation.operationId)
      const db = await database
      const tx = db.transaction(['accountItems', 'accountOperations', 'accountListMappings'], 'readwrite')
      const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, operation.localListId))
      if (!mapping || mapping.remoteListId !== operation.remoteListId) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Missing verified list mapping')
      }
      const operations = tx.objectStore('accountOperations')
      const existing = await operations.get(key)
      if (existing) {
        if (JSON.stringify(existing.operation) !== JSON.stringify(operation)) {
          tx.abort()
          await tx.done.catch(() => {})
          throw new Error('Operation ID collision with different payload')
        }
        await tx.done
        return
      }
      // Until sequential edits can be rebased from confirmed receipts, a
      // second pending mutation for the same item would reuse a stale version.
      // Reject it atomically rather than silently overwrite or lose an edit.
      const queued = await operations.index('byAccount').getAll(accountId)
      if (queued.some(row => {
        const pending = row.operation
        return pending.kind !== 'delete' &&
          (pending.kind === 'upsert' ? pending.item.id : pending.itemId) === operation.itemId
      })) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Item has an unconfirmed cloud change')
      }
      const itemKey = accountKey(accountId, operation.itemId)
      const items = tx.objectStore('accountItems')
      if (operation.kind === 'cloud-delete') {
        await items.delete(itemKey)
      } else {
        await items.put({ key: itemKey, accountId, item: operation.item })
      }
      await operations.add({ key, accountId, operation })
      await tx.done
    },
    /** Atomically record an acknowledged RPC receipt and remove its exact queued operation. */
    async commitAccountReceipt(accountId: string, operationId: string, remoteListId: string, itemId: string, version: number): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId) ||
          !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid server receipt')
      const key = accountKey(accountId, operationId)
      const db = await database
      const tx = db.transaction(['accountOperations', 'accountItemVersions'], 'readwrite')
      const pending = await tx.objectStore('accountOperations').get(key)
      if (!pending || pending.operation.kind === 'upsert' || pending.operation.kind === 'delete' ||
          pending.operation.itemId !== itemId || pending.operation.remoteListId !== remoteListId) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Receipt does not match queued cloud operation')
      }
      const versions = tx.objectStore('accountItemVersions')
      const versionKey = accountKey(accountId, itemId)
      const previous = await versions.get(versionKey)
      if (previous && (previous.remoteListId !== remoteListId || version < previous.version)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Server version regression or list mismatch')
      }
      await versions.put({ key: versionKey, accountId, remoteListId, itemId, version })
      await tx.objectStore('accountOperations').delete(key)
      await tx.done
    },
    /** Persist only server-confirmed versions; never infer a version from local edits. */
    async recordAccountItemVersion(accountId: string, remoteListId: string, itemId: string, version: number): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId) ||
          !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid server item version')
      const key = accountKey(accountId, itemId)
      const db = await database
      const tx = db.transaction('accountItemVersions', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && (existing.remoteListId !== remoteListId || version < existing.version)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Server version regression or list mismatch')
      }
      await tx.store.put({ key, accountId, remoteListId, itemId, version })
      await tx.done
    },
    async readAccountItemVersions(accountId: string): Promise<ScopedVersion[]> {
      accountKey(accountId, 'check')
      return (await database).getAllFromIndex('accountItemVersions', 'byAccount', accountId)
    },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
