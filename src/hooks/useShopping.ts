import { useEffect, useRef, useState } from 'react'
import { createItem, normalizeItemName, parseItems, type Item, type ListId } from '../domain/shopping'
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
    catch { setError('Не удалось сохранить изменение. Данные на экране не изменены. Попробуйте ещё раз.'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return { items, loading, busy, error, reload,
    add: async (listId: ListId, name: string) => {
      try {
        if (!storage.saveMany) {
          const item = createItem(listId, name)
          return await mutate(() => storage.save(item), current => [...current, item])
        }
        const next = parseItems(name).map(entry => ({ ...createItem(listId, entry.name), quantity: entry.quantity, unit: entry.unit }))
        return await mutate(() => storage.saveMany!(next), current => [...current, ...next])
      }
      catch (error) { setError((error as Error).message); return false }
    },
    rename: async (item: Item, rawName: string) => {
      try {
        const name = normalizeItemName(rawName)
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
        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Количество должно быть положительным.')
        const normalizedUnit = unit?.trim() || undefined
        const updated = { ...item, name, quantity, unit: normalizedUnit }
        if (name === item.name && quantity === item.quantity && normalizedUnit === item.unit) return true
        return await mutate(() => storage.save(updated), current => current.map(row => row.id === item.id ? updated : row))
      } catch (error) { setError((error as Error).message); return false }
    },
    toggle: (item: Item) => { const updated = { ...item, purchased: !item.purchased }; return mutate(() => storage.save(updated), current => current.map(row => row.id === item.id ? updated : row)) },
    remove: (id: string) => mutate(() => storage.remove(id), current => current.filter(item => item.id !== id)),
  }
}
