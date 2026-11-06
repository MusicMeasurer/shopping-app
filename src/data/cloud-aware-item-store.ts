import type { Item } from '../domain/shopping'
import type { Storage } from './storage'

/**
 * Account edits are atomic with their queued cloud operation when the list
 * has an explicit binding. Unbound lists stay local-only.
 */
export function cloudAwareItemStore(storage: Storage, accountId: string) {
  return {
    read: () => storage.readAccountItems(accountId),
    async save(item: Item): Promise<void> {
      const bindings = await storage.readAccountListMappings(accountId)
      const binding = bindings.find(row => row.localListId === item.listId)
      if (!binding) {
        await storage.saveAccountItem(accountId, item)
        return
      }
      const versions = await storage.readAccountItemVersions(accountId)
      const known = versions.find(row => row.itemId === item.id)
      if (known && known.remoteListId !== binding.remoteListId) {
        throw new Error('Item version belongs to a different cloud list')
      }
      const existing = (await storage.readAccountItems(accountId)).some(row => row.id === item.id)
      if (existing && !known) throw new Error('Existing item has no confirmed cloud version')
      await storage.saveAccountEdit(accountId, known ? {
        kind: 'cloud-update', operationId: crypto.randomUUID(),
        localListId: item.listId, remoteListId: binding.remoteListId,
        itemId: item.id, expectedVersion: known.version, item,
      } : {
        kind: 'cloud-add', operationId: crypto.randomUUID(),
        localListId: item.listId, remoteListId: binding.remoteListId,
        itemId: item.id, item,
      })
    },
    async remove(itemId: string): Promise<void> {
      const items = await storage.readAccountItems(accountId)
      const item = items.find(row => row.id === itemId)
      if (!item) throw new Error('Item not found')
      const bindings = await storage.readAccountListMappings(accountId)
      const binding = bindings.find(row => row.localListId === item.listId)
      if (!binding) {
        await storage.removeAccountItem(accountId, itemId)
        return
      }
      const versions = await storage.readAccountItemVersions(accountId)
      const known = versions.find(row => row.itemId === itemId && row.remoteListId === binding.remoteListId)
      if (!known) throw new Error('Unconfirmed cloud item cannot be deleted yet')
      await storage.saveAccountEdit(accountId, {
        kind: 'cloud-delete', operationId: crypto.randomUUID(),
        localListId: item.listId, remoteListId: binding.remoteListId,
        itemId, expectedVersion: known.version,
      })
    },
  }
}
