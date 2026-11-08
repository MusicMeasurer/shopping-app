import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createStorage, type ShoppingListRecord } from './storage'
import { createItem } from '../domain/shopping'

const list = (id: string, kind: 'permanent' | 'oneoff' = 'permanent'): ShoppingListRecord => ({
  id, name: id, symbol: '🛒', kind, createdAt: 1,
})

describe('E4 IndexedDB archive', () => {
  it('upgrades an existing version-1 database without losing purchases', async () => {
    const name = 'upgrade-' + crypto.randomUUID()
    const old = await (await import('idb')).openDB(name, 1, {
      upgrade(db) { db.createObjectStore('items', { keyPath: 'id' }) },
    })
    const milk = createItem('groceries', 'Молоко')
    await old.put('items', milk)
    old.close()
    const storage = createStorage(name)
    expect(await storage.read()).toEqual([milk])
    expect((await storage.readLists()).map(list => list.id).sort()).toEqual(['groceries', 'household'])
    expect(await storage.readArchives()).toEqual([])
    await storage.close()
  })

  it('archives a permanent list atomically and keeps the list available', async () => {
    const storage = createStorage('permanent-' + crypto.randomUUID())
    const record = list('groceries')
    const milk = createItem('groceries', 'Молоко')
    await storage.saveList(record)
    await storage.save(milk)
    await storage.completeList(record, 'archive-1', 100)
    expect(await storage.read()).toEqual([])
    expect((await storage.readLists()).find(list => list.id === record.id)).toEqual(record)
    expect(await storage.readArchives()).toEqual([{
      id: 'archive-1', sourceListId: 'groceries', name: 'groceries',
      kind: 'permanent', completedAt: 100, items: [milk],
    }])
    await storage.close()
  })

  it('moves a one-off list into the archive and removes it from active lists', async () => {
    const storage = createStorage('oneoff-' + crypto.randomUUID())
    const record = list('groceries', 'oneoff')
    await storage.saveList(record)
    await storage.save(createItem('groceries', 'Хлеб'))
    await storage.completeList(record, 'archive-2', 200)
    expect((await storage.readLists()).some(list => list.id === record.id)).toBe(false)
    expect(await storage.read()).toEqual([])
    expect(await storage.readArchives()).toHaveLength(1)
    await storage.close()
  })

  it('deletes an active list but preserves its completed history', async () => {
    const storage = createStorage('delete-' + crypto.randomUUID())
    const record = list('groceries')
    await storage.saveList(record)
    await storage.save(createItem('groceries', 'Первый'))
    await storage.completeList(record, 'archive-3', 300)
    await storage.save(createItem('groceries', 'Второй'))
    await storage.deleteList('groceries')
    expect(await storage.read()).toEqual([])
    expect((await storage.readLists()).some(list => list.id === record.id)).toBe(false)
    expect((await storage.readArchives())[0].items[0].name).toBe('Первый')
    await storage.close()
  })

  it('rolls back completion if archive ID already exists', async () => {
    const storage = createStorage('rollback-' + crypto.randomUUID())
    const record = list('groceries')
    await storage.saveList(record)
    await storage.save(createItem('groceries', 'Первый'))
    await storage.completeList(record, 'duplicate', 100)
    const second = createItem('groceries', 'Второй')
    await storage.save(second)
    await expect(storage.completeList(record, 'duplicate', 200)).rejects.toThrow()
    expect(await storage.read()).toEqual([second])
    expect(await storage.readArchives()).toHaveLength(1)
    await storage.close()
  })

  it('preserves archived snapshots across reopening', async () => {
    const name = 'reopen-' + crypto.randomUUID()
    const storage = createStorage(name)
    const record = list('groceries')
    await storage.saveList(record)
    await storage.save(createItem('groceries', 'Соль'))
    await storage.completeList(record, 'archive-4', 400)
    await storage.close()
    const reopened = createStorage(name)
    expect((await reopened.readArchives())[0].items[0].name).toBe('Соль')
    await reopened.close()
  })
})
