import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createStorage, type CloudCompletionIntent } from './storage'
import { createItem } from '../domain/shopping'

const accountId = 'account-a'
const remoteListId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const operationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
function intent(itemId: string): CloudCompletionIntent {
  return { accountId, localListId: 'groceries', remoteListId, operationId,
    expectedRevision: 1, mode: 'marked_only', itemIds: [itemId], createdAt: 100 }
}
describe('durable E4 completion IndexedDB v11', () => {
  it('persists an intent across restart, fences edits, and atomically reconciles after receipt', async () => {
    const name = 'completion-' + crypto.randomUUID()
    const first = createStorage(name)
    const item = createItem('groceries', 'Молоко')
    await first.bindAccountList(accountId, 'groceries', remoteListId)
    await first.saveAccountItem(accountId, item)
    const saved = intent(item.id)
    await first.beginAccountCompletion(saved)
    await first.close()
    const second = createStorage(name)
    expect(await second.readAccountCompletions(accountId)).toEqual([saved])
    await expect(second.saveAccountEdit(accountId, {
      kind: 'cloud-update', operationId: crypto.randomUUID(), itemId: item.id,
      localListId: 'groceries', remoteListId, expectedVersion: 1, item: { ...item, purchased: true },
    })).rejects.toThrow('Completion pending')
    await expect(second.enqueueAccountPending(accountId, {
      kind: 'upsert', operationId: crypto.randomUUID(), item,
    })).rejects.toThrow('Completion pending')
    await expect(second.saveAccountItem(accountId, { ...item, purchased: true }))
      .rejects.toThrow('Completion pending')
    await expect(second.removeAccountItem(accountId, item.id))
      .rejects.toThrow('Completion pending')
    await expect(second.importRemoteOnlyBatch(accountId, remoteListId, [{
      item: { ...item, id: crypto.randomUUID() }, version: 1,
    }])).rejects.toThrow('Completion pending')
    await expect(second.applyReviewedRemoteDeletions(accountId, remoteListId, [{
      item, expectedLocalVersion: 1, serverDeletedVersion: 2,
    }])).rejects.toThrow('Completion pending')
    await expect(second.commitAccountCompletion({ ...saved, expectedRevision: 9 }, 3, [{ id: item.id, version: 2 }])).rejects.toThrow()
    expect(await second.readAccountItems(accountId)).toEqual([item])
    await second.commitAccountCompletion(saved, 3, [{ id: item.id, version: 2 }])
    expect(await second.readAccountItems(accountId)).toEqual([])
    expect(await second.readAccountCompletions(accountId)).toEqual([])
    expect((await second.readAccountItemVersions(accountId)).find(row => row.itemId === item.id)?.version).toBe(2)
    await second.close()
  })
  it('refuses to create an intent while writes are queued', async () => {
    const db = createStorage('completion-queued-' + crypto.randomUUID())
    const item = createItem('groceries', 'Хлеб')
    await db.bindAccountList(accountId, 'groceries', remoteListId)
    await db.saveAccountItem(accountId, item)
    await db.enqueueAccountPending(accountId, { kind: 'upsert', operationId: crypto.randomUUID(), item })
    await expect(db.beginAccountCompletion(intent(item.id))).rejects.toThrow('Unsent operations')
    expect(await db.readAccountCompletions(accountId)).toEqual([])
    await db.close()
  })
})

it('keeps requests for different lists across restart and clears only the confirmed request', async () => {
  const name = 'completion-request-' + crypto.randomUUID()
  const db = createStorage(name)
  const item = createItem('groceries', 'Молоко')
  const saved = intent(item.id)
  const secondRemote = crypto.randomUUID()
  const firstRequest = {
    accountId, localListId: 'groceries', remoteListId, operationId, mode: 'marked_only' as const, name: 'Продукты', createdAt: 100,
  }
  const secondRequest = {
    ...firstRequest, localListId: 'household', remoteListId: secondRemote, operationId: crypto.randomUUID(), createdAt: 101,
  }
  await db.bindAccountList(accountId, 'groceries', remoteListId)
  await db.bindAccountList(accountId, 'household', secondRemote)
  await db.saveAccountItem(accountId, item)
  await db.queueAccountCompletion(firstRequest)
  await db.queueAccountCompletion(secondRequest)
  await expect(db.queueAccountCompletion(firstRequest)).rejects.toThrow()
  await expect(db.saveAccountItemsToSync(accountId, [createItem('groceries', 'Хлеб')])).rejects.toThrow('Completion pending')
  await db.close()
  const reopened = createStorage(name)
  expect(await reopened.readAccountCompletionRequests(accountId)).toEqual([firstRequest, secondRequest])
  expect(await reopened.readAccountCompletionRequests('account-b')).toEqual([])
  await reopened.beginAccountCompletion(saved, true)
  expect(await reopened.cancelUnsentAccountCompletion(firstRequest)).toBe(false)
  await reopened.commitAccountCompletion(saved, 3, [{ id: item.id, version: 2 }])
  expect(await reopened.readAccountCompletionRequests(accountId)).toEqual([secondRequest])
  expect(await reopened.hasAccountSyncWork(accountId)).toBe(true)
  expect(await reopened.cancelUnsentAccountCompletion(secondRequest)).toBe(true)
  expect(await reopened.hasAccountSyncWork(accountId)).toBe(false)
  await reopened.close()
})

it('recovers a partial archive intent after restart and preserves unmarked account items', async () => {
  const name = 'partial-archive-' + crypto.randomUUID()
  const first = createStorage(name)
  const marked = { ...createItem('groceries', 'Сыр'), purchased: true }
  const unmarked = createItem('groceries', 'Молоко')
  await first.bindAccountList(accountId, 'groceries', remoteListId)
  await first.saveAccountItem(accountId, marked)
  await first.saveAccountItem(accountId, unmarked)
  const saved: CloudCompletionIntent = { ...intent(marked.id), mode: 'archive_purchased' }
  const request = {
    operationId, accountId, localListId: 'groceries', remoteListId, mode: saved.mode, name: 'Продукты',
    createdAt: 100, confirmedItemIds: [marked.id],
  }
  await expect(first.queueAccountCompletion({ ...request, confirmedItemIds: [unmarked.id] })).rejects.toThrow('Список изменился')
  await first.queueAccountCompletion(request)
  await first.beginAccountCompletion(saved, true)
  await first.close()
  const reopened = createStorage(name)
  expect(await reopened.readAccountCompletions(accountId)).toEqual([saved])
  await expect(reopened.commitAccountCompletion(saved, 2, [{ id: unmarked.id, version: 2 }])).rejects.toThrow('Invalid confirmed')
  await reopened.commitAccountCompletion(saved, 2, [{ id: marked.id, version: 2 }])
  expect(await reopened.readAccountItems(accountId)).toEqual([unmarked])
  expect(await reopened.readAccountCompletions(accountId)).toEqual([])
  expect(await reopened.readAccountCompletionRequests(accountId)).toEqual([])
  expect(await reopened.readAccountListMappings(accountId)).toHaveLength(1)
  await reopened.close()
})

it('projects pending purchases across restart, then replaces the provisional entry with one confirmed archive entry', async () => {
  const name = 'local-archive-' + crypto.randomUUID()
  const db = createStorage(name)
  const marked = { ...createItem('groceries', 'Сыр'), purchased: true, quantity: 2, unit: 'кг' }
  const unmarked = createItem('groceries', 'Молоко')
  const request = { ...intent(marked.id), mode: 'archive_purchased' as const, name: 'Продукты', confirmedItemIds: [marked.id] }
  await db.bindAccountList(accountId, 'groceries', remoteListId)
  await db.saveAccountItem(accountId, marked)
  await db.saveAccountItem(accountId, unmarked)
  await db.queueAccountCompletion(request, true)
  await db.close()

  const reopened = createStorage(name)
  expect((await reopened.readLocalCompletionView(accountId)).operations).toEqual([
    { localListId: 'groceries', mode: 'archive_purchased', hiddenItemIds: [marked.id] },
  ])
  const provisional = (await reopened.readLocalCompletionView(accountId)).snapshots!
  expect(provisional).toHaveLength(1)
  expect(provisional[0]).toMatchObject({ pending: true, items: [{ name: 'Сыр', quantity: 2, unit: 'кг' }] })
  expect((await reopened.readLocalCompletionView('other-account')).snapshots).toBeNull()
  expect(await reopened.readAccountItems(accountId)).toEqual(expect.arrayContaining([marked, unmarked]))
  const saved = { ...intent(marked.id), mode: request.mode }
  await reopened.beginAccountCompletion(saved, true)
  const archiveId = crypto.randomUUID()
  await reopened.commitAccountCompletion(saved, 2, [{ id: marked.id, version: 2 }], { archiveId, kind: 'oneoff' })
  expect(await reopened.readAccountItems(accountId)).toEqual([unmarked])
  const confirmed = await reopened.readLocalCompletionView(accountId)
  expect(confirmed.operations).toEqual([])
  expect(confirmed.snapshots).toHaveLength(1)
  expect(confirmed.snapshots![0]).toMatchObject({ id: archiveId, operationId })
  expect(confirmed.snapshots![0].pending).toBeUndefined()
  await expect(reopened.commitAccountCompletion(saved, 2, [{ id: marked.id, version: 2 }], { archiveId, kind: 'oneoff' })).rejects.toThrow()
  expect((await reopened.readLocalCompletionView(accountId)).snapshots).toHaveLength(1)
  await reopened.close()
})

it('does not create an archive placeholder for deletion and restores the list projection on a rejected request', async () => {
  const db = createStorage('local-removal-' + crypto.randomUUID())
  const item = createItem('groceries', 'Хлеб')
  await db.bindAccountList(accountId, 'groceries', remoteListId)
  await db.saveAccountItem(accountId, item)
  const { expectedRevision: _revision, itemIds: _items, ...base } = intent(item.id)
  const request = { ...base, mode: 'delete_list' as const, name: 'Продукты', confirmedMarked: false }
  await db.queueAccountCompletion(request, true)
  const pending = await db.readLocalCompletionView(accountId)
  expect(pending.snapshots).toBeNull()
  expect(pending.operations).toEqual([{ localListId: 'groceries', mode: 'delete_list', hiddenItemIds: [item.id] }])

  const saved = { ...intent(item.id), mode: request.mode }
  await db.beginAccountCompletion(saved, true)
  await db.discardRejectedCompletion(saved)
  expect((await db.readLocalCompletionView(accountId)).operations).toEqual([])
  expect(await db.readAccountItems(accountId)).toEqual([item])
  await db.close()
})

it('persists local metadata edits in order and keeps the replay revision when the server response is lost', async () => {
  const name = 'local-list-changes-' + crypto.randomUUID()
  const first = createStorage(name)
  const secondId = crypto.randomUUID()
  const firstList = { id: remoteListId, ownerId: accountId, name: 'Продукты', kind: 'permanent' as const, position: 0, revision: 1 }
  const secondList = { ...firstList, id: secondId, position: 1, name: 'Дом' }
  await first.bindAccountList(accountId, 'groceries', remoteListId)
  await first.bindAccountList(accountId, 'other', secondId)
  await first.cacheAccountListMetadata(accountId, [firstList, secondList])
  await first.queueLocalListChange(accountId, 'groceries', 'rename', 'Поездка')
  await first.queueLocalListChange(accountId, 'groceries', 'kind', 'oneoff')
  await first.queueLocalListChange(accountId, 'groceries', 'reorder', 'other')
  const firstChange = (await first.readLocalListChanges(accountId))[0]
  await first.prepareLocalListChange(accountId, firstChange, firstList)
  await first.close()

  const reopened = createStorage(name)
  expect(await reopened.hasAccountSyncWork(accountId)).toBe(true)
  expect(await reopened.hasAccountSyncWork('other-account')).toBe(false)
  expect(await reopened.readLocalListMappings(accountId)).toMatchObject([
    { localListId: 'groceries', metadata: { name: 'Поездка', kind: 'oneoff', position: 1 } },
    { localListId: 'other', metadata: { name: 'Дом', position: 0 } },
  ])
  const recovered = await reopened.readLocalListChanges(accountId)
  expect(recovered.map(row => row.change.action)).toEqual(['rename', 'kind', 'reorder'])
  expect(await reopened.prepareLocalListChange(accountId, recovered[0], { ...firstList, revision: 2 })).toEqual(firstList)
  await reopened.finishLocalListChange(accountId, recovered[0])
  expect((await reopened.readLocalListChanges(accountId)).map(row => row.change.action)).toEqual(['kind', 'reorder'])
  await reopened.close()
})
