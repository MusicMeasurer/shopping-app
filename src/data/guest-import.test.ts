import { expect, it, vi, beforeEach } from 'vitest'
import { syncGuestImports } from './guest-import'
import { fetchCloudListMetadata } from './e4-cloud-list-metadata'
import { fetchRemoteItems } from './remote-snapshot'
import { fetchCloudArchive } from './cloud-archive'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
vi.mock('./e4-cloud-list-metadata', () => ({ fetchCloudListMetadata: vi.fn() }))
vi.mock('./remote-snapshot', () => ({ fetchRemoteItems: vi.fn() }))
vi.mock('./cloud-archive', () => ({ fetchCloudArchive: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

function setup() {
  const batch = { key: 'source', accountId: 'a', operationId: 'op', imported: false,
    collisionMode: 'merge' as const, removeSource: true,
    lists: [{ id: 'local', name: 'Food', kind: 'permanent' as const }],
    items: [{ id: 'local-item', listId: 'local', name: 'Milk', purchased: false, createdAt: 1 }],
    archives: [{ id: 'archive', sourceListId: 'local', name: 'Food', kind: 'permanent' as const, completedAt: 1,
      items: [{ id: 'old', listId: 'local', name: 'Bread', purchased: true, createdAt: 1, quantity: 2, unit: 'шт.' }] }],
  }
  const storage = { readGuestImports: vi.fn().mockResolvedValue([batch]), cacheAccountArchive: vi.fn(), confirmGuestImport: vi.fn() }
  const rpc = vi.fn().mockResolvedValue({ data: { lists: { local: 'remote' }, items: ['remote-item'], archives: ['remote-archive'] }, error: null })
  vi.mocked(fetchCloudListMetadata).mockResolvedValue([{ id: 'remote', ownerId: 'a', name: 'Food', kind: 'permanent', position: 0, revision: 1 }])
  vi.mocked(fetchRemoteItems).mockResolvedValue([{ id: 'remote-item', listId: 'remote', name: 'Milk', purchased: false, createdAt: new Date(1).toISOString(), version: 1 }])
  vi.mocked(fetchCloudArchive).mockResolvedValue([{ id: 'remote-archive', sourceListId: 'remote', sourceListName: 'Food', completedAt: new Date(1).toISOString(), items: [{ ordinal: 0, name: 'Bread', quantity: 2, unit: 'шт.' }] }])
  const run = (active = async () => true) => syncGuestImports(storage as unknown as Storage, { rpc } as unknown as SupabaseClient, 'a', active)
  return { storage, rpc, run }
}
it('confirms complete owned snapshot and persists archive before source cleanup', async () => {
  const { storage, rpc, run } = setup()
  await run()
  expect(rpc).toHaveBeenCalledWith('import_e4_profile_merge', expect.objectContaining({ p_snapshot: expect.objectContaining({ collisionMode: 'merge' }) }))
  expect(storage.cacheAccountArchive).toHaveBeenCalledOnce()
  expect(storage.confirmGuestImport).toHaveBeenCalledOnce()
  expect(storage.cacheAccountArchive.mock.invocationCallOrder[0]).toBeLessThan(storage.confirmGuestImport.mock.invocationCallOrder[0])
})
it('keeps source on partial archive read or missing imported item', async () => {
  const { storage, run } = setup()
  vi.mocked(fetchCloudArchive).mockResolvedValue([{ id: 'remote-archive', sourceListId: 'remote', sourceListName: 'Food', completedAt: new Date(1).toISOString(), items: [] }])
  await expect(run()).rejects.toThrow('not fully confirmed')
  expect(storage.confirmGuestImport).not.toHaveBeenCalled()
  vi.mocked(fetchRemoteItems).mockResolvedValue([])
  await expect(run()).rejects.toThrow('not fully confirmed')
  expect(storage.confirmGuestImport).not.toHaveBeenCalled()
})
it('never confirms or purges after identity changes or RPC fails', async () => {
  const { storage, rpc, run } = setup()
  await run(vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false))
  expect(storage.confirmGuestImport).not.toHaveBeenCalled()
  rpc.mockResolvedValue({ error: { message: 'offline' }, data: null })
  await expect(run()).rejects.toEqual({ message: 'offline' })
  expect(storage.confirmGuestImport).not.toHaveBeenCalled()
})
