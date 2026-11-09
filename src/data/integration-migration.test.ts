import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { openDB, deleteDB } from 'idb'
import { createStorage } from './storage'

const names: string[] = []
afterEach(async () => { for (const name of names.splice(0)) await deleteDB(name) })
function unique() { const name = 'integration-' + crypto.randomUUID(); names.push(name); return name }

describe('E3/E4 additive migration to v7', () => {
  it('preserves E3 v6 guest and account items while adding list and archive stores', async () => {
    const name = unique()
    const db = await openDB(name, 6, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
      for (const store of ['accountOperations', 'accountItems', 'accountListMappings', 'accountItemVersions']) {
        const s = db.createObjectStore(store, { keyPath: 'key' }); s.createIndex('byAccount', 'accountId')
      }
    } })
    await db.put('items', { id: 'guest-1', listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 })
    await db.put('accountItems', { key: JSON.stringify(['account-1', 'cloud-1']), accountId: 'account-1', item: { id: 'cloud-1', listId: 'groceries', name: 'Хлеб', purchased: false, createdAt: 2 } })
    db.close()
    const storage = createStorage(name)
    expect((await storage.read()).map(x => x.id)).toEqual(['guest-1'])
    expect((await storage.readAccountItems('account-1')).map(x => x.id)).toEqual(['cloud-1'])
    expect((await storage.readLists()).map(x => x.id).sort()).toEqual(['groceries', 'household'])
    expect(await storage.readArchives()).toEqual([])
    await storage.close()
  })
  it('preserves E4 v3 lists and archives and recreates missing E3 account stores', async () => {
    const name = unique()
    const db = await openDB(name, 3, { upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('lists', { keyPath: 'id' })
      db.createObjectStore('archives', { keyPath: 'id' })
    } })
    await db.put('lists', { id: 'custom', name: 'Дача', symbol: '🏡', kind: 'permanent', createdAt: 1 })
    await db.put('archives', { id: 'archive-1', sourceListId: 'custom', name: 'Дача', kind: 'permanent', completedAt: 2, items: [] })
    db.close()
    const storage = createStorage(name)
    expect((await storage.readLists())[0].name).toBe('Дача')
    expect((await storage.readArchives())[0].id).toBe('archive-1')
    expect(await storage.readAccountItems('account-1')).toEqual([])
    expect(await storage.readAccountPending('account-1')).toEqual([])
    expect((await storage.readLists()).length).toBe(1)
    await storage.close()
  })
})
