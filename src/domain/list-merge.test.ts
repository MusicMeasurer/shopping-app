import { expect, test } from 'vitest'
import { planListMerge, sameMergeSnapshot, type ListMergeSnapshot, type MergeChoice } from './list-merge'

const snapshot: ListMergeSnapshot = {
  source: { id: 'source', name: 'На выходные', kind: 'oneoff' },
  target: { id: 'target', name: 'Продукты', kind: 'permanent' },
  items: [
    { id: 'source-milk', listId: 'source', name: 'Молоко', quantity: 1, unit: 'л', purchased: true, createdAt: 1 },
    { id: 'target-milk', listId: 'target', name: 'молоко', quantity: 2, unit: 'уп.', purchased: false, createdAt: 2 },
    { id: 'eggs', listId: 'target', name: 'Яйца', purchased: false, createdAt: 3 },
  ],
}
const choose = (renamed: Record<string, string> = {}, custom?: MergeChoice['custom']) =>
  new Map([['молоко', { keepId: 'target-milk', renamed, custom }]])

test('keeps the destination entry and transfers its renamed duplicate with original details', () => {
  expect(planListMerge(snapshot, choose({ 'source-milk': ' Молоко в дорогу ' }))).toEqual([
    snapshot.items[1], { ...snapshot.items[0], listId: 'target', name: 'Молоко в дорогу' }, snapshot.items[2],
  ])
})
test('demands an explicit choice and checks a rename against the entire result', () => {
  expect(() => planListMerge(snapshot, new Map())).toThrow('Выберите итоговую позицию')
  expect(() => planListMerge(snapshot, choose({ 'source-milk': ' МОЛОКО ' }))).toThrow('уже есть')
  expect(() => planListMerge(snapshot, choose({ 'source-milk': ' ЯЙЦА ' }))).toThrow('уже есть')
})
test('accepts a custom result for an old group of duplicates without modifying either input', () => {
  const third = { ...snapshot.items[1], id: 'older', createdAt: 0 }
  const rows = { ...snapshot, items: [...snapshot.items, third] }
  expect(planListMerge(rows, choose({}, { quantity: 4, unit: 'л', purchased: true }))).toEqual([
    { ...snapshot.items[1], quantity: 4, unit: 'л', purchased: true }, snapshot.items[2],
  ])
  expect(third.quantity).toBe(2)
  expect(sameMergeSnapshot(snapshot, rows)).toBe(false)
})
