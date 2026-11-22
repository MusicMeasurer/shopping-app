import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pullAccountFeed } from './account-feed'
import { flushAccountBatch } from './account-batch'
import { createStorage } from './storage'

const account = '10000000-0000-4000-8000-000000000001'
const listId = '20000000-0000-4000-8000-000000000001'
const itemId = '30000000-0000-4000-8000-000000000001'
const timestamp = '2026-11-22T00:00:00Z'
const list = { id: listId, owner_id: account, name: 'Food', kind: 'permanent', position: 0, revision: 1 }
const item = { id: itemId, list_id: listId, name: 'Milk', purchased: false, version: 1, created_at: timestamp }
const active = () => true

it('restores one snapshot, then resumes after restart with only the changed item among 50 lists', async () => {
  const db = crypto.randomUUID()
  let storage = createStorage(db)
  const lists = [list, ...Array.from({ length: 49 }, (_, index) => ({ ...list, id: crypto.randomUUID(), position: index + 1 }))]
  const rpc = vi.fn().mockResolvedValueOnce({ data: { position: '123', lists, items: [item] }, error: null })
  const client = { rpc } as unknown as SupabaseClient
  expect(await pullAccountFeed(client, storage, account, active)).toBe(true)
  await storage.close()
  storage = createStorage(db)
  rpc.mockResolvedValueOnce({ data: [{ event_position: '124', entity: 'item', list_id: listId,
    entity_id: itemId, deleted: false, snapshot: { ...item, purchased: true, version: 2 } }], error: null })
  expect(await pullAccountFeed(client, storage, account, active)).toBe(true)
  expect(rpc.mock.calls).toEqual([
    ['snapshot_e4_account_changes', { p_account: account }],
    ['pull_e4_account_changes', { p_account: account, p_after: '123', p_limit: 200 }],
  ])
  expect(await storage.readAccountFeedLists(account)).toHaveLength(50)
  expect(await storage.readAccountItems(account)).toMatchObject([{ id: itemId, purchased: true }])
  await storage.close()
})

it('keeps a local edit through a cloud deletion and applies the deferred event once the queue clears', async () => {
  const storage = createStorage(crypto.randomUUID())
  const deletion = { event_position: '2', entity: 'item', list_id: listId, entity_id: itemId, deleted: true, snapshot: null }
  const rpc = vi.fn().mockResolvedValueOnce({ data: { position: '1', lists: [list], items: [item] }, error: null })
    .mockResolvedValueOnce({ data: [deletion], error: null }).mockResolvedValueOnce({ data: [], error: null })
  const client = { rpc } as unknown as SupabaseClient
  await pullAccountFeed(client, storage, account, active)
  const [current] = await storage.readAccountItems(account)
  await storage.saveAccountEdit(account, { kind: 'cloud-update', localListId: listId, remoteListId: listId,
    operationId: crypto.randomUUID(), itemId, expectedVersion: 1, item: { ...current, purchased: true } })
  await pullAccountFeed(client, storage, account, active)
  expect(await storage.readAccountFeedPosition(account)).toBe('2')
  expect(await storage.readAccountItems(account)).toMatchObject([{ id: itemId, purchased: true }])
  const [pending] = await storage.readAccountPending(account)
  await storage.acknowledgeAccountPending(account, pending.operationId)
  await pullAccountFeed(client, storage, account, active)
  expect(await storage.readAccountItems(account)).toEqual([])
  await storage.close()
})

it('fails closed on an out-of-order page and recovers from an expired position', async () => {
  const storage = createStorage(crypto.randomUUID())
  const rpc = vi.fn().mockResolvedValueOnce({ data: { position: '1', lists: [list], items: [item] }, error: null })
    .mockResolvedValueOnce({ data: [{ event_position: '3' }], error: null })
    .mockResolvedValueOnce({ error: { code: 'P0002' } })
    .mockResolvedValueOnce({ data: { position: '8', lists: [list], items: [] }, error: null })
  const client = { rpc } as unknown as SupabaseClient
  await pullAccountFeed(client, storage, account, active)
  await expect(pullAccountFeed(client, storage, account, active)).rejects.toThrow('Non-contiguous')
  expect(await storage.readAccountFeedPosition(account)).toBe('1')
  expect(await storage.readAccountItems(account)).toHaveLength(1)
  await pullAccountFeed(client, storage, account, active)
  expect(await storage.readAccountFeedPosition(account)).toBe('8')
  expect(await storage.readAccountItems(account)).toEqual([])
  await storage.close()
})

it('retries a lost batch with stable IDs and acknowledges only confirmed operations', async () => {
  const storage = createStorage(crypto.randomUUID())
  await storage.bindAccountList(account, listId, listId)
  const items = ['Milk', 'Bread'].map(name => ({ id: crypto.randomUUID(), listId, name, purchased: false, createdAt: 0 }))
  await storage.saveAccountItemsToSync(account, items)
  const rpc = vi.fn().mockRejectedValueOnce(new Error('Network lost')).mockImplementationOnce(async (_method, args) => {
    return { data: args.p_operations.map(({ operation_id }: { operation_id: string }, index: number) => index === 0
      ? { receipt: { operation_id, list_revision: 1, item_version: 1 } }
      : { operation_id, code: '23505', message: 'Operation rejected' }), error: null }
  })
  const client = { rpc } as unknown as SupabaseClient
  await expect(flushAccountBatch(storage, client, account, active, () => {})).rejects.toThrow('Network lost')
  expect(await storage.readAccountPending(account)).toHaveLength(2)
  await expect(flushAccountBatch(storage, client, account, active, () => {})).rejects.toThrow('Operation rejected')
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  expect(await storage.readAccountPending(account)).toHaveLength(1)
  await storage.close()
})
