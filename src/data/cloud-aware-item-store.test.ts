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

  it('notifies only after the cloud edit is durably queued', async () => {
    const storage = await setup()
    let notifications = 0
    const store = cloudAwareItemStore(storage, 'account-a', () => { notifications += 1 })
    const item = createItem('groceries', 'Кофе')
    await store.save(item)
    expect(notifications).toBe(1)
    expect(await storage.readAccountPending('account-a')).toHaveLength(1)
    await expect(store.save({ ...item, purchased: true })).rejects.toThrow()
    expect(notifications).toBe(1)
    await storage.close()
  })

  it('imports a remote-only item with its confirmed version and rejects overwrites', async () => {
    const storage = await setup()
    const item = createItem('groceries', 'Рис')
    await storage.importRemoteOnlyItem('account-a', listId, item, 3)
    expect(await storage.readAccountItems('account-a')).toEqual([item])
    expect(await storage.readAccountItemVersions('account-a')).toEqual([
      expect.objectContaining({ itemId: item.id, version: 3, remoteListId: listId }),
    ])
    await expect(storage.importRemoteOnlyItem('account-a', listId, { ...item, name: 'Другой рис' }, 4))
      .rejects.toThrow('conflicts with local state')
    expect((await storage.readAccountItems('account-a'))[0].name).toBe('Рис')
    await storage.close()
  })

  it('rejects remote import while the same item has an unsent local operation', async () => {
    const storage = await setup()
    const item = createItem('groceries', 'Чай')
    await cloudAwareItemStore(storage, 'account-a').save(item)
    await expect(storage.importRemoteOnlyItem('account-a', listId, item, 1))
      .rejects.toThrow('conflicts with local state')
    expect(await storage.readAccountItemVersions('account-a')).toEqual([])
    expect(await storage.readAccountPending('account-a')).toHaveLength(1)
    await storage.close()
  })

  it('rolls back the whole remote batch when a later item conflicts', async () => {
    const storage = await setup()
    const first = createItem('groceries', 'Гречка')
    const second = createItem('groceries', 'Соль')
    await storage.saveAccountItem('account-a', second)
    await expect(storage.importRemoteOnlyBatch('account-a', listId, [
      { item: first, version: 1 }, { item: second, version: 2 },
    ])).rejects.toThrow('conflicts with local state')
    expect(await storage.readAccountItems('account-a')).toEqual([second])
    expect(await storage.readAccountItemVersions('account-a')).toEqual([])
    await storage.close()
  })

  it('imports a whole nonconflicting batch with confirmed versions', async () => {
    const storage = await setup()
    const first = createItem('groceries', 'Мука')
    const second = createItem('groceries', 'Сахар')
    await storage.importRemoteOnlyBatch('account-a', listId, [
      { item: first, version: 3 }, { item: second, version: 4 },
    ])
    expect(await storage.readAccountItems('account-a')).toHaveLength(2)
    expect((await storage.readAccountItemVersions('account-a')).map(row => row.version).sort()).toEqual([3, 4])
    await storage.close()
  })

  it('rejects quantity and unit edits on cloud-bound lists before local writes or queueing', async () => {
    const storage = await setup()
    const store = cloudAwareItemStore(storage, 'account-a')
    const item = createItem('groceries', 'Рис')
    await expect(store.save({ ...item, quantity: 2, unit: 'кг' }))
      .rejects.toThrow('versioned E4 server contract')
    await expect(store.save({ ...item, unit: 'кг' }))
      .rejects.toThrow('versioned E4 server contract')
    expect(await storage.readAccountItems('account-a')).toEqual([])
    expect(await storage.readAccountPending('account-a')).toEqual([])
    await storage.close()
  })

  it('preserves quantity and unit for unbound local-only account items', async () => {
    const storage = await setup()
    const item = { ...createItem('household', 'Соль'), quantity: 2, unit: 'кг' }
    await cloudAwareItemStore(storage, 'account-a').save(item)
    expect(await storage.readAccountItems('account-a')).toEqual([item])
    expect(await storage.readAccountPending('account-a')).toEqual([])
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
