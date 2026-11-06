import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createStorage } from './storage'
import { cloudAwareItemStore } from './cloud-aware-item-store'
import { createItem } from '../domain/shopping'

const listId = '123e4567-e89b-42d3-a456-426614174000'
const setup = async () => {
  const storage = createStorage('cloud-aware-' + crypto.randomUUID())
  await storage.bindAccountList('account-a', 'groceries', listId)
  return storage
}

describe('cloud-aware account item store', () => {
  it('atomically queues a new item for its bound list, without touching guest or another account', async () => {
    const storage = await setup()
    const item = createItem('groceries', 'Молоко')
    await cloudAwareItemStore(storage, 'account-a').save(item)
    expect(await storage.readAccountItems('account-a')).toEqual([item])
    expect(await storage.read()).toEqual([])
    expect(await storage.readAccountItems('account-b')).toEqual([])
    expect(await storage.readAccountPending('account-a')).toEqual([expect.objectContaining({
      kind: 'cloud-add', itemId: item.id, remoteListId: listId, item,
    })])
    await storage.close()
  })

  it('keeps unbound account lists local only', async () => {
    const storage = await setup()
    const item = createItem('household', 'Мыло')
    await cloudAwareItemStore(storage, 'account-a').save(item)
    expect(await storage.readAccountItems('account-a')).toEqual([item])
    expect(await storage.readAccountPending('account-a')).toEqual([])
    await storage.close()
  })

  it('does not replace an unconfirmed item change with a second edit', async () => {
    const storage = await setup()
    const store = cloudAwareItemStore(storage, 'account-a')
    const item = createItem('groceries', 'Хлеб')
    await store.save(item)
    await expect(store.save({ ...item, purchased: true })).rejects.toThrow('no confirmed cloud version')
    expect(await store.read()).toEqual([item])
    expect(await storage.readAccountPending('account-a')).toHaveLength(1)
    await storage.close()
  })

  it('queues a versioned update after a confirmed server receipt', async () => {
    const storage = await setup()
    const store = cloudAwareItemStore(storage, 'account-a')
    const item = createItem('groceries', 'Сыр')
    await store.save(item)
    const [queued] = await storage.readAccountPending('account-a')
    await storage.commitAccountReceipt('account-a', queued.operationId, listId, item.id, 1)
    const updated = { ...item, purchased: true }
    await store.save(updated)
    expect(await storage.readAccountPending('account-a')).toEqual([expect.objectContaining({
      kind: 'cloud-update', expectedVersion: 1, item: updated,
    })])
    await storage.close()
  })

  it('rejects deleting a not-yet-confirmed cloud item without losing its queue', async () => {
    const storage = await setup()
    const store = cloudAwareItemStore(storage, 'account-a')
    const item = createItem('groceries', 'Яйца')
    await store.save(item)
    await expect(store.remove(item.id)).rejects.toThrow('Unconfirmed cloud item')
    expect(await store.read()).toEqual([item])
    expect(await storage.readAccountPending('account-a')).toHaveLength(1)
    await storage.close()
  })
})
