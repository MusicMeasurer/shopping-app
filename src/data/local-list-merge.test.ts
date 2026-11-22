import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

const accountId = 'account-a'
async function fixture() {
  const name = 'local-merge-' + crypto.randomUUID()
  const db = createStorage(name)
  const source = { id: crypto.randomUUID(), ownerId: accountId, name: 'Поездка', kind: 'oneoff' as const, position: 0, revision: 1 }
  const target = { ...source, id: crypto.randomUUID(), name: 'Дом', kind: 'permanent' as const, position: 1 }
  await db.bindAccountList(accountId, source.id, source.id)
  await db.bindAccountList(accountId, target.id, target.id)
  await db.cacheAccountListMetadata(accountId, [source, target])
  const sourceItem = createItem(source.id, 'Хлеб')
  const targetItem = createItem(target.id, 'Молоко')
  await db.saveAccountItem(accountId, sourceItem)
  await db.saveAccountItem(accountId, targetItem)
  const expected = await db.readLocalListMerge(accountId, source.id, target.id)
  const operationId = crypto.randomUUID()
  return { db, name, source, target, sourceItem, targetItem, expected, operationId }
}

it('persists a merge and replay revisions across restart, then replaces both cached snapshots atomically', async () => {
  const { db, name, source, target, sourceItem, targetItem, expected, operationId } = await fixture()
  await db.queueLocalListMerge(accountId, expected, new Map(), operationId)
  expect(await db.hasAccountSyncWork(accountId)).toBe(true)
  expect(await db.readQueuedListMerges('another-account')).toEqual([])
  await expect(db.saveAccountItemsToSync(accountId, [createItem(target.id, 'Чай')])).rejects.toThrow(/Объединение/)
  const [pending] = await db.readQueuedListMerges(accountId)
  expect(pending.result).toEqual(expect.arrayContaining([{ ...sourceItem, listId: target.id }, targetItem]))
  expect(await db.readAccountItems(accountId)).toEqual(expect.arrayContaining([sourceItem, targetItem]))
  const revisions = { sourceRevision: 2, targetRevision: 4 }
  await db.prepareQueuedListMerge(accountId, pending, revisions)
  await db.close()
  const reopened = createStorage(name)
  const [prepared] = await reopened.readQueuedListMerges(accountId)
  expect(prepared).toMatchObject({ operationId, revisions })
  expect(await reopened.prepareQueuedListMerge(accountId, prepared, { sourceRevision: 3, targetRevision: 5 }))
    .toMatchObject({ operationId, revisions })
  const moved = { ...sourceItem, id: crypto.randomUUID(), listId: target.id }
  const confirmed = [{ item: moved, version: 1 }, { item: targetItem, version: 3 }]
  await reopened.finishQueuedListMerge(accountId, prepared, confirmed)
  await reopened.finishQueuedListMerge(accountId, prepared, confirmed)
  expect(await reopened.readAccountItems(accountId)).toEqual(expect.arrayContaining([moved, targetItem]))
  expect(await reopened.readAccountItems(accountId)).toHaveLength(2)
  expect(await reopened.readAccountListMappings(accountId)).toMatchObject([{ localListId: target.id }])
  expect(await reopened.readAccountArchive(accountId)).toBeNull()
  expect(await reopened.hasAccountSyncWork(accountId)).toBe(false)
  await reopened.close()
})

it('keeps originals when a stale merge is rejected', async () => {
  const { db, expected, sourceItem, targetItem, operationId } = await fixture()
  await db.queueLocalListMerge(accountId, expected, new Map(), operationId)
  const [pending] = await db.readQueuedListMerges(accountId)
  await db.finishQueuedListMerge(accountId, pending)
  expect(await db.readAccountItems(accountId)).toEqual(expect.arrayContaining([sourceItem, targetItem]))
  expect(await db.readAccountListMappings(accountId)).toHaveLength(2)
  expect(await db.readQueuedListMerges(accountId)).toEqual([])
  await db.close()
})
