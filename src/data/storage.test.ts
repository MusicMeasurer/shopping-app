import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { openDB } from 'idb'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

it('persists both lists, purchases and deletion across database connections', async () => {
  const name = `test-${crypto.randomUUID()}`
  const first = createStorage(name)
  const food = createItem('groceries', 'Молоко')
  const household = createItem('household', 'Мыло')
  await first.save(food); await first.save(household); await first.close()
  const second = createStorage(name)
  expect(await second.read()).toHaveLength(2)
  await second.save({ ...food, purchased: true }); await second.remove(household.id); await second.close()
  const third = createStorage(name)
  expect(await third.read()).toEqual([{ ...food, purchased: true }])
  await third.close()
})

it('upgrades a v1 database without losing local items', async () => {
  const name = `migration-${crypto.randomUUID()}`
  const item = createItem('groceries', 'Хлеб')
  const legacy = await openDB(name, 1, {
    upgrade(db) { db.createObjectStore('items', { keyPath: 'id' }) },
  })
  await legacy.put('items', item)
  legacy.close()
  const upgraded = createStorage(name)
  expect(await upgraded.read()).toEqual([item])
  expect(await upgraded.readPending()).toEqual([])
  await upgraded.close()
})

it('persists queued operations across restart and acknowledges one at a time', async () => {
  const name = `queue-${crypto.randomUUID()}`
  const first = createStorage(name)
  const item = createItem('groceries', 'Молоко')
  const add = { operationId: 'op-1', kind: 'upsert' as const, item }
  const remove = { operationId: 'op-2', kind: 'delete' as const, itemId: item.id }
  await first.enqueuePending(add)
  await first.enqueuePending(remove)
  await first.enqueuePending(add)
  await expect(first.enqueuePending({ ...add, item: { ...item, purchased: true } })).rejects.toThrow()
  await first.close()

  const second = createStorage(name)
  expect(await second.readPending()).toEqual([add, remove])
  await second.acknowledgePending('op-1')
  expect(await second.readPending()).toEqual([remove])
  await second.close()
})
