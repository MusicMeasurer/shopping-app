import { useEffect, useRef, useState } from 'react'
import { createItem, type Item, type ListId } from '../domain/shopping'
import type { Storage } from '../data/storage'
export function useShopping(storage: Storage) {
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
  useEffect(() => { void reload() }, [storage])
  async function mutate(action: () => Promise<void>, update: (current: Item[]) => Item[]) {
    if (locked.current || loading) return false
    locked.current = true; setBusy(true); setError('')
    try { await action(); setItems(update); return true }
    catch { setError('Не удалось сохранить изменение. Данные на экране не изменены. Попробуйте ещё раз.'); return false }
    finally { locked.current = false; setBusy(false) }
  }
  return { items, loading, busy, error, reload,
    add: async (listId: ListId, name: string) => {
      try { const item = createItem(listId, name); return await mutate(() => storage.save(item), current => [...current, item]) }
      catch (error) { setError((error as Error).message); return false }
    },
    toggle: (item: Item) => { const updated = { ...item, purchased: !item.purchased }; return mutate(() => storage.save(updated), current => current.map(row => row.id === item.id ? updated : row)) },
    remove: (id: string) => mutate(() => storage.remove(id), current => current.filter(item => item.id !== id)),
  }
}
