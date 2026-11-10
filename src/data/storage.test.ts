import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { openDB } from 'idb'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

it('persists both lists, purchases and deletion across database connections', async () => {
  const name = `test-${crypto.randomUUID()}`
  const first = createStorage(name)
  const food = createItem('groceries', 'Молоко')
  const household = createItem('household', 'Мыло')
  await first.save(food); await first.save(household); await first.close()
  const second = createStorage(name)
  expect(await second.read()).toHaveLength(2)
  await second.save({ ...food, purchased: true }); await second.remove(household.id); await second.close()
  const third = createStorage(name)
  expect(await third.read()).toEqual([{ ...food, purchased: true }])
  await third.close()
})

it('upgrades a v1 database without losing local items', async () => {
  const name = `migration-${crypto.randomUUID()}`
  const item = createItem('groceries', 'Хлеб')
  const legacy = await openDB(name, 1, {
    upgrade(db) { db.createObjectStore('items', { keyPath: 'id' }) },
  })
  await legacy.put('items', item)
  legacy.close()
  const upgraded = createStorage(name)
  expect(await upgraded.read()).toEqual([item])
  expect(await upgraded.readPending()).toEqual([])
  await upgraded.close()
})

it('persists queued operations across restart and acknowledges one at a time', async () => {
  const name = `queue-${crypto.randomUUID()}`
  const first = createStorage(name)
  const item = createItem('groceries', 'Молоко')
  const add = { operationId: 'op-1', kind: 'upsert' as const, item }
  const remove = { operationId: 'op-2', kind: 'delete' as const, itemId: item.id }
  await first.enqueuePending(add)
  await first.enqueuePending(remove)
  await first.enqueuePending(add)
  await expect(first.enqueuePending({ ...add, item: { ...item, purchased: true } })).rejects.toThrow()
  await first.close()

  const second = createStorage(name)
  expect(await second.readPending()).toEqual([add, remove])
  await second.acknowledgePending('op-1')
  expect(await second.readPending()).toEqual([remove])
  await second.close()
})

it('applies a reviewed server deletion only with unchanged item and confirmed version', async () => {
  const storage = createStorage('delete-review-' + crypto.randomUUID())
  const account = 'account-a'
  const remoteListId = crypto.randomUUID()
  const item = createItem('groceries', 'Молоко')
  await storage.bindAccountList(account, 'groceries', remoteListId)
  await storage.saveAccountItem(account, item)
  await storage.recordAccountItemVersion(account, remoteListId, item.id, 2)
  await storage.applyReviewedRemoteDeletions(account, remoteListId, [
    { item, expectedLocalVersion: 2, serverDeletedVersion: 3 },
  ])
  expect(await storage.readAccountItems(account)).toEqual([])
  expect((await storage.readAccountItemVersions(account))[0].version).toBe(3)
  await storage.close()
})

it('rolls back all reviewed deletions if a later item changed locally', async () => {
  const storage = createStorage('delete-rollback-' + crypto.randomUUID())
  const account = 'account-a'
  const remoteListId = crypto.randomUUID()
  const first = createItem('groceries', 'Соль')
  const second = createItem('groceries', 'Перец')
  await storage.bindAccountList(account, 'groceries', remoteListId)
  for (const item of [first, second]) {
    await storage.saveAccountItem(account, item)
    await storage.recordAccountItemVersion(account, remoteListId, item.id, 2)
  }
  await storage.saveAccountItem(account, { ...second, purchased: true })
  await expect(storage.applyReviewedRemoteDeletions(account, remoteListId, [
    { item: first, expectedLocalVersion: 2, serverDeletedVersion: 3 },
    { item: second, expectedLocalVersion: 2, serverDeletedVersion: 3 },
  ])).rejects.toThrow('conflicts with local state')
  expect(await storage.readAccountItems(account)).toHaveLength(2)
  await storage.close()
})

it('rejects reviewed deletion when the item has a pending edit', async () => {
  const storage = createStorage('delete-pending-' + crypto.randomUUID())
  const account = 'account-a'
  const remoteListId = crypto.randomUUID()
  const item = createItem('groceries', 'Сахар')
  await storage.bindAccountList(account, 'groceries', remoteListId)
  await storage.saveAccountItem(account, item)
  await storage.recordAccountItemVersion(account, remoteListId, item.id, 1)
  await storage.enqueueAccountPending(account, { operationId: crypto.randomUUID(), kind: 'upsert', item })
  await expect(storage.applyReviewedRemoteDeletions(account, remoteListId, [
    { item, expectedLocalVersion: 1, serverDeletedVersion: 2 },
  ])).rejects.toThrow('conflicts with local state')
  expect(await storage.readAccountItems(account)).toEqual([item])
  await storage.close()
})

it('refuses a repeated deletion after its local item was already removed', async () => {
  const storage = createStorage('delete-repeat-' + crypto.randomUUID())
  const account = 'account-a'
  const remoteListId = crypto.randomUUID()
  const item = createItem('groceries', 'Яйца')
  await storage.bindAccountList(account, 'groceries', remoteListId)
  await storage.saveAccountItem(account, item)
  await storage.recordAccountItemVersion(account, remoteListId, item.id, 2)
  const reviewed = [{ item, expectedLocalVersion: 2, serverDeletedVersion: 3 }]
  await storage.applyReviewedRemoteDeletions(account, remoteListId, reviewed)
  await expect(storage.applyReviewedRemoteDeletions(account, remoteListId, reviewed))
    .rejects.toThrow('conflicts with local state')
  expect(await storage.readAccountItems(account)).toEqual([])
  expect((await storage.readAccountItemVersions(account)).find(row => row.itemId === item.id)?.version).toBe(3)
  await storage.close()
})

it('rejects a stale reviewed deletion when a newer server version was recorded', async () => {
  const storage = createStorage('delete-stale-' + crypto.randomUUID())
  const account = 'account-a'
  const remoteListId = crypto.randomUUID()
  const item = createItem('groceries', 'Сыр')
  await storage.bindAccountList(account, 'groceries', remoteListId)
  await storage.saveAccountItem(account, item)
  await storage.recordAccountItemVersion(account, remoteListId, item.id, 4)
  await expect(storage.applyReviewedRemoteDeletions(account, remoteListId, [
    { item, expectedLocalVersion: 2, serverDeletedVersion: 3 },
  ])).rejects.toThrow('conflicts with local state')
  expect(await storage.readAccountItems(account)).toEqual([item])
  expect((await storage.readAccountItemVersions(account)).find(row => row.itemId === item.id)?.version).toBe(4)
  await storage.close()
})

it('initializes a stable unregistered local profile without touching legacy data', async () => {
  const name = 'profile-v8-' + crypto.randomUUID()
  const item = createItem('groceries', 'Хлеб')
  const legacy = await openDB(name, 7, {
    upgrade(db) {
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
      db.createObjectStore('lists', { keyPath: 'id' })
      db.createObjectStore('archives', { keyPath: 'id' })
    },
  })
  await legacy.put('items', item)
  await legacy.put('pendingOperations', { operationId: 'pending-guest', kind: 'upsert', item })
  legacy.close()
  const first = createStorage(name)
  const profile = await first.ensureLocalProfiles()
  expect(profile.profiles).toHaveLength(1)
  expect(profile.profiles[0].cloudAccountId).toBeNull()
  expect(profile.profiles[0].id).toBeTruthy()
  expect(await first.read()).toEqual([item])
  expect(await first.readPending()).toHaveLength(1)
  await first.close()
  const second = createStorage(name)
  expect(await second.ensureLocalProfiles()).toEqual(profile)
  expect(await second.readLocalProfiles()).toEqual(profile)
  expect(await second.read()).toEqual([item])
  await second.close()
})

it('initializes the local identity only once during concurrent first use', async () => {
  const storage = createStorage('profile-race-' + crypto.randomUUID())
  const profiles = await Promise.all([storage.ensureLocalProfiles(), storage.ensureLocalProfiles()])
  expect(profiles[0]).toEqual(profiles[1])
  expect(await storage.readLocalProfiles()).toEqual(profiles[0])
  await storage.close()
})

it('copies legacy guest lists, items, archive and queue once without deleting originals', async () => {
  const storage = createStorage('profile-copy-' + crypto.randomUUID())
  const item = createItem('groceries', 'Молоко')
  await storage.save(item)
  await storage.enqueuePending({ operationId: 'op-guest', kind: 'upsert', item })
  const beforeLists = await storage.readLists()
  const owner = await storage.migrateLegacyGuestToProfile()
  expect(await storage.readProfileItems(owner)).toEqual([item])
  expect(await storage.readProfilePending(owner)).toHaveLength(1)
  expect(await storage.readProfileLists(owner)).toEqual(beforeLists)
  expect(await storage.readProfileArchives(owner)).toEqual([])
  expect(await storage.migrateLegacyGuestToProfile()).toBe(owner)
  expect(await storage.readProfileItems('friend-profile')).toEqual([])
  expect(await storage.readProfilePending('friend-profile')).toEqual([])
  expect(await storage.read()).toEqual([item])
  expect(await storage.readPending()).toHaveLength(1)
  await storage.close()
})

it('keeps migrated profile records across restart and never copies late legacy edits silently', async () => {
  const name = 'profile-restart-' + crypto.randomUUID()
  const first = createStorage(name)
  const original = createItem('groceries', 'Хлеб')
  await first.save(original)
  const owner = await first.migrateLegacyGuestToProfile()
  await first.close()
  const second = createStorage(name)
  expect(await second.migrateLegacyGuestToProfile()).toBe(owner)
  expect(await second.readProfileItems(owner)).toEqual([original])
  await second.save(createItem('groceries', 'Новая запись'))
  expect(await second.migrateLegacyGuestToProfile()).toBe(owner)
  expect(await second.readProfileItems(owner)).toEqual([original])
  await second.close()
})

it('keeps two profile item namespaces separate and preserves the original after friend edits', async () => {
  const storage = createStorage('profile-isolation-' + crypto.randomUUID())
  const own = createItem('groceries', 'Мои покупки')
  const friend = createItem('groceries', 'Покупки друга')
  await storage.save(own)
  const ownerId = await storage.migrateLegacyGuestToProfile()
  const registry = await storage.readLocalProfiles()
  expect(registry).not.toBeNull()
  const friendId = crypto.randomUUID()
  await expect(storage.saveProfileItem(friendId, friend)).rejects.toThrow('Unknown local profile')
  await storage.createLocalProfile(friendId, Date.now())
  await storage.saveProfileItem(friendId, friend)
  expect(await storage.readProfileItems(friendId)).toEqual([friend])
  expect(await storage.readProfileItems(ownerId)).toEqual([own])
  await storage.saveProfileItem(ownerId, { ...own, purchased: true })
  expect(await storage.readProfileItems(ownerId)).toEqual([{ ...own, purchased: true }])
  expect(await storage.read()).toEqual([own])
  await storage.removeProfileItem(ownerId, own.id)
  expect(await storage.readProfileItems(ownerId)).toEqual([])
  expect(await storage.readProfileItems(friendId)).toEqual([friend])
  expect(await storage.read()).toEqual([own])
  await storage.close()
})

it('blocks profile cutover after a legacy edit instead of losing the newer data', async () => {
  const storage = createStorage('cutover-drift-' + crypto.randomUUID())
  const original = createItem('groceries', 'Исходный товар')
  await storage.save(original)
  const owner = await storage.migrateLegacyGuestToProfile()
  expect(await storage.verifyLegacyProfileCutover()).toBe(owner)
  const later = createItem('groceries', 'Добавлено после снимка')
  await storage.save(later)
  await expect(storage.verifyLegacyProfileCutover()).rejects.toThrow('cutover blocked')
  expect((await storage.read()).map(row => row.id).sort()).toEqual([original.id, later.id].sort())
  expect(await storage.readProfileItems(owner)).toEqual([original])
  await storage.close()
})

it('scopes list changes and archive completion to one profile', async () => {
  const storage = createStorage('scoped-archive-' + crypto.randomUUID())
  const owner = await storage.migrateLegacyGuestToProfile()
  const friend = crypto.randomUUID()
  await storage.createLocalProfile(friend, Date.now())
  const item = createItem('groceries', 'Друг покупает молоко')
  const friendList = { id: 'groceries', name: 'Список друга', symbol: '🛒', kind: 'oneoff' as const, createdAt: 1 }
  await storage.saveProfileList(friend, friendList)
  await storage.saveProfileItem(friend, item)
  await storage.renameProfileList(friend, 'groceries', 'Покупки друга')
  await storage.completeProfileList(friend, 'groceries', 'archive-friend', 100)
  expect(await storage.readProfileItems(friend)).toEqual([])
  expect(await storage.readProfileLists(friend)).toEqual([])
  expect((await storage.readProfileArchives(friend))[0].items).toEqual([item])
  expect(await storage.readProfileArchives(owner)).toEqual([])
  expect((await storage.readProfileLists(owner)).find(list => list.id === 'groceries')?.name).not.toBe('Покупки друга')
  await storage.close()
})

it('keeps pending operations isolated and rejects conflicting duplicate IDs', async () => {
  const storage = createStorage('profile-queue-' + crypto.randomUUID())
  const owner = await storage.migrateLegacyGuestToProfile()
  const friend = crypto.randomUUID()
  await storage.createLocalProfile(friend, Date.now())
  const item = createItem('groceries', 'Товар')
  const op = { operationId: 'same-id', kind: 'upsert' as const, item }
  await storage.enqueueProfilePending(owner, op)
  await storage.enqueueProfilePending(friend, op)
  await storage.enqueueProfilePending(friend, op)
  expect(await storage.readProfilePending(owner)).toEqual([op])
  expect(await storage.readProfilePending(friend)).toEqual([op])
  await expect(storage.enqueueProfilePending(friend, { ...op, item: { ...item, purchased: true } }))
    .rejects.toThrow('collision')
  expect(await storage.readProfilePending(owner)).toEqual([op])
  await storage.close()
})
