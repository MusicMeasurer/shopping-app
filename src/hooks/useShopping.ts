import { useEffect, useRef, useState } from 'react'
import { createItemBatch, normalizeItemName, parseItems, type Item, type ListId, type ParsedItem } from '../domain/shopping'
import { filterNewItemNames, hasItemName, itemNameKey, type ItemNameDecision } from '../domain/item-names'
import { ItemSaveError } from '../data/item-save-error'
import { ItemReadGate } from './item-read-gate'
import type { ItemStore } from '../data/account-item-store'
export function useShopping(storage: ItemStore, refreshRevision = 0) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const gate = useRef(new ItemReadGate()).current
  const latestStorage = useRef(storage)
  latestStorage.current = storage
  const mounted = useRef(false)
  // The workspace is keyed by profile/account. Background reads must not
  // unmount its existing rows or disable a user's next click.
  const read = async (blocking = false) => {
    const ticket = gate.startRead(blocking)
    if (gate.blocking) setLoading(true)
    try {
      const snapshot = await latestStorage.current.read()
      if (!gate.finishRead(ticket) || !mounted.current) return
      setItems(snapshot); setReadError(''); setLoading(false)
    } catch {
      if (!gate.finishRead(ticket) || !mounted.current) return
      setReadError('Не удалось открыть сохранённые списки. Проверьте настройки браузера и повторите попытку.')
      setLoading(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void read()
    return () => { mounted.current = false; gate.invalidateRead() }
  }, [storage, refreshRevision])
  const reload = async () => { setError(''); await read(true) }
  async function mutate(action: () => Promise<void>, update: (current: Item[]) => Item[]) {
    if (!gate.startWrite()) return false
    setBusy(true); setError('')
    try { await action(); if (mounted.current) setItems(update); return true }
    catch (error) {
      if (mounted.current) setError(error instanceof ItemSaveError ? error.message : 'Не удалось сохранить изменение. Данные на экране не изменены. Попробуйте ещё раз.')
      return false
    } finally {
      const reconcile = gate.finishWrite()
      if (mounted.current) {
        setBusy(false)
        if (reconcile) void read()
      }
    }
  }
  return { items, loading, busy, error: error || readError, reload, clearError: () => { setError(''); setReadError('') },
    add: async (listId: ListId, name: string) => {
      let entries: ParsedItem[]
      try { entries = storage.saveMany ? parseItems(name) : [{ name: normalizeItemName(name) }] }
      catch { return { validationError: 'Проверьте название: каждый товар должен содержать от 1 до 120 символов.' } }
      const { accepted, skipped } = filterNewItemNames(items, listId, entries)
      if (!accepted.length) return { saved: 0, skipped }
      const next = createItemBatch(listId, accepted, items)
      const save = storage.saveMany
      const success = await mutate(() => save ? save(next) : storage.save(next[0]), current => [...current.filter(row => !next.some(item => item.id === row.id)), ...next])
      if (success) return { saved: next.length, skipped }
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
