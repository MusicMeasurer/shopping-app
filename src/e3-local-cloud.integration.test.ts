// Real account + RPC + IndexedDB integration. Disposable lab only.
// Run exclusively in the e3-lab Actions environment; no secrets are logged.
import 'fake-indexeddb/auto'
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { createStorage } from './data/storage'
import { createAccountSync } from './data/account-sync'
import { flushAccountBatch } from './data/account-batch'
import { createItem } from './domain/shopping'

const labEnv = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

describe.skipIf(labEnv.E3_LAB_URL === undefined)('real cloud-to-local receipt integration (disposable lab)', () => {
  it('replays a receipt, merges independent edits and resolves a competing deletion', async () => {
    const url = labEnv.E3_LAB_URL
    const key = labEnv.E3_LAB_PUBLISHABLE_KEY
    const email = labEnv.E3_USER_A_EMAIL
    const password = labEnv.E3_USER_A_PASSWORD
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
      // Simulate losing the local acknowledgement after a successful server RPC.
      let interruptReceipt = true
      const receiptStorage = {
        ...storage,
        commitAccountReceipt: async (...args: Parameters<typeof storage.commitAccountReceipt>) => {
          if (interruptReceipt) {
            interruptReceipt = false
            throw new Error('Simulated receipt persistence interruption')
          }
          return storage.commitAccountReceipt(...args)
        },
      }
      const sync = createAccountSync(receiptStorage, client, {
        accountId, remoteListId: owned.id, localListId: 'groceries',
        isActive: () => true,
      })
      // Cleanup must also run if the RPC succeeds but the local commit fails.
      try {
        await expect(sync.flush()).rejects.toThrow('Simulated receipt persistence interruption')
        remoteCreated = true
        expect(await storage.readAccountPending(accountId)).toHaveLength(1)
        const { data: afterFirst, error: firstReadError } = await client.from('shopping_items')
          .select('id,version').eq('id', item.id)
        if (firstReadError) throw firstReadError
        expect(afterFirst).toHaveLength(1)
        expect(await storage.readAccountItemVersions(accountId)).toEqual([])
        // The same durable operation ID and payload must replay idempotently.
        expect(await sync.flush()).toBe(1)
        const { data: afterRetry, error: retryReadError } = await client.from('shopping_items')
          .select('id,version').eq('id', item.id)
        if (retryReadError) throw retryReadError
        expect(afterRetry).toEqual(afterFirst)
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
      // A second device changes the purchase mark. Merge the independent local name.
      const originalVersion = rows![0].version as number
      const external = await client.rpc('apply_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'update',
        p_item: item.id, p_name: item.name, p_purchased: true,
        p_expected_version: originalVersion,
      })
      if (external.error) throw external.error
      expect(external.data.item_version).toBe(originalVersion + 1)
      const conflictOperationId = crypto.randomUUID()
      await storage.saveAccountEdit(accountId, {
        kind: 'cloud-update', operationId: conflictOperationId,
        localListId: 'groceries', remoteListId: owned.id, itemId: item.id,
        expectedVersion: originalVersion, item: { ...item, name: item.name + '_local' },
      })
      expect(await sync.flush()).toBe(1)
      expect(await storage.readAccountPending(accountId)).toEqual([])
      const [merged] = await storage.readAccountItems(accountId)
      expect(merged).toMatchObject({ name: item.name + '_local', purchased: true })
      const { data: serverAfterConflict, error: conflictReadError } = await client.from('shopping_items')
        .select('name,purchased,version').eq('id', item.id).single()
      if (conflictReadError) throw conflictReadError
      expect(serverAfterConflict).toEqual({
        name: merged.name, purchased: true, version: originalVersion + 2,
      })

      const quantityEdit = await client.rpc('apply_e4_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'update',
        p_item: item.id, p_name: null, p_purchased: null, p_quantity: 3, p_unit: 'л',
        p_expected_version: serverAfterConflict.version,
      })
      if (quantityEdit.error) throw quantityEdit.error
      await storage.saveAccountEdit(accountId, {
        kind: 'cloud-update', operationId: crypto.randomUUID(),
        localListId: 'groceries', remoteListId: owned.id, itemId: item.id,
        expectedVersion: serverAfterConflict.version, item: { ...merged, quantity: 2, unit: 'л' },
      })
      const purchaseEdit = await client.rpc('apply_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'update',
        p_item: item.id, p_name: null, p_purchased: false,
        p_expected_version: quantityEdit.data.item_version,
      })
      if (purchaseEdit.error) throw purchaseEdit.error
      expect(await sync.flush()).toBe(1)
      const [latest] = await storage.readAccountItems(accountId)
      expect(latest).toMatchObject({ quantity: 2, unit: 'л', purchased: false })
      const [latestVersion] = await storage.readAccountItemVersions(accountId)
      await storage.saveAccountEdit(accountId, {
        kind: 'cloud-delete', operationId: crypto.randomUUID(),
        localListId: 'groceries', remoteListId: owned.id, itemId: item.id,
        expectedVersion: latestVersion.version,
      })
      const cloudEdit = await client.rpc('apply_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'update',
        p_item: item.id, p_name: latest.name, p_purchased: true,
        p_expected_version: latestVersion.version,
      })
      if (cloudEdit.error) throw cloudEdit.error
      expect(await sync.flush()).toBe(0)
      const [conflict] = await storage.readItemDeletionConflicts(accountId)
      expect(conflict).toMatchObject({ deleted: 'local', item: { id: item.id, purchased: true } })
      await sync.resolveItemDeletion(conflict, true)
      expect(await storage.readAccountPending(accountId)).toEqual([])
      expect(await storage.readAccountItems(accountId)).toEqual([{ ...latest, purchased: true }])
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
  it('reconciles a server tombstone into a second offline device only after explicit review', async () => {
    const url = labEnv.E3_LAB_URL
    const key = labEnv.E3_LAB_PUBLISHABLE_KEY
    const email = labEnv.E3_USER_A_EMAIL
    const password = labEnv.E3_USER_A_PASSWORD
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
    const storage = createStorage('e3-delete-device-' + crypto.randomUUID())
    const item = createItem('groceries', 'E3_TOMBSTONE_' + crypto.randomUUID())
    let serverVersion: number | null = null
    try {
      await storage.bindAccountList(accountId, 'groceries', owned.id)
      const added = await client.rpc('apply_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'add',
        p_item: item.id, p_name: item.name, p_purchased: false,
        p_expected_version: null,
      })
      if (added.error) throw added.error
      serverVersion = added.data.item_version as number
      await storage.importRemoteOnlyBatch(accountId, owned.id, [{ item, version: serverVersion }])
      const removed = await client.rpc('apply_item_change', {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'delete',
        p_item: item.id, p_name: null, p_purchased: null,
        p_expected_version: serverVersion,
      })
      if (removed.error) throw removed.error
      serverVersion = removed.data.item_version as number
      const sync = createAccountSync(storage, client, {
        accountId, remoteListId: owned.id, localListId: 'groceries', isActive: () => true,
      })
      const review = await sync.previewDeletions()
      expect(review.reviewItems).toEqual([{ id: item.id, name: item.name }])
      expect((await storage.readAccountItems(accountId)).map(row => row.id)).toContain(item.id)
      expect(await sync.applyConfirmedDeletions([item.id])).toBe(1)
      expect((await storage.readAccountItems(accountId)).map(row => row.id)).not.toContain(item.id)
      const versions = await storage.readAccountItemVersions(accountId)
      expect(versions.find(row => row.itemId === item.id)?.version).toBe(serverVersion)
    } finally {
      // A failed assertion can leave an active test row. Convert it to a
      // tombstone only in the explicitly pinned disposable lab.
      const { data: rows, error: cleanupReadError } = await client.from('shopping_items')
        .select('version,deleted_at').eq('id', item.id).eq('list_id', owned.id)
      if (cleanupReadError) throw cleanupReadError
      const active = rows?.find(row => row.deleted_at === null)
      if (active) {
        const { error: cleanupError } = await client.rpc('apply_item_change', {
          p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'delete',
          p_item: item.id, p_name: null, p_purchased: null,
          p_expected_version: active.version,
        })
        if (cleanupError) throw cleanupError
      }
      await storage.close()
    }
  }, 30000)

  it('cancels a claimed deletion through the real account batch and fences a late send', async () => {
    const { E3_LAB_URL:url, E3_LAB_PUBLISHABLE_KEY:key, E3_USER_A_EMAIL:email, E3_USER_A_PASSWORD:password } = labEnv
    if (!url || !key || !email || !password) throw new Error('E3 lab credentials required')
    expect(new URL(url).hostname).toBe('gmrqeubhotjpmtwokfeq.supabase.co')
    expect(key).toMatch(/^sb_publishable_/)
    const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
    const login = await client.auth.signInWithPassword({email,password})
    if (login.error) throw login.error
    const identity = await client.auth.getUser()
    if (identity.error || !identity.data.user) throw new Error('No verified lab identity')
    const accountId = identity.data.user.id
    const lists = await client.from('shopping_lists').select('id,owner_id').eq('owner_id',accountId).is('deleted_at',null)
    if (lists.error) throw lists.error
    const owned = lists.data?.find(row=>row.owner_id===accountId)
    if (!owned) throw new Error('No owned disposable test list')
    const storage = createStorage('e4-delete-cancel-hosted-'+crypto.randomUUID())
    const fixtures: string[] = []
    const flush = () => flushAccountBatch(storage,client,accountId,()=>true,()=>{},'groceries')
    try {
      await storage.bindAccountList(accountId,'groceries',owned.id)
      for (const alreadyApplied of [false,true]) {
        const item = {...createItem('groceries','E4_CANCEL_DELETE_'+crypto.randomUUID()),quantity:2,unit:'л',purchased:true}
        fixtures.push(item.id)
        await storage.saveAccountEdit(accountId,{kind:'cloud-add',operationId:crypto.randomUUID(),
          localListId:'groceries',remoteListId:owned.id,itemId:item.id,item})
        await flush()
        const known = (await storage.readAccountItemVersions(accountId)).find(row=>row.itemId===item.id)
        if (!known) throw new Error('Missing add receipt')
        const operationId = crypto.randomUUID()
        await storage.saveAccountEdit(accountId,{kind:'cloud-delete',operationId,
          localListId:'groceries',remoteListId:owned.id,itemId:item.id,expectedVersion:known.version})
        await storage.claimAccountPending(accountId,operationId)
        const payload = {operation_id:operationId,list_id:owned.id,item_id:item.id,
          kind:'delete',expected_version:known.version}
        if (alreadyApplied) {
          const sent = await client.rpc('push_e4_account_changes',{p_account:accountId,p_operations:[payload]})
          if (sent.error) throw sent.error
          expect(sent.data?.[0]?.receipt?.item_version).toBe(known.version+1)
        }
        expect(await storage.cancelUnsentAccountItemEdit(accountId,operationId,item.id)).toBe('requires-reconciliation')
        expect(await storage.requestAccountItemCancellation(accountId,operationId,item.id)).toBe('queued')
        expect(await storage.readSyncableAccountPending(accountId)).toEqual([])
        await flush()
        expect(await storage.readAccountPending(accountId)).toEqual([])
        const late = await client.rpc('push_e4_account_changes',{p_account:accountId,p_operations:[payload]})
        if (late.error) throw late.error
        if (alreadyApplied) expect(late.data?.[0]?.receipt?.item_version).toBe(known.version+1)
        else expect(late.data?.[0]?.receipt).toBeUndefined()
        const live = await client.from('shopping_items').select('id,name,purchased,quantity,unit,version')
          .eq('id',item.id).eq('list_id',owned.id).is('deleted_at',null)
        if (live.error) throw live.error
        const local = (await storage.readAccountItems(accountId)).find(row=>row.id===item.id)
        if (alreadyApplied) {
          expect(live.data).toEqual([])
          expect(local).toBeUndefined()
          expect(storage.listSyncLedger.cancellationNotice(accountId)).toContain('уже удалён')
        } else {
          expect(live.data).toEqual([{id:item.id,name:item.name,purchased:true,quantity:2,unit:'л',version:known.version}])
          expect(local).toMatchObject(item)
        }
        expect((await storage.readAccountItemVersions(accountId)).find(row=>row.itemId===item.id)?.version)
          .toBe(known.version+(alreadyApplied?1:0))
      }
    } finally {
      try {
        for (const id of fixtures) {
          const rows = await client.from('shopping_items').select('version').eq('id',id).eq('list_id',owned.id).is('deleted_at',null)
          if (rows.error) throw rows.error
          if (rows.data?.length) {
            const cleanup = await client.rpc('apply_item_change',{p_operation:crypto.randomUUID(),p_list:owned.id,
              p_action:'delete',p_item:id,p_name:null,p_purchased:null,p_expected_version:rows.data[0].version})
            if (cleanup.error) throw cleanup.error
          }
        }
      } finally { await storage.close() }
    }
  }, 45000)

})
