import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

it('isolates pending operations across accounts and keeps guest changes unassigned', async () => {
  const name = `accounts-${crypto.randomUUID()}`
  const db = createStorage(name)
  const item = createItem('groceries', 'Молоко')
  const operation = { operationId: 'same-id', kind: 'upsert' as const, item }
  await db.enqueuePending(operation)
  await db.enqueueAccountPending('user-a', operation)
  await db.enqueueAccountPending('user-b', { ...operation, item: { ...item, name: 'Хлеб' } })
  await db.close()

  const reopened = createStorage(name)
  expect(await reopened.readPending()).toEqual([operation])
  expect(await reopened.readAccountPending('user-a')).toEqual([operation])
  expect((await reopened.readAccountPending('user-b'))[0].item).toMatchObject({ name: 'Хлеб' })
  await reopened.acknowledgeAccountPending('user-a', 'same-id')
  expect(await reopened.readAccountPending('user-a')).toEqual([])
  expect(await reopened.readAccountPending('user-b')).toHaveLength(1)
  expect(await reopened.readPending()).toHaveLength(1)
  await reopened.close()
})

it('rejects collisions within an account but not across accounts', async () => {
  const db = createStorage(`collision-${crypto.randomUUID()}`)
  const item = createItem('groceries', 'Молоко')
  const operation = { operationId: 'op', kind: 'upsert' as const, item }
  await db.enqueueAccountPending('a', operation)
  await db.enqueueAccountPending('a', operation)
  await expect(db.enqueueAccountPending('a', { ...operation, item: { ...item, purchased: true } })).rejects.toThrow()
  await db.enqueueAccountPending('b', { ...operation, item: { ...item, purchased: true } })
  await expect(db.readAccountPending('')).rejects.toThrow()
  await db.close()
})
