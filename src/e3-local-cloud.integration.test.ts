// Real account + RPC + IndexedDB integration. Disposable lab only.
// Run exclusively in the e3-lab Actions environment; no secrets are logged.
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createStorage } from './data/storage'
import { createAccountSync } from './data/account-sync'
import { createItem } from './domain/shopping'

describe.skipIf(process.env.E3_LAB_URL === undefined)('real cloud-to-local receipt integration (disposable lab)', () => {
  it('sends a queued add, persists its server version, and acknowledges atomically', async () => {
    const url = process.env.E3_LAB_URL
    const key = process.env.E3_LAB_PUBLISHABLE_KEY
    const email = process.env.E3_USER_A_EMAIL
    const password = process.env.E3_USER_A_PASSWORD
    if (!url || !key || !email || !password) throw new Error('E3 lab credentials required')
    expect(new URL(url).hostname).toBe('gmrqeubhotjpmtwokfeq.supabase.co')
    expect(key).toMatch(/^sb_publishable_/)
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { error: loginError } = await client.auth.signInWithPassword({ email, password })
    if (loginError) throw loginError
    const { data: identity, error: identityError } = await client.auth.getUser()
    if (identityError || !identity.user) throw new Error('No verified lab identity')
    const accountId = identity.user.id
    const { data: lists, error: listError } = await client.from('shopping_lists').select('id,owner_id')
    if (listError) throw listError
    const owned = lists?.find(row => row.owner_id === accountId)
    if (!owned) throw new Error('No owned disposable test list')
    const storage = createStorage('e3-integration-' + crypto.randomUUID())
    const item = createItem('groceries', 'E3_LOCAL_SYNC_' + crypto.randomUUID())
    const operationId = crypto.randomUUID()
    let remoteCreated = false
    try {
      await storage.bindAccountList(accountId, 'groceries', owned.id)
      await storage.saveAccountEdit(accountId, {
        kind: 'cloud-add', operationId, localListId: 'groceries',
        remoteListId: owned.id, itemId: item.id, item,
      })
      const sync = createAccountSync(storage, client, {
        accountId, remoteListId: owned.id, localListId: 'groceries',
        isActive: () => true,
      })
      // Cleanup must also run if the RPC succeeds but the local commit fails.
      try {
        expect(await sync.flush()).toBe(1)
        remoteCreated = true
      } catch (error) {
        const { data } = await client.from('shopping_items').select('id').eq('id', item.id)
        remoteCreated = !!data?.length
        throw error
      }
      expect(await storage.readAccountPending(accountId)).toEqual([])
      const versions = await storage.readAccountItemVersions(accountId)
      expect(versions).toHaveLength(1)
      expect(versions[0].itemId).toBe(item.id)
      expect(versions[0].remoteListId).toBe(owned.id)
      const { data: rows, error: readError } = await client.from('shopping_items')
        .select('id,version').eq('id', item.id)
      if (readError) throw readError
      expect(rows).toHaveLength(1)
      expect(versions[0].version).toBe(rows![0].version)
      expect(await sync.flush()).toBe(0)
    } finally {
      if (remoteCreated) {
        const { data: rows, error } = await client.from('shopping_items')
          .select('version').eq('id', item.id)
        if (error) throw error
        if (rows?.length) {
          const { error: deleteError } = await client.rpc('apply_item_change', {
            p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'delete',
            p_item: item.id, p_name: null, p_purchased: null,
            p_expected_version: rows[0].version,
          })
          if (deleteError) throw deleteError
        }
      }
      await storage.close()
    }
  }, 30000)
})
