export const lists = [
  { id: 'groceries', name: 'Продукты', symbol: '🥬' },
  { id: 'household', name: 'Хозяйственные покупки', symbol: '🧹' },
] as const
export type ListId = typeof lists[number]['id']
export interface Item { id: string; listId: ListId; name: string; purchased: boolean; createdAt: number }
export function createItem(listId: ListId, rawName: string): Item {
  const name = rawName.trim()
  if (!name || name.length > 120) throw new Error('Введите название от 1 до 120 символов.')
  return { id: crypto.randomUUID(), listId, name, purchased: false, createdAt: Date.now() }
}
export function itemsForList(items: Item[], listId: ListId): Item[] {
  return items.filter(item => item.listId === listId).sort((a, b) => Number(a.purchased) - Number(b.purchased) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}
