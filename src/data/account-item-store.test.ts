import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { itemStoreForAccount } from './account-item-store'
import { createItem } from '../domain/shopping'

it('selects guest and account data without mixing them', async () => {
  const db = createStorage(`selector-${crypto.randomUUID()}`)
  const guest = itemStoreForAccount(db, null)
  const alice = itemStoreForAccount(db, 'account-a')
  const bob = itemStoreForAccount(db, 'account-b')
  const item = createItem('groceries', 'Молоко')
  await guest.save(item)
  await alice.save({ ...item, name: 'Чай' })
  await bob.save({ ...item, name: 'Хлеб' })
  expect(await guest.read()).toEqual([item])
  expect((await alice.read())[0].name).toBe('Чай')
  expect((await bob.read())[0].name).toBe('Хлеб')
  await alice.remove(item.id)
  expect(await alice.read()).toEqual([])
  expect(await bob.read()).toHaveLength(1)
  expect(await guest.read()).toHaveLength(1)
  await db.close()
})

it('rejects empty account IDs rather than silently falling back to guest', async () => {
  const db = createStorage(`selector-invalid-${crypto.randomUUID()}`)
  expect(() => itemStoreForAccount(db, '')).toThrow()
  await db.close()
})
