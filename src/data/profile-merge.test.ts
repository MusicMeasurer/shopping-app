import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'
import { profileName } from './local-profiles'

it('renames independent profiles, locks login names, and refreshes the verified login', async () => {
  const storage = createStorage('profile-names-' + crypto.randomUUID())
  const guest = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const renamed = await storage.renameLocalProfile(guest, '  Личные покупки  ')
  expect(profileName(renamed.profiles[0], 0)).toBe('Личные покупки')
  const bound = await storage.ensureVerifiedAccountProfile('a', { login: 'a@example.test' })
  expect(profileName(bound.profiles[1], 1)).toBe('a@example.test')
  await expect(storage.renameLocalProfile(bound.activeProfileId, 'Other')).rejects.toThrow('изменить нельзя')
  const refreshed = await storage.ensureVerifiedAccountProfile('a', { login: 'new@example.test' })
  expect(profileName(refreshed.profiles[1], 1)).toBe('new@example.test')
  expect(refreshed.profiles).toHaveLength(2)
  expect(await storage.readGuestImports('a')).toEqual([])
  await storage.close()
})

it('retains source through restart and atomically removes it only on confirmation, preserving target edits', async () => {
  const dbName = 'profile-merge-' + crypto.randomUUID()
  let storage = createStorage(dbName)
  const source = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const item = createItem('groceries', 'Milk')
  await storage.saveProfileItem(source, item)
  const target = (await storage.ensureVerifiedAccountProfile('a', { login: 'a@example.test' })).activeProfileId
  const targetItem = createItem('existing-local', 'Bread')
  await storage.bindAccountList('a', 'existing-local', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
  await storage.saveAccountItem('a', targetItem)
  await storage.switchLocalProfile(source)
  await storage.ensureVerifiedAccountProfile('a', { sourceProfileId: source, collisionMode: 'merge', login: 'a@example.test' })
  const [batch] = await storage.readGuestImports('a')
  await storage.close()
  storage = createStorage(dbName)
  expect((await storage.readGuestImports('a'))[0].operationId).toBe(batch.operationId)
  expect(await storage.readProfileItems(source)).toEqual([item])
  await expect(storage.renameProfileList(source, 'groceries', 'Oops')).rejects.toThrow('переносится')
  await expect(storage.completeProfileList(source, 'groceries', 'archive', 10)).rejects.toThrow('переносится')
  await expect(storage.saveProfileItems(source, [{ ...item, purchased: true }])).rejects.toThrow('переносится')
  await storage.confirmGuestImport(batch, [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Food', kind: 'permanent', position: 0 }], [
    { item: { ...item, id: 'remote-milk', listId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, version: 1 },
    { item: { ...targetItem, listId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'stale remote' }, version: 1 },
  ])
  await storage.confirmGuestImport(batch, [], []) // duplicate receipt does not duplicate data
  const registry = (await storage.readLocalProfiles())!
  expect(registry.profiles.map(p => p.id)).toEqual([target])
  expect(registry.activeProfileId).toBe(target)
  expect(await storage.readGuestCutoverOwner()).toBe(target)
  expect(await storage.readProfileItems(source)).toEqual([])
  expect(await storage.readGuestImports('a')).toEqual([])
  expect(await storage.readAccountItems('a')).toEqual(expect.arrayContaining([
    targetItem, { ...item, id: 'remote-milk', listId: 'existing-local' },
  ]))
  await expect(storage.saveProfileItem(source, item)).rejects.toThrow('переносится')
  await storage.createLocalProfile('independent', 1) // the legacy fence survives removal of original
  await storage.close()
})

it('rejects stale consent and importing a profile already bound to another account', async () => {
  const storage = createStorage('profile-stale-' + crypto.randomUUID())
  const source = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const bound = (await storage.ensureVerifiedAccountProfile('a')).activeProfileId
  await expect(storage.ensureVerifiedAccountProfile('b', { sourceProfileId: bound, collisionMode: 'merge' })).rejects.toThrow('consent required')
  await expect(storage.ensureVerifiedAccountProfile('a', { sourceProfileId: source, collisionMode: 'separate' })).rejects.toThrow('consent required')
  expect(await storage.readGuestImports('b')).toEqual([])
  await storage.close()
})

it('transfers the original profile into a first account and keeps another account isolated', async () => {
  const storage = createStorage('first-consented-' + crypto.randomUUID())
  const source = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const registry = await storage.ensureVerifiedAccountProfile('a', { sourceProfileId: source, collisionMode: 'separate', login: 'a@example.test' })
  const [batch] = await storage.readGuestImports('a')
  expect(batch.lists.length).toBeGreaterThan(0)
  expect(registry.profiles.some(p => p.id === source)).toBe(true)
  await storage.switchLocalProfile(source)
  await expect(storage.ensureVerifiedAccountProfile('b', { sourceProfileId: source, collisionMode: 'merge' })).rejects.toThrow('already assigned')
  await storage.ensureVerifiedAccountProfile('a')
  await storage.confirmGuestImport(batch, batch.lists.map((list, position) => ({ id: crypto.randomUUID(), name: list.name, kind: list.kind, position })), [])
  const after = (await storage.readLocalProfiles())!
  expect(after.profiles).toHaveLength(1)
  expect(after.profiles[0].cloudAccountId).toBe('a')
  expect(after.profiles[0].login).toBe('a@example.test')
  expect(await storage.readGuestImports('b')).toEqual([])
  await storage.close()
})
