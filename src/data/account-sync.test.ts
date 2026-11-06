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
  const acknowledgeAccountPending = vi.fn(async () => {})
  const commitAccountReceipt = vi.fn(async () => {})
  const importRemoteOnlyItem = vi.fn(async () => {})
  const order = vi.fn(async () => ({ data: [], error: null }))
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ is: () => ({ order }) }) }) }))
  const rpc = vi.fn(async () => ({ data: { operation_id: operationId, list_revision: 2, item_version: 1 }, error: null }))
  const storage = { readAccountItems, readAccountPending, acknowledgeAccountPending, readAccountListMappings, commitAccountReceipt, importRemoteOnlyItem } as unknown as Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings' | 'commitAccountReceipt' | 'importRemoteOnlyItem'>
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
  return { sync, readAccountItems, readAccountPending, readAccountListMappings, acknowledgeAccountPending, commitAccountReceipt, rpc, deactivate: () => { active = false } }
}
describe('account-scoped sync binding', () => {
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
