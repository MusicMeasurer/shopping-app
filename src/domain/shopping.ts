export const lists = [
  { id: 'groceries', name: 'Продукты', symbol: '🥬' },
  { id: 'household', name: 'Хозяйственные покупки', symbol: '🧹' },
] as const
// Dynamic list identifiers are required by E4; E3 default IDs remain valid.
export type ListId = string
export interface Item { id: string; listId: ListId; name: string; purchased: boolean; createdAt: number; quantity?: number; unit?: string }
export function validateName(rawName: string): string {
  const name = rawName.trim()
  if (!name || name.length > 120) throw new Error('Введите название от 1 до 120 символов.')
  return name
}
export const normalizeItemName = validateName
export function createItem(listId: ListId, rawName: string): Item {
  const name = validateName(rawName)
  return { id: crypto.randomUUID(), listId, name, purchased: false, createdAt: Date.now() }
}
export function itemsForList(items: Item[], listId: ListId): Item[] {
  return items.filter(item => item.listId === listId).sort((a, b) => Number(a.purchased) - Number(b.purchased) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export type ItemSort = 'recent' | 'name-asc' | 'name-desc' | 'quantity-asc' | 'quantity-desc'

const russianAlphabet = new Intl.Collator('ru', { sensitivity: 'base' })

function compareRecent(a: Item, b: Item): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

function unitGroup(item: Item): string {
  return (item.unit ?? '').trim().toLocaleLowerCase('ru').replace(/\.$/, '')
}

export function sortShoppingItems(items: readonly Item[], sort: ItemSort): Item[] {
  const direction = sort.endsWith('-desc') ? -1 : 1
  return [...items].sort((a, b) => {
    const name = russianAlphabet.compare(a.name, b.name)
    if (sort.startsWith('name')) return direction * name || compareRecent(a, b)
    if (sort === 'recent') return compareRecent(a, b)
    const left = unitGroup(a)
    const right = unitGroup(b)
    const group = Number(!left) - Number(!right) || russianAlphabet.compare(left, right)
    if (group) return group
    const missing = Number(a.quantity === undefined) - Number(b.quantity === undefined)
    const quantity = (a.quantity ?? 0) - (b.quantity ?? 0)
    return missing || direction * quantity || name || compareRecent(a, b)
  })
}

// E4 parsing is additive: existing E3 item names and cloud item contracts remain intact.
export interface ParsedItem { name: string; quantity?: number; unit?: string }
const units = 'кг|г|л|мл|шт[.]?|уп[.]?|упак|пач|бут|бан|kg|g|l|ml|pcs|pc'
const quantitySuffix = new RegExp('^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s+(' + units + ')$', 'iu')
export function parseItem(line: string): ParsedItem {
  const raw = validateName(line)
  const match = raw.match(quantitySuffix)
  if (!match) return { name: raw }
  const name = validateName(match[1])
  const quantity = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(quantity) || quantity <= 0) return { name: raw }
  return { name, quantity, unit: match[3] }
}
export function parseItems(text: string): ParsedItem[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) throw new Error('Введите хотя бы один товар.')
  return lines.map(parseItem)
}

/** Reserve consecutive timestamps so the first input line comes first when sorted newest-first. */
export function createItemBatch(listId: ListId, entries: ParsedItem[], previous: Item[], now = Date.now()): Item[] {
  const latest = previous.reduce((time, item) => item.listId === listId ? Math.max(time, item.createdAt) : time, now - 1)
  return entries.map((entry, index) => ({
    ...createItem(listId, entry.name), ...entry, createdAt: latest + entries.length - index,
  }))
}
