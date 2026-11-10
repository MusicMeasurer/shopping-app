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
export function placeList(lists: ShoppingListRecord[], movedId: string, targetId: string): ShoppingListRecord[] {
  const sorted = orderLists(lists)
  const from = sorted.findIndex(row => row.id === movedId)
  const to = sorted.findIndex(row => row.id === targetId)
  if (from < 0 || to < 0 || from === to) return sorted
  const [moved] = sorted.splice(from, 1)
  sorted.splice(to, 0, moved)
  return sorted.map((row, position) => ({ ...row, position }))
}
export function orderArchives(archives: ArchivedListRecord[]): ArchivedListRecord[] {
  return [...archives].sort((a, b) => b.completedAt - a.completedAt || a.id.localeCompare(b.id))
}
