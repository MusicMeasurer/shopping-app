import type { Item } from '../domain/shopping'

/**
 * Conservative E3 reconciliation: never silently overwrite two versions of
 * the same item. The caller must resolve conflicts before applying a merge.
 */
export interface MergeResult {
  merged: Item[]
  conflicts: { local: Item; remote: Item }[]
}

function sameItem(a: Item, b: Item): boolean {
  return a.id === b.id && a.listId === b.listId &&
    a.name === b.name && a.purchased === b.purchased &&
    a.createdAt === b.createdAt
}

export function reconcileItems(local: Item[], remote: Item[]): MergeResult {
  const merged = new Map<string, Item>()
  const conflicts: MergeResult['conflicts'] = []
  for (const item of local) merged.set(item.id, item)
  for (const item of remote) {
    const existing = merged.get(item.id)
    if (!existing) merged.set(item.id, item)
    else if (!sameItem(existing, item)) conflicts.push({ local: existing, remote: item })
  }
  return { merged: [...merged.values()], conflicts }
}
