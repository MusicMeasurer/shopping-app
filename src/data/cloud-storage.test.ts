import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

const remoteListId = '123e4567-e89b-42d3-a456-426614174000'
describe('IndexedDB v5 cloud edit migration', () => {
  it('upgrades v4 without losing account items or legacy operations', async () => {
    const name = 'v4-' + crypto.randomUUID()
    const item = createItem('groceries', 'Хлеб')
    const db = await openDB(name, 4, {
      upgrade(db) {
        db.createObjectStore('items', { keyPath: 'id' })
        db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
        const ops = db.createObjectStore('accountOperations', { keyPath: 'key' })
        ops.createIndex('byAccount', 'accountId')
        const items = db.createObjectStore('accountItems', { keyPath: 'key' })
        items.createIndex('byAccount', 'accountId')
      },
    })
    const key = JSON.stringify(['a', item.id])
    await db.put('accountItems', { key, accountId: 'a', item })
    await db.put('accountOperations', {
      key: JSON.stringify(['a', 'legacy']), accountId: 'a',
      operation: { operationId: 'legacy', kind: 'upsert', item },
    })
    db.close()
    const upgraded = createStorage(name)
    expect(await upgraded.readAccountItems('a')).toEqual([item])
    expect(await upgraded.readAccountPending('a')).toHaveLength(1)
    expect(await upgraded.readAccountListMappings('a')).toEqual([])
    await upgraded.close()
  })
  it('persists item and queued operation atomically, scoped to the account', async () => {
    const name = 'atomic-' + crypto.randomUUID()
    const storage = createStorage(name)
    const item = createItem('groceries', 'Молоко')
    const operation = {
      kind: 'cloud-add' as const, operationId: crypto.randomUUID(),
      localListId: 'groceries' as const, remoteListId, itemId: item.id, item,
    }
    await expect(storage.saveAccountEdit('a', operation)).rejects.toThrow('Missing verified list mapping')
    expect(await storage.readAccountItems('a')).toEqual([])
    expect(await storage.readAccountPending('a')).toEqual([])
    await storage.bindAccountList('a', 'groceries', remoteListId)
    await storage.saveAccountEdit('a', operation)
    await storage.saveAccountEdit('a', operation)
    expect(await storage.readAccountItems('a')).toEqual([item])
    expect(await storage.readAccountPending('a')).toEqual([operation])
    expect(await storage.readAccountItems('b')).toEqual([])
    await expect(storage.bindAccountList('a', 'groceries', crypto.randomUUID())).rejects.toThrow('silently replaced')
    await storage.close()
  })
  it('rejects mismatched item identity and invalid version without writing', async () => {
    const storage = createStorage('invalid-' + crypto.randomUUID())
    const item = createItem('groceries', 'Соль')
    await storage.bindAccountList('a', 'groceries', remoteListId)
    const base = { kind: 'cloud-update' as const, operationId: crypto.randomUUID(),
      localListId: 'groceries' as const, remoteListId, itemId: item.id, item, expectedVersion: 1 }
    await expect(storage.saveAccountEdit('a', { ...base, itemId: crypto.randomUUID() })).rejects.toThrow('Invalid account edit operation')
    await expect(storage.saveAccountEdit('a', { ...base, expectedVersion: -1 })).rejects.toThrow('Invalid account edit operation')
    expect(await storage.readAccountItems('a')).toEqual([])
    expect(await storage.readAccountPending('a')).toEqual([])
    await storage.close()
  })
  it('persists confirmed server versions per account without regression', async () => {
    const storage = createStorage('versions-' + crypto.randomUUID())
    const itemId = crypto.randomUUID()
    await storage.recordAccountItemVersion('a', remoteListId, itemId, 3)
    await storage.recordAccountItemVersion('a', remoteListId, itemId, 3)
    await storage.recordAccountItemVersion('b', remoteListId, itemId, 1)
    await expect(storage.recordAccountItemVersion('a', remoteListId, itemId, 2)).rejects.toThrow('regression')
    await expect(storage.recordAccountItemVersion('a', crypto.randomUUID(), itemId, 4)).rejects.toThrow('mismatch')
    expect((await storage.readAccountItemVersions('a')).map(row => row.version)).toEqual([3])
    expect((await storage.readAccountItemVersions('b')).map(row => row.version)).toEqual([1])
    await storage.close()
  })
  it('atomically stores confirmed receipt and removes only matching queued operation', async () => {
    const storage = createStorage('receipt-' + crypto.randomUUID())
    const item = createItem('groceries', 'Сыр')
    const operation = { kind: 'cloud-add' as const, operationId: crypto.randomUUID(),
      localListId: 'groceries' as const, remoteListId, itemId: item.id, item }
    await storage.bindAccountList('a', 'groceries', remoteListId)
    await storage.saveAccountEdit('a', operation)
    await expect(storage.commitAccountReceipt('a', operation.operationId, remoteListId, crypto.randomUUID(), 1))
      .rejects.toThrow('does not match')
    expect(await storage.readAccountPending('a')).toEqual([operation])
    expect(await storage.readAccountItemVersions('a')).toEqual([])
    await storage.commitAccountReceipt('a', operation.operationId, remoteListId, item.id, 1)
    expect(await storage.readAccountPending('a')).toEqual([])
    expect((await storage.readAccountItemVersions('a')).map(row => row.version)).toEqual([1])
    await storage.close()
  })
  it('atomically deletes the account item and queues a versioned tombstone', async () => {
    const storage = createStorage('delete-' + crypto.randomUUID())
    const item = createItem('groceries', 'Хлеб')
    await storage.bindAccountList('a', 'groceries', remoteListId)
    await storage.saveAccountItem('a', item)
    const operation = {
      kind: 'cloud-delete' as const, operationId: crypto.randomUUID(),
      localListId: 'groceries' as const, remoteListId, itemId: item.id, expectedVersion: 2,
    }
    await storage.saveAccountEdit('a', operation)
    expect(await storage.readAccountItems('a')).toEqual([])
    expect(await storage.readAccountPending('a')).toEqual([operation])
    await storage.close()
  })
})
