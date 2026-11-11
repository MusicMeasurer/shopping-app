import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createItem } from '../domain/shopping'
import { createStorage } from './storage'
import { profileItemStore } from './profile-item-store'

describe('profile item adapter', () => {
  it('isolates batch, edit and delete across profiles and legacy', async () => {
    const storage = createStorage('profile-adapter-' + crypto.randomUUID())
    const original = createItem('groceries', 'Мой сыр')
    await storage.save(original)
    const owner = await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    const friend = crypto.randomUUID()
    await storage.createLocalProfile(friend, Date.now())
    const ownStore = profileItemStore(storage, owner)
    const friendStore = profileItemStore(storage, friend)
    const first = createItem('groceries', 'Чай друга')
    const second = createItem('groceries', 'Кофе друга')
    await friendStore.saveMany!([first, second])
    expect(await friendStore.read()).toHaveLength(2)
    expect(await ownStore.read()).toEqual([original])
    await friendStore.save({ ...first, purchased: true })
    await friendStore.remove(second.id)
    expect(await friendStore.read()).toEqual([{ ...first, purchased: true }])
    expect(await ownStore.read()).toEqual([original])
    expect(await storage.read()).toEqual([original])
    await storage.close()
  })

  it('rejects unknown profile without partially persisting a batch', async () => {
    const storage = createStorage('profile-adapter-reject-' + crypto.randomUUID())
    await storage.migrateLegacyGuestToProfile()
    const store = profileItemStore(storage, crypto.randomUUID())
    await expect(store.saveMany!([createItem('groceries', 'Хлеб')])).rejects.toThrow('Unknown local profile')
    expect(await store.read()).toEqual([])
    expect(() => profileItemStore(storage, '')).toThrow('Profile ID required')
    await storage.close()
  })
})
