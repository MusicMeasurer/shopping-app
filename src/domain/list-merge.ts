import { itemNameKey, sameItemSnapshot } from './item-names'
import { validateName, type Item } from './shopping'

export interface MergeList {
  id: string
  name: string
  kind: 'permanent' | 'oneoff'
}

export interface ListMergeSnapshot {
  source: MergeList
  target: MergeList
  items: Item[]
}

export interface MergeChoice {
  keepId: string
  custom?: Pick<Item, 'quantity' | 'unit' | 'purchased'>
  renamed: Record<string, string>
}

export interface ListMergeActions {
  read(sourceId: string, targetId: string): Promise<ListMergeSnapshot>
  apply(snapshot: ListMergeSnapshot, choices: ReadonlyMap<string, MergeChoice>, operationId: string): Promise<void>
}

export class ListMergeConflict extends Error {
  constructor() { super('Списки изменились. Проверьте новый результат перед подтверждением.') }
}

export function sameMergeSnapshot(expected: ListMergeSnapshot, current: ListMergeSnapshot): boolean {
  return (['source', 'target'] as const).every(key => {
    const a = expected[key], b = current[key]
    return a.id === b.id && a.name === b.name && a.kind === b.kind
  }) && expected.items.length === current.items.length && expected.items.every(item => {
    const now = current.items.find(row => row.id === item.id)
    return now && sameItemSnapshot(item, now) && item.createdAt === now.createdAt
  })
}

export function mergeGroups(items: readonly Item[]): Map<string, Item[]> {
  const groups = new Map<string, Item[]>()
  for (const item of items) {
    const key = itemNameKey(item.name)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

export function planListMerge(snapshot: ListMergeSnapshot, choices: ReadonlyMap<string, MergeChoice>): Item[] {
  const { source, target } = snapshot
  if (source.id === target.id || snapshot.items.some(item => item.listId !== source.id && item.listId !== target.id))
    throw new Error('Выберите два разных списка.')
  const groups = mergeGroups(snapshot.items)
  const result: Item[] = []
  const used = new Set(groups.keys())
  for (const [key, group] of groups) {
    if (group.length === 1) {
      result.push({ ...group[0], listId: target.id })
      continue
    }
    const choice = choices.get(key)
    const keep = group.find(item => item.id === choice?.keepId)
    if (!choice || !keep) throw new Error('Выберите итоговую позицию для «' + group[0].name + '».')
    if (choice.custom?.quantity !== undefined && (!Number.isFinite(choice.custom.quantity) || choice.custom.quantity <= 0))
      throw new Error('Количество должно быть больше нуля.')
    result.push({ ...keep, ...choice.custom, listId: target.id })
    for (const item of group) {
      if (item.id === keep.id || item.listId !== source.id || !Object.hasOwn(choice.renamed, item.id)) continue
      const name = validateName(choice.renamed[item.id])
      const renamedKey = itemNameKey(name)
      if (used.has(renamedKey)) throw new Error('Название «' + name + '» уже есть в итоговом списке.')
      used.add(renamedKey)
      result.push({ ...item, listId: target.id, name })
    }
  }
  return result
}
