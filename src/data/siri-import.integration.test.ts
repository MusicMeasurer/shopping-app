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
})
