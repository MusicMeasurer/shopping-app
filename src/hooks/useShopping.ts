import { useEffect, useRef, useState } from 'react'
import { createItemBatch, normalizeItemName, parseItems, type Item, type ListId } from '../domain/shopping'
import { filterNewItemNames, hasItemName, itemNameKey, type ItemNameDecision } from '../domain/item-names'
import { ItemSaveError } from '../data/item-save-error'
import type { ItemStore } from '../data/account-item-store'
export function useShopping(storage: ItemStore, refreshRevision = 0) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const reload = async () => {
    setLoading(true)
    try { setItems(await storage.read()); setError('') }
    catch { setError('Не удалось открыть сохранённые списки. Проверьте настройки браузера и повторите попытку.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [storage, refreshRevision])
  async function mutate(action: () => Promise<void>, update: (current: Item[]) => Item[]) {
    if (locked.current || loading) return false
    locked.current = true; setBusy(true); setError('')
    try { await action(); setItems(update); return true }
    catch (error) { setError(error instanceof ItemSaveError ? error.message : 'Не удалось сохранить изменение. Данные на экране не изменены. Попробуйте ещё раз.'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return { items, loading, busy, error, reload, clearError: () => setError(''),
    add: async (listId: ListId, name: string) => {
      try {
        const entries = storage.saveMany ? parseItems(name) : [{ name: normalizeItemName(name) }]
        const { accepted, skipped } = filterNewItemNames(items, listId, entries)
        if (!accepted.length) return { saved: 0, skipped }
        const next = createItemBatch(listId, accepted, items)
        const save = storage.saveMany
        const success = await mutate(() => save ? save(next) : storage.save(next[0]), current => [...current, ...next])
        if (success) return { saved: next.length, skipped }
      } catch (error) { setError((error as Error).message) }
    },
    rename: async (item: Item, rawName: string) => {
      try {
        const name = normalizeItemName(rawName)
        if (itemNameKey(name) !== itemNameKey(item.name) && hasItemName(items, item.listId, name, item.id))
          throw new ItemSaveError('Товар с таким названием уже есть в списке.')
        if (name === item.name) return true
        const updated = { ...item, name }
        return await mutate(() => storage.save(updated), current => current.map(row => row.id === item.id ? updated : row))
      } catch (error) {
        setError((error as Error).message)
        return false
      }
    },
    // E4 full-field editing through the E3 profile/account-scoped item store.
    edit: async (item: Item, rawName: string, quantity?: number, unit?: string) => {
      try {
        const name = normalizeItemName(rawName)
        if (itemNameKey(name) !== itemNameKey(item.name) && hasItemName(items, item.listId, name, item.id))
          throw new ItemSaveError('Товар с таким названием уже есть в списке.')
        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Количество должно быть положительным.')
        const normalizedUnit = unit?.trim() || undefined
        const updated = { ...item, name, quantity, unit: normalizedUnit }
        if (name === item.name && quantity === item.quantity && normalizedUnit === item.unit) return true
        return await mutate(() => storage.save(updated, true), current => current.map(row => row.id === item.id ? updated : row))
      } catch (error) { setError((error as Error).message); return false }
    },
    resolveName: (decision: ItemNameDecision) => {
      if (decision.name !== undefined) {
        const updated = { ...decision.change, name: decision.name }
        return mutate(() => storage.save(updated, false, decision),
          current => current.map(item => item.id === updated.id ? updated : item))
      }
      return mutate(() => storage.remove(decision.change.id, decision),
        current => current.filter(item => item.id !== decision.change.id))
    },
    toggle: (item: Item) => { const updated = { ...item, purchased: !item.purchased }; return mutate(() => storage.save(updated), current => current.map(row => row.id === item.id ? updated : row)) },
    remove: (id: string) => mutate(() => storage.remove(id), current => current.filter(item => item.id !== id)),
  }
}
