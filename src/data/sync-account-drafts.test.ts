import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStorage } from './storage'
import { syncAccountDrafts } from './sync-account-drafts'
import { createItem } from '../domain/shopping'
import { cloudAwareItemStore } from './cloud-aware-item-store'

const accountA = '90000000-0000-4000-8000-000000000001'
const accountB = '90000000-0000-4000-8000-000000000002'
const remoteId = '90000000-0000-4000-8000-000000000003'

async function fixture() {
  const dbName = 'account-drafts-' + crypto.randomUUID()
  const storage = createStorage(dbName)
  await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  await storage.ensureVerifiedAccountProfile(accountA)
  await storage.ensureVerifiedAccountProfile(accountB)
  const list = { id: crypto.randomUUID(), name: 'На дачу', kind: 'oneoff' as const, symbol: '🛒', createdAt: 42 }
  await storage.saveAccountDraftList(accountA, list)
  return { storage, dbName, list }
}

const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as Pick<SupabaseClient, 'rpc'>)
const receipt = (args: { p_operation: string; p_name: string }) => ({ error: null, data: {
  operation_id: args.p_operation, list_id: remoteId, owner_id: accountA,
  name: args.p_name, kind: 'oneoff', position: 0, revision: 0,
} })

it('keeps a draft and its queued completion across restart and promotes exactly once after a lost response', async () => {
  const { storage, dbName, list } = await fixture()
  const item = { ...createItem(list.id, 'Хлеб'), purchased: true }
  await cloudAwareItemStore(storage, accountA).saveMany([item])
  const request = { accountId: accountA, localListId: list.id, remoteListId: list.id, name: list.name,
    operationId: crypto.randomUUID(), createdAt: 10, mode: 'archive_purchased' as const, confirmedItemIds: [item.id] }
  await storage.queueAccountCompletion(request, true)
  await expect(cloudAwareItemStore(storage, accountA).save({ ...item, purchased: false })).rejects.toThrow()
  expect(await storage.hasAccountSyncWork(accountA)).toBe(true)
  expect(await storage.hasAccountSyncWork(accountB)).toBe(false)
  await storage.close()
  const restarted = createStorage(dbName)
  const rpc = vi.fn().mockRejectedValueOnce(new Error('Network error')).mockImplementation(async (_name, args) => receipt(args))
  expect((await syncAccountDrafts(restarted, client(rpc), accountB, () => true)).promoted).toEqual([])
  expect(rpc).not.toHaveBeenCalled()
  expect((await syncAccountDrafts(restarted, client(rpc), accountA, () => true)).failed).toBe(true)
  expect(await restarted.readAccountItems(accountA)).toEqual([item])
  expect(await restarted.readAccountArchive(accountA)).toBeNull()
  expect((await syncAccountDrafts(restarted, client(rpc), accountA, () => true)).promoted).toHaveLength(1)
  expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
  expect(await restarted.readAccountDraftLists(accountA)).toEqual([])
  expect(await restarted.readAccountPending(accountA)).toMatchObject([{ itemId: item.id, remoteListId: remoteId }])
  expect(await restarted.readAccountCompletionRequests(accountA)).toEqual([{ ...request, remoteListId: remoteId, fromLocalCopy: true }])
  expect((await syncAccountDrafts(restarted, client(rpc), accountA, () => true)).promoted).toEqual([])
  await restarted.close()
})

it('keeps items on a name conflict, allows a fresh name and hands off to an already bound remote list', async () => {
  const { storage, list } = await fixture()
  const item = createItem(list.id, 'Яйца')
  await cloudAwareItemStore(storage, accountA).saveMany([item])
  const rpc = vi.fn().mockResolvedValueOnce({ error: { code: '23505' } }).mockImplementation(async (_name, args) => receipt(args))
  expect((await syncAccountDrafts(storage, client(rpc), accountA, () => true)).nameConflict).toBe(true)
  expect(await storage.readAccountDraftLists(accountA)).toMatchObject([{ nameConflict: true }])
  await storage.saveAccountDraftList(accountA, { ...(await storage.readAccountDraftLists(accountA))[0], name: 'На дачу в субботу' })
  await storage.bindAccountList(accountA, remoteId, remoteId)
  await syncAccountDrafts(storage, client(rpc), accountA, () => true)
  expect(rpc.mock.calls[0][1].p_operation).not.toBe(rpc.mock.calls[1][1].p_operation)
  expect(await storage.readAccountListMappings(accountA)).toMatchObject([{ localListId: remoteId, remoteListId: remoteId }])
  expect(await storage.readAccountItems(accountA)).toEqual([{ ...item, listId: remoteId }])
  await storage.close()
})

it('cancels an unsent completion and unlocks the saved list without creating archive data', async () => {
  const { storage, list } = await fixture()
  const item = createItem(list.id, 'Чай')
  await cloudAwareItemStore(storage, accountA).saveMany([item])
  const request = { accountId: accountA, localListId: list.id, remoteListId: list.id, name: list.name,
    operationId: crypto.randomUUID(), createdAt: 10, mode: 'all_purchased' as const }
  await storage.queueAccountCompletion(request, true)
  expect(await storage.cancelUnsentAccountCompletion(request)).toBe(true)
  await cloudAwareItemStore(storage, accountA).remove(item.id)
  expect(await storage.readAccountItems(accountA)).toEqual([])
  expect(await storage.readAccountArchive(accountA)).toBeNull()
  await storage.close()
})
