import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

it('resumes confirmed cloud deletion across restart and keeps unrelated profiles and queues', async () => {
  const name = 'account-removal-' + crypto.randomUUID()
  const storage = createStorage(name)
  const local = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const a = 'account-a'
  const b = 'account-b'
  const localItem = createItem('groceries', 'Чай')
  const firstItem = createItem('groceries', 'Хлеб')
  const otherItem = createItem('groceries', 'Яблоко')
  await storage.saveProfileItem(local, localItem)
  await storage.ensureVerifiedAccountProfile(a)
  await storage.saveAccountItem(a, firstItem)
  await storage.enqueueAccountPending(a, { operationId: 'remove-a', kind: 'upsert', item: firstItem })
  await storage.ensureVerifiedAccountProfile(b)
  await storage.saveAccountItem(b, otherItem)
  const installation = await storage.readInstallationIdentity()
  await expect(storage.purgeDeletedAccount(a)).rejects.toThrow('not confirmed')
  await storage.rememberDeletedAccount(a)
  await storage.close()

  const reopened = createStorage(name)
  expect(await reopened.readInstallationIdentity()).toEqual(installation)
  await reopened.acknowledgeDeletedAccount(a)
  expect(await reopened.readAccountDeletions()).toEqual([{ accountId: a, purged: false, acknowledged: false }])
  await expect(reopened.saveAccountItem(a, firstItem)).rejects.toThrow('deleted')
  await reopened.purgeDeletedAccount(a)
  await reopened.purgeDeletedAccount(a)
  await reopened.acknowledgeDeletedAccount(a)
  expect(await reopened.readAccountDeletions()).toEqual([{ accountId: a, purged: true, acknowledged: true }])
  expect(await reopened.readAccountItems(a)).toEqual([])
  expect(await reopened.readAccountPending(a)).toEqual([])
  expect(await reopened.readAccountItems(b)).toEqual([otherItem])
  expect(await reopened.readProfileItems(local)).toEqual([localItem])
  expect((await reopened.readLocalProfiles())?.profiles.map(row => row.cloudAccountId)).toEqual([null, b])
  await expect(reopened.ensureVerifiedAccountProfile(a)).rejects.toThrow('deletion')
  await reopened.ensureVerifiedAccountProfile('new-account-id')
  await reopened.close()
})

it('creates a fresh local profile after purging the last cloud copy', async () => {
  const storage = createStorage('last-account-' + crypto.randomUUID())
  const original = await storage.migrateLegacyGuestToProfile()
  await storage.markGuestCutoverReady()
  const { activeProfileId: cloudProfile } = await storage.ensureVerifiedAccountProfile('only-account')
  await storage.deleteLocalProfile(original, original)
  await storage.rememberDeletedAccount('only-account')
  await storage.purgeDeletedAccount('only-account')
  const result = await storage.readLocalProfiles()
  expect(result?.profiles).toEqual([{ id: result?.activeProfileId, cloudAccountId: null, name: 'Мои покупки', createdAt: expect.any(Number) }])
  expect(result?.activeProfileId).not.toBe(cloudProfile)
  expect(await storage.readGuestCutoverOwner()).toBe(result?.activeProfileId)
  await storage.close()
})
