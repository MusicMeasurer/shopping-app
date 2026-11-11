import type { Item } from '../domain/shopping'
import type { Storage } from './storage'

/**
 * Select a local item namespace. Guest data is never implicitly migrated
 * or uploaded when the signed-in account changes.
 */
export function itemStoreForAccount(storage: Storage, accountId: string | null) {
  if (accountId !== null && !accountId.trim()) {
    throw new Error('Account ID cannot be empty')
  }
  return {
    read: (): Promise<Item[]> => accountId === null
      ? storage.read()
      : storage.readAccountItems(accountId),
    save: (item: Item): Promise<void> => accountId === null
      ? storage.save(item)
      : storage.saveAccountItem(accountId, item),
    saveMany: accountId === null ? (items: Item[]): Promise<void> => storage.saveItems(items) : undefined,
    remove: (id: string): Promise<void> => accountId === null
      ? storage.remove(id)
      : storage.removeAccountItem(accountId, id),
  }
}
export type ItemStore = Pick<ReturnType<typeof itemStoreForAccount>, 'read' | 'save' | 'remove'> & { saveMany?: (items: Item[]) => Promise<void> }
