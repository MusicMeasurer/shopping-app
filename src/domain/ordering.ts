import type { ShoppingListRecord, ArchivedListRecord } from '../data/storage'

export function orderLists(lists: ShoppingListRecord[]): ShoppingListRecord[] {
  return [...lists].sort((a, b) =>
    (a.position ?? a.createdAt) - (b.position ?? b.createdAt) ||
    a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}
export function moveList(lists: ShoppingListRecord[], id: string, direction: -1 | 1): ShoppingListRecord[] {
  const sorted = orderLists(lists)
  const index = sorted.findIndex(list => list.id === id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= sorted.length) return sorted
  ;[sorted[index], sorted[target]] = [sorted[target], sorted[index]]
  return sorted.map((list, position) => ({ ...list, position }))
}
export function orderArchives(archives: ArchivedListRecord[]): ArchivedListRecord[] {
  return [...archives].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id))
}
