import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'
import { cloudAwareItemStore } from './cloud-aware-item-store'
import { profileItemStore } from './profile-item-store'

/** Simulated two-user lifecycle. Account IDs stand for previously verified identities.
 * Does not assert real Supabase authentication or RLS; that needs a hosted test.
 */
describe('two-account offline lifecycle', () => {
  it('preserves guest, Alice, Bob, offline queue and restart without mixing namespaces', async () => {
    const name = 'two-account-lifecycle-' + crypto.randomUUID()
    const first = createStorage(name)
    const guestItem = createItem('groceries', 'Молоко владельца')
    await first.save(guestItem)
    const owner = await first.migrateLegacyGuestToProfile()
    await first.markGuestCutoverReady()
    const alice = (await first.ensureVerifiedAccountProfile('verified-alice')).activeProfileId
    const aliceItem = createItem('groceries', 'Яблоки Алисы')
    await first.bindAccountList('verified-alice', 'groceries', crypto.randomUUID())
    await cloudAwareItemStore(first, 'verified-alice').save(aliceItem)
    expect(await first.readAccountPending('verified-alice')).toHaveLength(1)
    expect(await first.readAccountPending('verified-bob')).toEqual([])
    const bob = (await first.ensureVerifiedAccountProfile('verified-bob')).activeProfileId
    const bobItem = createItem('groceries', 'Хлеб Боба')
    await cloudAwareItemStore(first, 'verified-bob').save(bobItem)
    expect(await first.readAccountItems('verified-bob')).toEqual([bobItem])
    expect(await first.readAccountItems('verified-alice')).toEqual([aliceItem])
    expect(await first.readProfileItems(owner)).toEqual([guestItem])
    expect(await first.readProfileItems(alice)).toEqual([])
    expect(await first.readProfileItems(bob)).toEqual([])
    await first.close()

    const reopened = createStorage(name)
    expect(await profileItemStore(reopened, owner).read()).toEqual([guestItem])
    expect(await reopened.readAccountItems('verified-bob')).toEqual([bobItem])
    expect(await reopened.readAccountPending('verified-alice')).toHaveLength(1)
    const again = await reopened.ensureVerifiedAccountProfile('verified-alice')
    expect(again.activeProfileId).toBe(alice)
    expect(again.profiles).toHaveLength(3)
    await cloudAwareItemStore(reopened, 'verified-alice').save(createItem('household', 'Офлайн покупка Алисы'))
    expect(await reopened.readAccountItems('verified-bob')).toEqual([bobItem])
    expect(await reopened.readProfileItems(owner)).toEqual([guestItem])
    expect((await reopened.readLocalProfiles())?.profiles.find(p => p.id === owner)?.cloudAccountId).toBeNull()
    await reopened.close()
  })

  it('does not inherit another account cloud binding or pending operations', async () => {
    const storage = createStorage('two-account-bindings-' + crypto.randomUUID())
    await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    await storage.ensureVerifiedAccountProfile('account-a')
    await storage.bindAccountList('account-a', 'groceries', crypto.randomUUID())
    await cloudAwareItemStore(storage, 'account-a').save(createItem('groceries', 'Только А'))
    await storage.ensureVerifiedAccountProfile('account-b')
    expect(await storage.readAccountListMappings('account-b')).toEqual([])
    expect(await storage.readAccountPending('account-b')).toEqual([])
    expect(await storage.readAccountItems('account-b')).toEqual([])
    expect(await storage.readAccountPending('account-a')).toHaveLength(1)
    await storage.close()
  })
})
