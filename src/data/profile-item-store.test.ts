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
  it('preserves E4 quantity, unit, identity and purchased state in a scoped profile edit', async () => {
    const storage = createStorage('profile-e4-edit-' + crypto.randomUUID())
    const owner = await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    const other = crypto.randomUUID()
    await storage.createLocalProfile(other, Date.now())
    const store = profileItemStore(storage, owner)
    const item = { ...createItem('groceries', 'Молоко'), purchased: true, quantity: 2, unit: 'л' }
    await store.save(item)
    await store.save({ ...item, name: 'Молоко безлактозное', quantity: undefined, unit: undefined })
    expect(await store.read()).toEqual([{ ...item, name: 'Молоко безлактозное', quantity: undefined, unit: undefined }])
    expect(await profileItemStore(storage, other).read()).toEqual([])
    await storage.close()
  })

  it('atomically reorders only the selected profile and rejects mismatched list sets', async () => {
    const storage=createStorage('e4-reorder-'+crypto.randomUUID())
    const owner=await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    const other=crypto.randomUUID()
    await storage.createLocalProfile(other,Date.now())
    const original=await storage.readProfileLists(owner)
    const a={id:crypto.randomUUID(),name:'Первый',symbol:'🛒',kind:'permanent' as const,createdAt:Date.now(),position:original.length}
    const b={...a,id:crypto.randomUUID(),name:'Второй',createdAt:Date.now()+1,position:original.length+1}
    await storage.saveProfileList(owner,a);await storage.saveProfileList(owner,b)
    const otherBefore=await storage.readProfileLists(other)
    const before=await storage.readProfileLists(owner)
    const reordered=[...before.filter(x=>x.id!==a.id&&x.id!==b.id),b,a].map((x,i)=>({...x,position:i}))
    await storage.reorderProfileLists(owner,reordered)
    expect((await storage.readProfileLists(owner)).sort((x,y)=>(x.position??0)-(y.position??0)).map(x=>x.id)).toEqual(reordered.map(x=>x.id))
    await expect(storage.reorderProfileLists(owner,[a])).rejects.toThrow('List set changed')
    expect(await storage.readProfileLists(other)).toEqual(otherBefore)
    expect((await storage.readProfileLists(owner)).find(x=>x.id===b.id)?.position).toBe(reordered.length-2)
    await storage.close()
  })

})
