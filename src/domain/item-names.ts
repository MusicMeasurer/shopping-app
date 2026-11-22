import type { Item, ListId, ParsedItem } from './shopping'

export function itemNameKey(name: string): string {
  return name.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru')
}

export function hasItemName(items: readonly Item[], listId: ListId, name: string, exceptId?: string): boolean {
  const key = itemNameKey(name)
  return items.some(item => item.listId === listId && item.id !== exceptId && itemNameKey(item.name) === key)
}

export function filterNewItemNames(items: readonly Item[], listId: ListId, entries: ParsedItem[]) {
  const used = new Set(items.filter(item => item.listId === listId).map(item => itemNameKey(item.name)))
  const accepted: ParsedItem[] = []
  const skipped = new Map<string, string>()
  for (const entry of entries) {
    const key = itemNameKey(entry.name)
    if (used.has(key)) {
      if (!skipped.has(key)) skipped.set(key, entry.name)
      continue
    }
    used.add(key)
    accepted.push(entry)
  }
  return { accepted, skipped: [...skipped.values()] }
}

export function duplicatedItems(items: readonly Item[]): Item[][] {
  const lists = new Map<ListId, Map<string, Item[]>>()
  for (const item of items) {
    const names = lists.get(item.listId) ?? new Map<string, Item[]>()
    const key = itemNameKey(item.name)
    const entries = names.get(key) ?? []
    entries.push(item)
    names.set(key, entries)
    lists.set(item.listId, names)
  }
  return [...lists.values()].flatMap(names => [...names.values()].filter(entries => entries.length > 1))
}

export interface ItemNameDecision {
  operationId: string
  keep: Item
  change: Item
  name?: string
}

export function sameItemSnapshot(a: Item, b: Item): boolean {
  return a.id === b.id && a.listId === b.listId && a.name === b.name &&
    a.purchased === b.purchased && a.quantity === b.quantity && a.unit === b.unit
}

export function matchingNamePair(keep: Item, change: Item): boolean {
  return keep.id !== change.id && keep.listId === change.listId && itemNameKey(keep.name) === itemNameKey(change.name)
}
