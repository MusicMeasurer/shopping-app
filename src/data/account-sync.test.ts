import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import type { PendingItemOperation } from './pending-operations'
import { createAccountSync } from './account-sync'

const accountId = 'account-a'
const listId = '123e4567-e89b-42d3-a456-426614174000'
const itemId = '223e4567-e89b-42d3-a456-426614174001'
const operationId = '323e4567-e89b-42d3-a456-426614174002'
function setup(pending: PendingItemOperation[] = []) {
  const readAccountListMappings = vi.fn(async () => [{ key: 'a', accountId, localListId: 'groceries', remoteListId: listId }])
  const readAccountItems = vi.fn(async () => [
    { id: itemId, listId: 'groceries' as const, name: 'Молоко', purchased: false, createdAt: 1 },
    { id: 'house', listId: 'household' as const, name: 'Мыло', purchased: false, createdAt: 2 },
  ])
  const readAccountPending = vi.fn(async () => pending)
  const readAccountItemVersions = vi.fn(async () => [])
  const acknowledgeAccountPending = vi.fn(async () => {})
  const commitAccountReceipt = vi.fn(async () => {})
  const importRemoteOnlyBatch = vi.fn(async () => {})
  const applyReviewedRemoteDeletions = vi.fn(async () => {})
  const order = vi.fn(async (): Promise<{ data: Record<string, unknown>[]; error: null }> => ({ data: [], error: null }))
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ is: () => ({ order }), not: async () => ({ data: [], error: null }) }) }) }))
  const rpc = vi.fn(async () => ({ data: { operation_id: operationId, list_revision: 2, item_version: 1 }, error: null }))
  const storage = { readAccountItems, readAccountPending, acknowledgeAccountPending, readAccountListMappings, commitAccountReceipt, importRemoteOnlyBatch, readAccountItemVersions, applyReviewedRemoteDeletions } as unknown as Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings' | 'commitAccountReceipt' | 'importRemoteOnlyBatch' | 'readAccountItemVersions' | 'applyReviewedRemoteDeletions'>
  const client = { from, rpc } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>
  let active = true
  const sync = createAccountSync(storage, client, {
    accountId, remoteListId: listId, localListId: 'groceries',
    isActive: () => active,
    resolveMutation: operation => ({
      kind: 'add', operationId: operation.operationId, listId,
      itemId: operation.kind === 'upsert' ? operation.item.id : operation.itemId,
      name: 'Молоко', purchased: false,
    }),
  })
  return { sync, readAccountItems, readAccountPending, readAccountListMappings, acknowledgeAccountPending, commitAccountReceipt, importRemoteOnlyBatch, applyReviewedRemoteDeletions, readAccountItemVersions, order, rpc, deactivate: () => { active = false } }
}
describe('account-scoped sync binding', () => {
  it('rejects a changing server snapshot without writing imported items', async () => {
    const test = setup()
    const remote = { id: crypto.randomUUID(), list_id: listId, name: 'Соль',
      purchased: false, created_at: new Date().toISOString(), version: 1 }
    test.order.mockResolvedValueOnce({ data: [remote], error: null })
      .mockResolvedValueOnce({ data: [{ ...remote, version: 2 }], error: null })
    await expect(test.sync.importRemoteOnly()).rejects.toThrow('Remote list changed')
    expect(test.importRemoteOnlyBatch).not.toHaveBeenCalled()
  })

  it('stops import if account becomes inactive during the second server read', async () => {
    const test = setup()
    const remote = { id: crypto.randomUUID(), list_id: listId, name: 'Кофе',
      purchased: false, created_at: new Date().toISOString(), version: 1 }
    let calls = 0
    test.order.mockImplementation(async () => {
      calls++
      if (calls === 2) test.deactivate()
      return { data: [remote], error: null }
    })
    await expect(test.sync.importRemoteOnly()).rejects.toThrow('Account changed')
    expect(test.importRemoteOnlyBatch).not.toHaveBeenCalled()
  })

  it('does not import if an unconfirmed local edit conflicts with a server item', async () => {
    const pendingItem = { id: itemId, listId: 'groceries' as const,
      name: 'Чай', purchased: true, createdAt: 1 }
    const test = setup([{ kind: 'cloud-update', operationId: crypto.randomUUID(),
      itemId: pendingItem.id, localListId: 'groceries', remoteListId: listId,
      expectedVersion: 1, item: pendingItem }])
    const remote = { id: pendingItem.id, list_id: listId, name: 'Чай',
      purchased: false, created_at: new Date().toISOString(), version: 2 }
    test.order.mockResolvedValue({ data: [remote], error: null })
    await expect(test.sync.importRemoteOnly()).rejects.toThrow('conflicting items')
    expect(test.importRemoteOnlyBatch).not.toHaveBeenCalled()
  })

  it('imports unchanged remote-only items in one batch', async () => {
    const test = setup()
    const remote = { id: crypto.randomUUID(), list_id: listId, name: 'Соль',
      purchased: false, created_at: new Date().toISOString(), version: 1 }
    test.order.mockResolvedValue({ data: [remote], error: null })
    await expect(test.sync.importRemoteOnly()).resolves.toBe(1)
    expect(test.importRemoteOnlyBatch).toHaveBeenCalledTimes(1)
    expect(test.importRemoteOnlyBatch).toHaveBeenCalledWith(accountId, listId,
      [expect.objectContaining({ item: expect.objectContaining({ id: remote.id }), version: 1 })])
  })

  it('requires explicit deletion selection and never applies empty selection', async () => {
    const test = setup()
    await expect(test.sync.applyConfirmedDeletions([])).rejects.toThrow('Explicit')
    expect(test.applyReviewedRemoteDeletions).not.toHaveBeenCalled()
  })

  it('refuses a deletion without a confirmed local version', async () => {
    const test = setup()
    const deleted = { id: itemId, list_id: listId, version: 3,
      deleted_at: '2026-11-07T00:00:00Z' }
    test.order.mockResolvedValue({ data: [deleted], error: null })
    await expect(test.sync.applyConfirmedDeletions([itemId])).rejects.toThrow('unresolved conflict')
    expect(test.applyReviewedRemoteDeletions).not.toHaveBeenCalled()
  })

  it('reads only account items and excludes other local lists', async () => {
    const test = setup()
    const preview = await test.sync.preview()
    expect(preview.visible.map(item => item.id)).toEqual([itemId])
    expect(test.readAccountItems).toHaveBeenCalledWith(accountId)
    expect(test.readAccountPending).toHaveBeenCalledWith(accountId)
  })
  it('leaves another list pending while flushing only the selected list', async () => {
    const otherOperationId = crypto.randomUUID()
    const otherListId = crypto.randomUUID()
    const test = setup([
      { kind: 'cloud-add', operationId: otherOperationId, localListId: 'household',
        remoteListId: otherListId, itemId: crypto.randomUUID(),
        item: { id: crypto.randomUUID(), listId: 'household', name: 'Мыло', purchased: false, createdAt: 1 } },
      { kind: 'cloud-add', operationId, localListId: 'groceries', remoteListId: listId,
        itemId, item: { id: itemId, listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 } },
    ])
    await test.sync.flush()
    expect(test.rpc).toHaveBeenCalledTimes(1)
    expect(test.commitAccountReceipt).toHaveBeenCalledExactlyOnceWith(accountId, operationId, listId, itemId, 1)
    expect(test.acknowledgeAccountPending).not.toHaveBeenCalled()
  })
  it('rejects unscoped pending deletes until durable list mapping exists', async () => {
    const test = setup([{ kind: 'delete', operationId, itemId }])
    await expect(test.sync.flush()).rejects.toThrow('durable list mapping')
    expect(test.rpc).not.toHaveBeenCalled()
  })
  it('rejects absent durable list mapping before reading account items', async () => {
    const test = setup()
    test.readAccountListMappings.mockResolvedValueOnce([])
    await expect(test.sync.preview()).rejects.toThrow('Missing verified account list mapping')
    expect(test.readAccountItems).not.toHaveBeenCalled()
    expect(test.rpc).not.toHaveBeenCalled()
  })
  it('does not access storage after account invalidation', async () => {
    const test = setup()
    test.deactivate()
    await expect(test.sync.preview()).rejects.toThrow('Account changed')
    expect(test.readAccountItems).not.toHaveBeenCalled()
  })
})
