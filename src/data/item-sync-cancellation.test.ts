import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendItemCancellation, flushItemCancellations, parseItemCancellationReceipt } from './item-cancellation'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'
import { ListSyncLedger } from './list-sync-ledger'
import { PendingOperationMissingError } from './pending-operations'

const remote = '123e4567-e89b-42d3-a456-426614174000'
const setup = async () => {
  const name = 'item-cancel-' + crypto.randomUUID()
  const storage = createStorage(name)
  await storage.bindAccountList('a', 'groceries', remote)
  const item = createItem('groceries', 'Молоко')
  const add = { kind: 'cloud-add' as const, operationId: crypto.randomUUID(), localListId: 'groceries' as const,
    remoteListId: remote, itemId: item.id, item }
  return { storage, name, item, add }
}

describe('atomic cancellation of unsent item changes', () => {
  it('removes only the new item and its operation, even across a restart', async () => {
    const { storage, name, item, add } = await setup()
    const other = createItem('groceries', 'Хлеб')
    await storage.saveAccountEdit('a', add)
    await storage.saveAccountEdit('a', { ...add, operationId: crypto.randomUUID(), itemId: other.id, item: other })
    await storage.saveAccountItem('b', item)
    await storage.close()
    const reopened = createStorage(name)
    expect(await reopened.cancelUnsentAccountItemEdit('a', add.operationId, item.id)).toBe('cancelled')
    expect(await reopened.readAccountItems('a')).toEqual([other])
    expect(await reopened.readAccountPending('a')).toHaveLength(1)
    expect(await reopened.readAccountItems('b')).toEqual([item])
    await expect(reopened.claimAccountPending('a', add.operationId)).rejects.toBeInstanceOf(PendingOperationMissingError)
    await reopened.close()
  })
  it('restores a confirmed edit including quantity and purchased without changing version', async () => {
    const { storage, item, add } = await setup()
    await storage.saveAccountEdit('a', add)
    await storage.commitAccountReceipt('a', add.operationId, remote, item.id, 1)
    const update = { ...add, kind: 'cloud-update' as const, operationId: crypto.randomUUID(),
      expectedVersion: 1, item: { ...item, name: 'Молоко 2', quantity: 3, unit: 'л', purchased: true } }
    await storage.saveAccountEdit('a', update)
    const stale = await storage.readListSyncWork('a')
    expect(await storage.cancelUnsentAccountItemEdit('a', update.operationId, item.id)).toBe('cancelled')
    expect(await storage.readAccountItems('a')).toEqual([item])
    expect(await storage.readAccountPending('a')).toEqual([])
    expect((await storage.readAccountItemVersions('a'))[0].version).toBe(1)
    expect(storage.listSyncLedger.itemStates('a', stale).has(item.id)).toBe(false)
    await storage.close()
  })
  it('never rolls back claimed operations or changes from a different account/item', async () => {
    const { storage, item, add } = await setup()
    await storage.saveAccountEdit('a', add)
    expect(await storage.cancelUnsentAccountItemEdit('b', add.operationId, item.id)).toBe('missing')
    expect(await storage.cancelUnsentAccountItemEdit('a', add.operationId, crypto.randomUUID())).toBe('changed')
    await storage.claimAccountPending('a', add.operationId)
    expect(await storage.cancelUnsentAccountItemEdit('a', add.operationId, item.id)).toBe('requires-reconciliation')
    expect(await storage.readAccountItems('a')).toEqual([item])
    expect(await storage.readAccountPending('a')).toEqual([add])
    await storage.close()
  })
  it('serializes competing claim and cancellation without losing a dispatched operation', async () => {
    const { storage, item, add } = await setup()
    await storage.saveAccountEdit('a', add)
    const [claimed, cancelled] = await Promise.allSettled([
      storage.claimAccountPending('a', add.operationId),
      storage.cancelUnsentAccountItemEdit('a', add.operationId, item.id),
    ])
    if (claimed.status === 'fulfilled') {
      expect(cancelled).toEqual({ status: 'fulfilled', value: 'requires-reconciliation' })
      expect(await storage.readAccountPending('a')).toEqual([add])
    } else {
      expect(claimed.reason).toBeInstanceOf(PendingOperationMissingError)
      expect(cancelled).toEqual({ status: 'fulfilled', value: 'cancelled' })
      expect(await storage.readAccountPending('a')).toEqual([])
    }
    await storage.close()
  })
})

describe('item view of the shared synchronization ledger', () => {
  it('isolates same-list items and retains the actual receipt success window', () => {
    const ledger = new ListSyncLedger()
    ledger.queued('a', 'op1', ['L'], 'items', ['i1'])
    ledger.queued('a', 'op2', ['L'], 'items', ['i2'])
    ledger.begin('a', 'op1', ['L'], 'items')
    expect(ledger.itemStates('a', [], 100).get('i1')?.state).toBe('running')
    expect(ledger.itemStates('a', [], 100).get('i2')?.state).toBe('waiting')
    ledger.fail('a', 'op1')
    expect(ledger.itemStates('a', [], 100).get('i1')?.state).toBe('error')
    ledger.begin('a', 'op1', ['L'], 'items')
    ledger.confirm('a', 'op1', ['L'], 200)
    expect(ledger.itemStates('a', [], 5199).get('i1')?.state).toBe('success')
    expect(ledger.itemStates('a', [], 5200).has('i1')).toBe(false)
    expect(ledger.itemStates('b', [], 200).size).toBe(0)
    ledger.begin('a', 'list', ['L'], 'lists')
    expect(ledger.itemStates('a', [], 200).size).toBe(2)
    ledger.reset('a')
    expect(ledger.itemStates('a', [], 200).size).toBe(0)
  })
})

describe('durable uncertain cancellation', () => {
  it('survives reload, ignores a late original receipt and never resends the original payload', async () => {
    const {storage,name,item,add} = await setup()
    await storage.saveAccountEdit('a',add)
    await storage.claimAccountPending('a',add.operationId)
    expect(await storage.requestAccountItemCancellation('a',add.operationId,item.id)).toBe('queued')
    const original = (await storage.readAccountItemCancellations('a'))[0]
    await storage.commitAccountReceipt('a',add.operationId,remote,item.id,1)
    expect(await storage.readSyncableAccountPending('a')).toEqual([])
    expect(await storage.readAccountItemCancellations('a')).toEqual([original])
    await storage.close()
    const reopened = createStorage(name)
    expect(await reopened.readAccountItemCancellations('a')).toEqual([original])
    await expect(reopened.claimAccountPending('a',add.operationId)).rejects.toBeInstanceOf(PendingOperationMissingError)
    const rpc = vi.fn(async () => ({ data: {operation_id:add.operationId,cancellation_id:original.cancellationId,
      list_id:remote,item_id:item.id,status:'cancelled',item_version:2,item:null}, error:null }))
    const client = {rpc} as unknown as Pick<SupabaseClient,'rpc'>
    expect(await flushItemCancellations(reopened,client,'a',()=>true,()=>{})).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('cancel_e4_item_edit',expect.objectContaining({p_cancel:original.cancellationId,
      p_original:expect.objectContaining({operation_id:add.operationId})}))
    expect(await reopened.readAccountPending('a')).toEqual([])
    expect(await reopened.readAccountItems('a')).toEqual([])
    expect((await reopened.readAccountItemVersions('a'))[0].version).toBe(2)
    await reopened.close()
  })
  it('persists an error and retries the same cancellation ID without unblocking the item', async () => {
    const {storage,item,add} = await setup()
    await storage.saveAccountEdit('a',add)
    await storage.claimAccountPending('a',add.operationId)
    await storage.requestAccountItemCancellation('a',add.operationId,item.id)
    const cancellation = (await storage.readAccountItemCancellations('a'))[0]
    const rpc = vi.fn(async () => ({data:null,error:new Error('lost response')}))
    const client = {rpc} as unknown as Pick<SupabaseClient,'rpc'>
    expect(await flushItemCancellations(storage,client,'a',()=>true,()=>{})).toBeInstanceOf(Error)
    expect((await storage.readListSyncWork('a'))[0].phase).toBe('error')
    expect(await storage.readSyncableAccountPending('a')).toEqual([])
    expect(await storage.readAccountItems('a')).toEqual([item])
    await expect(sendItemCancellation(client,cancellation)).rejects.toThrow('lost response')
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(() => parseItemCancellationReceipt({operation_id:add.operationId,cancellation_id:'other'},cancellation)).toThrow()
    await storage.close()
  })
})
