import { useEffect, useRef, useState } from 'react'
import { createItem, parseItems, validateName, type Item, type ListId } from '../domain/shopping'
import type { Storage, ShoppingListRecord, ArchivedListRecord } from '../data/storage'
export function useShopping(storage: Storage) {
  const [items, setItems] = useState<Item[]>([])
  const [lists, setLists] = useState<ShoppingListRecord[]>([])
  const [archives, setArchives] = useState<ArchivedListRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = useRef(false)
  const reload = async () => {
    setLoading(true)
    try {
      const [nextItems, nextLists, nextArchives] = await Promise.all([storage.read(), storage.readLists(), storage.readArchives()])
      setItems(nextItems); setLists(nextLists); setArchives(nextArchives); setError('')
    } catch { setError('Не удалось открыть сохранённые списки. Проверьте настройки браузера и повторите попытку.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [storage])
  async function mutate(action: () => Promise<void>, update: () => void) {
    if (locked.current || loading) return false
    locked.current = true; setBusy(true); setError('')
    try { await action(); update(); return true }
    catch { setError('Не удалось сохранить изменение. Данные на экране не изменены. Попробуйте ещё раз.'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return { items, lists, archives, loading, busy, error, reload,
    add: async (listId: ListId, name: string) => {
      try {
        const next = parseItems(name).map(entry => createItem(listId, entry))
        return await mutate(() => storage.saveItems(next), () => setItems(current => [...current, ...next]))
      } catch (error) { setError((error as Error).message); return false }
    },
    toggle: (item: Item) => {
      const updated = { ...item, purchased: !item.purchased }
      return mutate(() => storage.save(updated), () => setItems(current => current.map(row => row.id === item.id ? updated : row)))
    },
    edit: async (item: Item, name: string, quantity?: number, unit?: string) => {
      try {
        const updated = { ...item, name: validateName(name), quantity, unit: unit?.trim() || undefined }
        if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Количество должно быть положительным.')
        return await mutate(() => storage.save(updated), () => setItems(current => current.map(row => row.id === item.id ? updated : row)))
      } catch (error) { setError((error as Error).message); return false }
    },
    remove: (id: string) => mutate(() => storage.remove(id), () => setItems(current => current.filter(item => item.id !== id))),
    createList: async (name: string, kind: 'permanent' | 'oneoff') => {
      try {
        const record: ShoppingListRecord = { id: crypto.randomUUID(), name: validateName(name), symbol: '🛒', kind, createdAt: Date.now() }
        const ok = await mutate(() => storage.saveList(record), () => setLists(current => [...current, record]))
        return ok ? record.id : null
      } catch (error) { setError((error as Error).message); return null }
    },
    renameList: async (record: ShoppingListRecord, name: string) => {
      try {
        const updated = { ...record, name: validateName(name) }
        return await mutate(() => storage.saveList(updated), () => setLists(current => current.map(row => row.id === record.id ? updated : row)))
      } catch (error) { setError((error as Error).message); return false }
    },
    deleteList: (id: string) => mutate(() => storage.deleteList(id), () => {
      setLists(current => current.filter(row => row.id !== id))
      setItems(current => current.filter(item => item.listId !== id))
    }),
    completeList: (record: ShoppingListRecord) => {
      const id = crypto.randomUUID(), completedAt = Date.now()
      const snapshot: ArchivedListRecord = { id, sourceListId: record.id, name: record.name, kind: record.kind, completedAt, items: items.filter(item => item.listId === record.id) }
      return mutate(() => storage.completeList(record, id, completedAt), () => {
        setArchives(current => [...current, snapshot])
        setItems(current => current.filter(item => item.listId !== record.id))
        if (record.kind === 'oneoff') setLists(current => current.filter(row => row.id !== record.id))
      })
    },
  }
}
