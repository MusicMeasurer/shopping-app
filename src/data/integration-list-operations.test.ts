import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createStorage } from './storage'

describe('integration list operations', () => {
  it('renames and changes kind without changing list identity or items', async () => {
    const storage = createStorage('list-operations-' + crypto.randomUUID())
    const list = { id: 'weekend', name: 'Выходные', symbol: '📝', kind: 'oneoff' as const, createdAt: 1 }
    await storage.saveList(list)
    await storage.save({ id: 'milk', listId: list.id, name: 'Молоко', purchased: false, createdAt: 2 })
    await storage.renameList(list.id, '  Дача  ')
    await storage.changeListKind(list.id, 'permanent')
    expect((await storage.readLists()).find(row => row.id === list.id)).toMatchObject({ name: 'Дача', kind: 'permanent' })
    expect((await storage.read()).find(item => item.id === 'milk')?.listId).toBe(list.id)
    await storage.close()
  })
  it('rejects invalid names and missing lists without writing changes', async () => {
    const storage = createStorage('list-invalid-' + crypto.randomUUID())
    await expect(storage.renameList('groceries', '  ')).rejects.toThrow()
    await expect(storage.renameList('missing', 'Название')).rejects.toThrow()
    await expect(storage.changeListKind('missing', 'oneoff')).rejects.toThrow()
    expect((await storage.readLists()).find(row => row.id === 'groceries')?.name).toBe('Продукты')
    await storage.close()
  })
})
