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
    await expect(second.commitAccountCompletion({ ...saved, expectedRevision: 9 }, 3)).rejects.toThrow()
    expect(await second.readAccountItems(accountId)).toEqual([item])
    await second.commitAccountCompletion(saved, 3)
    expect(await second.readAccountItems(accountId)).toEqual([])
    expect(await second.readAccountCompletions(accountId)).toEqual([])
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
