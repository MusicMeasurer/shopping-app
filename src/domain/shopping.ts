export const lists = [
  { id: 'groceries', name: 'Продукты', symbol: '🥬' },
  { id: 'household', name: 'Хозяйственные покупки', symbol: '🧹' },
] as const
// Dynamic list identifiers are required by E4; E3 default IDs remain valid.
export type ListId = string
export interface Item { id: string; listId: ListId; name: string; purchased: boolean; createdAt: number; quantity?: number; unit?: string }
export function normalizeItemName(rawName: string): string {
  const name = rawName.trim()
  if (!name || name.length > 120) throw new Error('Введите название от 1 до 120 символов.')
  return name
}
export function createItem(listId: ListId, rawName: string): Item {
  const name = normalizeItemName(rawName)
  return { id: crypto.randomUUID(), listId, name, purchased: false, createdAt: Date.now() }
}
export function itemsForList(items: Item[], listId: ListId): Item[] {
  return items.filter(item => item.listId === listId).sort((a, b) => Number(a.purchased) - Number(b.purchased) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

// E4 parsing is additive: existing E3 item names and cloud item contracts remain intact.
export interface ParsedItem { name: string; quantity?: number; unit?: string }
const units = 'кг|г|л|мл|шт|уп|упак|пач|бут|бан|kg|g|l|ml|pcs|pc'
const quantitySuffix = new RegExp('^(.+?)\\\\s+(\\\\d+(?:[.,]\\\\d+)?)\\\\s+(' + units + ')$', 'iu')
export function parseItem(line: string): ParsedItem {
  const raw = normalizeItemName(line)
  const match = raw.match(quantitySuffix)
  if (!match) return { name: raw }
  const name = normalizeItemName(match[1])
  const quantity = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(quantity) || quantity <= 0) return { name: raw }
  return { name, quantity, unit: match[3] }
}
export function parseItems(text: string): ParsedItem[] {
  const lines = text.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Введите хотя бы один товар.')
  return lines.map(parseItem)
}
