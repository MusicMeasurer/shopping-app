import { describe, expect, it, vi } from 'vitest'
import { createCloudCompletionCoordinator } from './cloud-completion-coordinator'
import type { CloudCompletionIntent } from './storage'

const accountId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const remoteListId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const operationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const intent: CloudCompletionIntent = {
  accountId, localListId: 'groceries', remoteListId, operationId,
  expectedRevision: 1, mode: 'marked_only', itemIds: [itemId], createdAt: 100,
}
const receipt = {
  operation_id: operationId, list_id: remoteListId, revision: 2,
  item_count: 1, archive_id: null, kind: 'permanent', mode: 'marked_only',
}
function fixture() {
  let intents: CloudCompletionIntent[] = []
  let local = [{ id: itemId, listId: 'groceries', name: 'Milk', purchased: true }]
  let crash = false
  const storage = {
    readAccountCompletions: vi.fn(async () => intents),
    beginAccountCompletion: vi.fn(async (value: CloudCompletionIntent) => { intents = [value] }),
    commitAccountCompletion: vi.fn(async (value: CloudCompletionIntent) => {
      if (crash) throw new Error('IndexedDB interrupted')
      expect(intents).toEqual([value])
      intents = []; local = []
    }),
    readAccountItems: vi.fn(async () => local),
    readAccountPending: vi.fn(async () => []),
    readAccountListMappings: vi.fn(async () => [{ localListId: 'groceries', remoteListId }]),
  }
  const rpc = vi.fn(async () => ({ data: receipt, error: null }))
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ not: async () => ({ data: [{
    id: itemId, list_id: remoteListId, version: 2, deleted_at: '2026-11-12T12:00:00Z',
  }], error: null }) }) }) }))
  return {
    storage, rpc, setCrash: (v: boolean) => { crash = v },
    getIntents: () => intents,
    coordinator: createCloudCompletionCoordinator(storage as never, { rpc, from } as never, accountId, () => true),
  }
}
describe('durable E4 cloud completion coordinator', () => {
  it('recovers a committed server operation after local commit failure using the same UUID', async () => {
    const f = fixture()
    await f.storage.beginAccountCompletion(intent)
    f.setCrash(true)
    await expect(f.coordinator.resume(intent)).rejects.toThrow('IndexedDB interrupted')
    expect(f.getIntents()).toEqual([intent])
    f.setCrash(false)
    expect(await f.coordinator.recoverAll()).toHaveLength(1)
    expect(f.getIntents()).toEqual([])
    expect(f.rpc).toHaveBeenCalledTimes(2)
    expect(f.rpc.mock.calls[0]).toEqual(f.rpc.mock.calls[1])
  })
  it('does not call RPC for missing or foreign-account intent', async () => {
    const f = fixture()
    await expect(f.coordinator.resume(intent)).rejects.toThrow('Missing durable')
    await expect(f.coordinator.resume({ ...intent, accountId: 'other' })).rejects.toThrow('Foreign account')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('keeps the intent if the server fails', async () => {
    const f = fixture()
    await f.storage.beginAccountCompletion(intent)
    f.rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(f.coordinator.resume(intent)).rejects.toThrow('offline')
    expect(f.getIntents()).toEqual([intent])
  })
})
