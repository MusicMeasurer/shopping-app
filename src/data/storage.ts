import { openDB, type DBSchema } from 'idb'
import { lists as defaultLists, type Item } from '../domain/shopping'
import type { PendingItemOperation, CloudPendingOperation } from './pending-operations'

interface ScopedListMapping { key: string; accountId: string; localListId: string; remoteListId: string }
interface ScopedOperation {
  key: string
  accountId: string
  operation: PendingItemOperation
}
interface ScopedVersion { key: string; accountId: string; itemId: string; remoteListId: string; version: number }
interface ScopedItem { key: string; accountId: string; item: Item }
export interface ShoppingListRecord {
  id: string; name: string; symbol: string; kind: 'permanent' | 'oneoff'; createdAt: number; position?: number
}
export interface ArchivedListRecord {
  id: string; sourceListId: string; name: string; kind: 'permanent' | 'oneoff'; completedAt: number; items: Item[]
}
interface ShoppingDB extends DBSchema {
  lists: { key: string; value: ShoppingListRecord }
  archives: { key: string; value: ArchivedListRecord }
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
  const database = openDB<ShoppingDB>(name, 7, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('pendingOperations')) db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
      if (!db.objectStoreNames.contains('accountOperations')) {
        const store = db.createObjectStore('accountOperations', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountItems')) {
        const store = db.createObjectStore('accountItems', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountListMappings')) {
        const store = db.createObjectStore('accountListMappings', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountItemVersions')) {
        const store = db.createObjectStore('accountItemVersions', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      // Additive upgrade from E3 v6 and from E4 v3. Never delete or overwrite data.
      if (!db.objectStoreNames.contains('lists')) {
        db.createObjectStore('lists', { keyPath: 'id' })
        for (const list of defaultLists) void tx.objectStore('lists').put({ ...list, kind: 'permanent', createdAt: 0 })
      }
      if (!db.objectStoreNames.contains('archives')) db.createObjectStore('archives', { keyPath: 'id' })

    },
    blocking() { void database.then(db => db.close()) },
  })
  return {
    async readLists(): Promise<ShoppingListRecord[]> { return (await database).getAll('lists') },
    async saveList(list: ShoppingListRecord): Promise<void> { await (await database).put('lists', list) },
    async reorderLists(records: ShoppingListRecord[]): Promise<void> {
      const tx = (await database).transaction('lists', 'readwrite')
      for (const record of records) await tx.store.put(record)
      await tx.done
    },
    async saveItems(items: Item[]): Promise<void> {
      const tx = (await database).transaction('items', 'readwrite')
      for (const item of items) await tx.store.put(item)
      await tx.done
    },
    async readArchives(): Promise<ArchivedListRecord[]> { return (await database).getAll('archives') },
    async deleteList(listId: string): Promise<void> {
      const tx = (await database).transaction(['lists', 'items'], 'readwrite')
      const items = await tx.objectStore('items').getAll()
      for (const item of items) if (item.listId === listId) await tx.objectStore('items').delete(item.id)
      await tx.objectStore('lists').delete(listId)
      await tx.done
    },
    async completeList(list: ShoppingListRecord, archiveId: string, completedAt: number): Promise<void> {
      const tx = (await database).transaction(['lists', 'items', 'archives'], 'readwrite')
      const items = (await tx.objectStore('items').getAll()).filter(item => item.listId === list.id)
      if (!items.length) { tx.abort(); throw new Error('Cannot archive an empty list') }
      await tx.objectStore('archives').add({ id: archiveId, sourceListId: list.id, name: list.name, kind: list.kind, completedAt, items })
      for (const item of items) await tx.objectStore('items').delete(item.id)
      if (list.kind === 'oneoff') await tx.objectStore('lists').delete(list.id)
      await tx.done
    },
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
    /** Import a server-only item and its confirmed version atomically; never overwrite local work. */
    async importRemoteOnlyItem(accountId: string, remoteListId: string, item: Item, version: number): Promise<void> {
      if (!Number.isSafeInteger(version) || version < 0 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote item version or list')
      }
      const db = await database
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, item.listId))
      const key = accountKey(accountId, item.id)
      const existing = await tx.objectStore('accountItems').get(key)
      const knownVersion = await tx.objectStore('accountItemVersions').get(key)
      const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
      if (!mapping || mapping.remoteListId !== remoteListId || existing || knownVersion ||
          queued.some(row => row.operation.kind === 'delete' ? row.operation.itemId === item.id :
            row.operation.kind === 'upsert' ? row.operation.item.id === item.id : row.operation.itemId === item.id)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Remote import conflicts with local state')
      }
      await tx.objectStore('accountItems').add({ key, accountId, item })
      await tx.objectStore('accountItemVersions').add({ key, accountId, itemId: item.id, remoteListId, version })
      await tx.done
    },
    /** All-or-nothing import of a reviewed remote-only batch. */
    async importRemoteOnlyBatch(accountId: string, remoteListId: string,
      entries: { item: Item; version: number }[]): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote list ID')
      }
      if (!entries.length) return
      const ids = new Set(entries.map(entry => entry.item.id))
      if (ids.size !== entries.length || entries.some(entry =>
        !Number.isSafeInteger(entry.version) || entry.version < 0)) throw new Error('Invalid import batch')
      const db = await database
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      try {
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, entries[0].item.listId))
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
        if (!mapping || mapping.remoteListId !== remoteListId ||
            entries.some(entry => entry.item.listId !== mapping.localListId) ||
            queued.some(row => {
              const op = row.operation
              const id = op.kind === 'upsert' ? op.item.id : op.kind === 'delete' ? op.itemId : op.itemId
              return ids.has(id)
            })) throw new Error('Remote import conflicts with local state')
        for (const entry of entries) {
          const key = accountKey(accountId, entry.item.id)
          if (await tx.objectStore('accountItems').get(key) ||
              await tx.objectStore('accountItemVersions').get(key)) {
            throw new Error('Remote import conflicts with local state')
          }
          await tx.objectStore('accountItems').add({ key, accountId, item: entry.item })
          await tx.objectStore('accountItemVersions').add({
            key, accountId, itemId: entry.item.id, remoteListId, version: entry.version,
          })
        }
        await tx.done
      } catch (error) {
        tx.abort()
        await tx.done.catch(() => {})
        throw error
      }
    },
    /** Explicitly reviewed server deletions, committed atomically only if local evidence is unchanged. */
    async applyReviewedRemoteDeletions(accountId: string, remoteListId: string,
      entries: { item: Item; expectedLocalVersion: number; serverDeletedVersion: number }[]): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote list ID')
      }
      if (!entries.length) return
      const ids = new Set(entries.map(row => row.item.id))
      if (ids.size !== entries.length || entries.some(row =>
        !Number.isSafeInteger(row.expectedLocalVersion) || row.expectedLocalVersion < 0 ||
        !Number.isSafeInteger(row.serverDeletedVersion) || row.serverDeletedVersion <= row.expectedLocalVersion)) {
        throw new Error('Invalid reviewed deletion batch')
      }
      const db = await database
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      try {
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, entries[0].item.listId))
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
        if (!mapping || mapping.remoteListId !== remoteListId ||
            entries.some(row => row.item.listId !== mapping.localListId) ||
            queued.some(row => ids.has(row.operation.kind === 'upsert' ?
              row.operation.item.id : row.operation.itemId))) {
          throw new Error('Reviewed deletion conflicts with local state')
        }
        for (const row of entries) {
          const key = accountKey(accountId, row.item.id)
          const stored = await tx.objectStore('accountItems').get(key)
          const version = await tx.objectStore('accountItemVersions').get(key)
          if (!stored || JSON.stringify(stored.item) !== JSON.stringify(row.item) ||
              !version || version.remoteListId !== remoteListId ||
              version.version !== row.expectedLocalVersion) {
            throw new Error('Reviewed deletion conflicts with local state')
          }
        }
        for (const row of entries) {
          const key = accountKey(accountId, row.item.id)
          await tx.objectStore('accountItems').delete(key)
          await tx.objectStore('accountItemVersions').put({
            key, accountId, itemId: row.item.id, remoteListId, version: row.serverDeletedVersion,
          })
        }
        await tx.done
      } catch (error) {
        tx.abort()
        await tx.done.catch(() => {})
        throw error
      }
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
