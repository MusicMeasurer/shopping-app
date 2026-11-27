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
    save: (item: Item, _wait?: boolean, pair?: { keep: Item; change: Item }): Promise<void> => accountId === null
      ? storage.save(item, pair)
      : storage.saveAccountItem(accountId, item),
    saveMany: accountId === null ? (items: Item[], marksOnly = false): Promise<void> => storage.saveItems(items, marksOnly) : undefined,
    remove: (id: string, pair?: { keep: Item; change: Item }): Promise<void> => accountId === null
      ? storage.remove(id, pair)
      : storage.removeAccountItem(accountId, id),
  }
}
export type ItemStore = Pick<ReturnType<typeof itemStoreForAccount>, 'read' | 'remove'> & { save: (item: Item, waitForSync?: boolean, pair?: { keep: Item; change: Item }) => Promise<void>; saveMany?: (items: Item[], marksOnly?: boolean) => Promise<void> }
