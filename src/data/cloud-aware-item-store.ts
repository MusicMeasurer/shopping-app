import { ItemSaveError } from './item-save-error'
import type { Item } from '../domain/shopping'
import type { Storage } from './storage'

function validateCloudItem(item: Item) {
  if (item.quantity !== undefined && (!Number.isFinite(item.quantity) || item.quantity <= 0 ||
      item.quantity >= 1e9 || Number(item.quantity.toFixed(3)) !== item.quantity))
    throw new ItemSaveError('Введите положительное количество с точностью до трёх знаков после запятой')
  if (item.unit !== undefined && item.unit.trim().length > 30)
    throw new ItemSaveError('Единица измерения должна содержать не более 30 символов')
}

/**
 * Account edits are atomic with their queued cloud operation when the list
 * has an explicit binding. Unbound lists stay local-only.
 */
export function cloudAwareItemStore(storage: Storage, accountId: string, onQueued?: () => void) {
  return {
    read: () => storage.readAccountItems(accountId),
    async saveMany(items: Item[], marksOnly = false): Promise<void> {
      if (!marksOnly) items.forEach(validateCloudItem)
      await storage.saveAccountItemsToSync(accountId, items, marksOnly)
      onQueued?.()
    },
    async save(item: Item, _waitForSync = false): Promise<void> {
      validateCloudItem(item)
      if (await storage.writeDraftItem(accountId, item)) { onQueued?.(); return }
      const bindings = await storage.readAccountListMappings(accountId)
      const binding = bindings.find(row => row.localListId === item.listId)
      if (!binding) {
        await storage.saveAccountItem(accountId, item)
        return
      }
      // The write transaction, not a stale queue read, decides whether
      // an existing unsent update can be coalesced or must remain immutable.
      const pending = (await storage.readAccountPending(accountId)).filter(operation =>
        (operation.kind === 'upsert' ? operation.item.id : operation.itemId) === item.id)
      if (pending.some(operation => operation.kind !== 'cloud-update'))
        throw new ItemSaveError('Предыдущее изменение товара ещё синхронизируется. Сначала отмените его или дождитесь подтверждения.')
      const versions = await storage.readAccountItemVersions(accountId)
      const known = versions.find(row => row.itemId === item.id)
      if (known && known.remoteListId !== binding.remoteListId) {
        throw new Error('Item version belongs to a different cloud list')
      }
      const existing = (await storage.readAccountItems(accountId)).some(row => row.id === item.id)
      if (existing && !known) throw new ItemSaveError('Версия товара ещё не подтверждена. Дождитесь синхронизации и повторите сохранение.')
      await storage.saveAccountEdit(accountId, known ? {
        kind: 'cloud-update', operationId: crypto.randomUUID(),
        localListId: item.listId, remoteListId: binding.remoteListId,
        itemId: item.id, expectedVersion: known.version, item,
      } : {
        kind: 'cloud-add', operationId: crypto.randomUUID(),
        localListId: item.listId, remoteListId: binding.remoteListId,
        itemId: item.id, item,
      })
      onQueued?.()
    },
    async remove(itemId: string): Promise<void> {
      const items = await storage.readAccountItems(accountId)
      const item = items.find(row => row.id === itemId)
      if (!item) throw new Error('Item not found')
      if (await storage.writeDraftItem(accountId, item, true)) { onQueued?.(); return }
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
      onQueued?.()
    },
  }
}
