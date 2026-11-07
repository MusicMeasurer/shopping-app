import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStorage } from './storage'
import { createAccountSync } from './account-sync'
import { createItem } from '../domain/shopping'

describe('Siri cloud item to durable shopping list', () => {
  it('imports a Siri-created remote item once, preserves local edits, and survives restart', async () => {
    const dbName = 'siri-import-' + crypto.randomUUID()
    const accountId = 'account-siri'
    const remoteListId = crypto.randomUUID()
    const remoteId = crypto.randomUUID()
    const remote = {
      id: remoteId, list_id: remoteListId, name: 'Молоко через Siri',
      purchased: false, created_at: new Date().toISOString(), version: 1,
    }
    const order = vi.fn(async () => ({ data: [remote], error: null }))
    const from = vi.fn(() => ({
      select: () => ({ eq: () => ({ is: () => ({ order }) }) }),
    }))
    const client = { from } as unknown as SupabaseClient
    const storage = createStorage(dbName)
    await storage.bindAccountList(accountId, 'groceries', remoteListId)
    const local = createItem('groceries', 'Хлеб вручную')
    await storage.saveAccountItem(accountId, local)
    const sync = createAccountSync(storage, client, {
      accountId, remoteListId, localListId: 'groceries', isActive: () => true,
    })
    expect(await sync.importRemoteOnly()).toBe(1)
    expect(await sync.importRemoteOnly()).toBe(0)
    expect(await storage.readAccountItems(accountId)).toEqual(expect.arrayContaining([
      local,
      expect.objectContaining({ id: remoteId, name: 'Молоко через Siri', listId: 'groceries' }),
    ]))
    expect(await storage.read()).toEqual([])
    await storage.close()
    const reopened = createStorage(dbName)
    const items = await reopened.readAccountItems(accountId)
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === local.id)).toEqual(local)
    expect(items.find(item => item.id === remoteId)?.name).toBe('Молоко через Siri')
    expect((await reopened.readAccountItemVersions(accountId)).find(row => row.itemId === remoteId)?.version).toBe(1)
    await reopened.close()
  })
  it('rejects a conflicting remote edit without changing a local purchase', async () => {
    const storage = createStorage('siri-conflict-' + crypto.randomUUID())
    const accountId = 'account-siri'
    const remoteListId = crypto.randomUUID()
    const local = createItem('groceries', 'Кофе')
    await storage.bindAccountList(accountId, 'groceries', remoteListId)
    await storage.saveAccountItem(accountId, local)
    const remote = {
      id: local.id, list_id: remoteListId, name: 'Кофе изменён в облаке',
      purchased: false, created_at: new Date(local.createdAt).toISOString(), version: 2,
    }
    const order = vi.fn(async () => ({ data: [remote], error: null }))
    const client = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order }) }) }) }) } as unknown as SupabaseClient
    const sync = createAccountSync(storage, client, {
      accountId, remoteListId, localListId: 'groceries', isActive: () => true,
    })
    await expect(sync.importRemoteOnly()).rejects.toThrow('conflicting items')
    expect(await storage.readAccountItems(accountId)).toEqual([local])
    await storage.close()
  })

  it('rejects a changing cloud snapshot before importing any Siri item', async () => {
    const storage = createStorage('siri-race-' + crypto.randomUUID())
    const accountId = 'account-siri'
    const remoteListId = crypto.randomUUID()
    await storage.bindAccountList(accountId, 'groceries', remoteListId)
    const remote = {
      id: crypto.randomUUID(), list_id: remoteListId, name: 'Масло через Siri',
      purchased: false, created_at: new Date().toISOString(), version: 1,
    }
    const order = vi.fn()
      .mockResolvedValueOnce({ data: [remote], error: null })
      .mockResolvedValueOnce({ data: [{ ...remote, name: 'Масло обновлено', version: 2 }], error: null })
    const client = { from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order }) }) }) }) } as unknown as SupabaseClient
    const sync = createAccountSync(storage, client, {
      accountId, remoteListId, localListId: 'groceries', isActive: () => true,
    })
    await expect(sync.importRemoteOnly()).rejects.toThrow('Remote list changed')
    expect(await storage.readAccountItems(accountId)).toEqual([])
    await storage.close()
  })

})
