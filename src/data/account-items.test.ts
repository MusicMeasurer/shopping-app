import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

it('keeps guest and account items isolated across restarts', async () => {
  const name = `scoped-items-${crypto.randomUUID()}`
  const guest = createItem('groceries', 'Гостевой хлеб')
  const a = createItem('groceries', 'Молоко')
  const b = { ...a, name: 'Чай' }
  const first = createStorage(name)
  await first.save(guest)
  await first.saveAccountItem('user-a', a)
  await first.saveAccountItem('user-b', b)
  await first.close()

  const second = createStorage(name)
  expect(await second.read()).toEqual([guest])
  expect(await second.readAccountItems('user-a')).toEqual([a])
  expect(await second.readAccountItems('user-b')).toEqual([b])
  await second.removeAccountItem('user-a', a.id)
  expect(await second.readAccountItems('user-a')).toEqual([])
  expect(await second.readAccountItems('user-b')).toEqual([b])
  expect(await second.read()).toEqual([guest])
  await second.close()
})

it('requires an account identifier for scoped item access', async () => {
  const db = createStorage(`account-id-${crypto.randomUUID()}`)
  await expect(db.readAccountItems('')).rejects.toThrow()
  await expect(db.saveAccountItem('', createItem('groceries', 'Товар'))).rejects.toThrow()
  await db.close()
})
