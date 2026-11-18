import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { duplicatedItems } from '../domain/item-names'
import { createItemBatch, parseItems, sortShoppingItems } from '../domain/shopping'
import { createAccountSync } from './account-sync'
import { cloudAwareItemStore } from './cloud-aware-item-store'
import { createStorage } from './storage'

it('converges two devices after offline additions, deferral and explicit rename', async () => {
  const listId = 'groceries'
  const remoteListId = crypto.randomUUID()
  const leftStorage = createStorage(crypto.randomUUID())
  const rightStorage = createStorage(crypto.randomUUID())
  let revision = 0
  type Row = { id: string; list_id: string; name: string; purchased: boolean;
    created_at: string; quantity: number | null; unit: string | null; version: number }
  const rows = new Map<string, Row>()
  const receipts = new Map<string, { operation_id: string; item_version: number; list_revision: number }>()
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({
      order: async () => ({ data: [...rows.values()] }),
    }) }) }) }),
    rpc: async (functionName: string, args: Record<string, string | number | boolean | null>) => {
      const operationId = String(args.p_operation)
      const receipt = receipts.get(operationId)
      if (receipt) return { data: receipt }
      let version: number
      if (functionName === 'add_e4_ordered_item') {
        const id = String(args.p_item)
        expect(rows.has(id)).toBe(false)
        version = 1
        rows.set(id, {
          id, list_id: remoteListId, name: String(args.p_name), purchased: Boolean(args.p_purchased),
          created_at: String(args.p_created_at), quantity: args.p_quantity as number | null,
          unit: args.p_unit as string | null, version,
        })
      } else {
        expect(functionName).toBe('resolve_e4_item_name_conflict')
        const keep = rows.get(String(args.p_keep))!
        const change = rows.get(String(args.p_change))!
        expect(keep.version).toBe(args.p_keep_version)
        expect(change.version).toBe(args.p_change_version)
        version = change.version + 1
        rows.set(change.id, { ...change, version, name: String(args.p_name) })
      }
      const data = { operation_id: operationId, list_revision: ++revision, item_version: version }
      receipts.set(operationId, data)
      return { data }
    },
  } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>

  async function connect(storage: typeof leftStorage) {
    await storage.bindAccountList('account', listId, remoteListId)
    return {
      store: cloudAwareItemStore(storage, 'account'),
      sync: createAccountSync(storage, client, {
        accountId: 'account', localListId: listId, remoteListId, isActive: () => true,
      }),
    }
  }
  try {
    const [left, right] = await Promise.all([connect(leftStorage), connect(rightStorage)])
    const [keep, bread] = createItemBatch(listId, parseItems('Молоко 2 л\nХлеб'), [], 200)
    const [change, salt] = createItemBatch(listId, parseItems('МОЛОКО 3 уп.\nСоль'), [], 100)
    await left.store.saveMany([keep, bread])
    await right.store.saveMany([{ ...change, purchased: true }, salt])

    await left.sync.flush()
    await right.sync.flush()
    await left.sync.importRemoteOnly({ reconcileNames: true })
    await right.sync.importRemoteOnly({ reconcileNames: true })
    for (const device of [left, right]) {
      const items = await device.store.read()
      expect(sortShoppingItems(items, 'recent').map(item => item.name))
        .toEqual(['Молоко', 'Хлеб', 'МОЛОКО', 'Соль'])
      expect(duplicatedItems(items)[0]).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: keep.id, quantity: 2, unit: 'л', purchased: false }),
        expect.objectContaining({ id: change.id, quantity: 3, unit: 'уп.', purchased: true }),
      ]))
    }

    const [tea] = createItemBatch(listId, parseItems('Чай'), await right.store.read(), 300)
    await right.store.saveMany([tea])
    await right.sync.flush()
    await left.sync.importRemoteOnly({ reconcileNames: true })
    expect((await left.store.read()).map(item => item.name)).toContain('Чай')

    const displayed = (await left.store.read()).find(item => item.id === change.id)!
    await left.sync.resolveItemName({ operationId: crypto.randomUUID(), keep, change: displayed, name: 'Сливки' })
    await right.sync.importRemoteOnly({ reconcileNames: true })
    for (const device of [left, right]) {
      const items = await device.store.read()
      expect(duplicatedItems(items)).toEqual([])
      expect(items).toContainEqual(expect.objectContaining({ id: change.id, name: 'Сливки', quantity: 3, purchased: true }))
      expect(items).toHaveLength(5)
    }
  } finally {
    await Promise.all([leftStorage.close(), rightStorage.close()])
  }
})
