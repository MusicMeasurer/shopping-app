import type { Item } from '../domain/shopping'
import type { ItemStore } from './account-item-store'
import type { Storage } from './storage'

/** Guest profile item adapter. No account or legacy namespace fallback is permitted. */
export function profileItemStore(storage: Storage, profileId: string): ItemStore {
  if (!profileId.trim()) throw new Error('Profile ID required')
  return {
    read: (): Promise<Item[]> => storage.readProfileItems(profileId),
    save: (item: Item): Promise<void> => storage.saveProfileItem(profileId, item),
    saveMany: (items: Item[]): Promise<void> => storage.saveProfileItems(profileId, items),
    remove: (id: string): Promise<void> => storage.removeProfileItem(profileId, id),
  }
}
