import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createItem } from '../domain/shopping'
import { createAccountSync } from './account-sync'
import { cloudAwareItemStore } from './cloud-aware-item-store'
import { mergeItemEdit } from './item-conflict'
import { createStorage } from './storage'

it('merges independent fields, keeps amount and unit together, and prefers cloud on a tie', () => {
  const base = { ...createItem('groceries', 'Молоко'), quantity: 1, unit: 'л' }
  const local = { ...base, name: 'Молоко 2%', quantity: 2 }
  const cloud = { ...base, quantity: 3, unit: 'уп.', purchased: true }
  expect(mergeItemEdit(base, local, cloud, { name: 1, amount: 2 }, { amount: 2 })).toEqual({
    ...cloud, name: local.name,
  })
  expect(mergeItemEdit(base, local, cloud, { name: 1, amount: 3 }, { amount: 2 })).toEqual({
    ...cloud, name: local.name, quantity: 2, unit: 'л',
  })
})

async function setup(deletedInCloud: boolean) {
  const dbName = 'item-conflict-' + crypto.randomUUID()
  const storage = createStorage(dbName)
  const remoteListId = crypto.randomUUID()
  const item = { ...createItem('groceries', 'Молоко'), quantity: 1, unit: 'л' }
  await storage.bindAccountList('a', 'groceries', remoteListId)
  await storage.importRemoteOnlyItem('a', remoteListId, item, 1)
  const remote = {
    id: item.id, list_id: remoteListId, name: item.name, purchased: true, quantity: 3, unit: 'л',
    version: 2, created_at: new Date(item.createdAt).toISOString(), updated_at: new Date(Date.now() + 60_000).toISOString(),
    deleted_at: deletedInCloud ? new Date().toISOString() : null,
  }
  const mutations: Record<string, unknown>[] = []
  const client = {
    from: () => ({ select: () => ({ eq: () => ({
      is: () => ({ order: async () => ({ data: remote.deleted_at ? [] : [remote] }) }),
      not: async () => ({ data: remote.deleted_at ? [remote] : [] }),
    }) }) }),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      mutations.push(args)
      if (args.p_expected_version === 1)
        return { error: { message: remote.deleted_at ? 'Item unavailable' : 'Version conflict' } }
      return { data: { operation_id: args.p_operation, item_version: 3, list_revision: 3 } }
    },
  } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>
  const sync = (db = storage) => createAccountSync(db, client, {
    accountId: 'a', localListId: 'groceries', remoteListId, isActive: () => true,
  })
  return { dbName, storage, item, remote, store: cloudAwareItemStore(storage, 'a'), sync, mutations }
}

it('rebases an independent local edit and accepts a newer cloud amount and mark', async () => {
  const { storage, item, store, sync, mutations } = await setup(false)
  await store.save({ ...item, name: 'Молоко 2%', quantity: 2 }, true)
  expect(await sync().flush()).toBe(1)
  expect(await store.read()).toEqual([{ ...item, name: 'Молоко 2%', quantity: 3, purchased: true }])
  expect(mutations[1]).toMatchObject({ p_expected_version: 2, p_quantity: 3, p_purchased: true })
  expect(mutations[1].p_operation).not.toBe(mutations[0].p_operation)
  expect(await storage.readAccountPending('a')).toEqual([])
  await storage.close()
})

it('parks a remote deletion across restart, sends other edits, then restores the item explicitly', async () => {
  const { dbName, storage, item, store, sync } = await setup(true)
  await store.save({ ...item, quantity: 2 }, true)
  const otherItem = createItem('groceries', 'Хлеб')
  await store.save(otherItem)
  expect(await sync().flush()).toBe(1)
  await storage.close()
  const reopened = createStorage(dbName)
  const [conflict] = await reopened.readItemDeletionConflicts('a')
  expect(conflict).toMatchObject({ deleted: 'cloud', item: { id: item.id, quantity: 2 } })
  expect(await reopened.readItemDeletionConflicts('b')).toEqual([])
  await sync(reopened).resolveItemDeletion(conflict, true)
  await sync(reopened).flush()
  expect(await reopened.readItemDeletionConflicts('a')).toEqual([])
  expect(await reopened.readAccountItems('a')).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Молоко', quantity: 2 }),
    otherItem,
  ]))
  await reopened.close()
})

it('marks a local deletion versus cloud edit and honors explicit deletion', async () => {
  const { storage, item, store, sync, mutations } = await setup(false)
  await store.remove(item.id)
  expect(await sync().flush()).toBe(0)
  const [conflict] = await storage.readItemDeletionConflicts('a')
  expect(conflict).toMatchObject({ deleted: 'local', item: { quantity: 3, purchased: true } })
  await sync().resolveItemDeletion(conflict, false)
  expect(await sync().flush()).toBe(1)
  expect(mutations.at(-1)).toMatchObject({ p_action: 'delete', p_expected_version: 2 })
  expect(await store.read()).toEqual([])
  await storage.close()
})

it('compares the amount with its own database timestamp despite a later cloud purchase mark', async () => {
  const { storage, item, remote, store, sync, mutations } = await setup(false)
  const before = new Date(Date.now() - 60_000).toISOString()
  Object.assign(remote, { field_changed_at: { name: before, amount: before, purchased: remote.updated_at } })
  await store.save({ ...item, quantity: 2 }, true)
  expect(await sync().flush()).toBe(1)
  expect(await store.read()).toEqual([{ ...item, quantity: 2, purchased: true }])
  expect(mutations[1]).toMatchObject({ p_quantity: 2, p_purchased: true })
  await storage.close()
})

it('retains an older conflicting operation without blocking a new item in the same list', async () => {
  const { dbName, storage, item, remote, store, sync } = await setup(false)
  const legacyOperation = {
    operationId: '00000000-0000-4000-8000-000000000000', itemId: item.id,
    kind: 'cloud-update' as const, localListId: 'groceries' as const,
    remoteListId: remote.list_id, expectedVersion: 1, item: { ...item, quantity: 2 },
  }
  await storage.enqueueAccountPending('a', legacyOperation)
  await store.save(createItem('groceries', 'Хлеб'))
  expect(await sync().flush()).toBe(1)
  await storage.close()
  const reopened = createStorage(dbName)
  expect(await reopened.readAccountPending('a')).toEqual([legacyOperation])
  expect(await reopened.readSyncableAccountPending('a')).toEqual([])
  expect(await sync(reopened).flush()).toBe(0)
  await reopened.close()
})
