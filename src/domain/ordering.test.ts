import { describe, expect, it } from 'vitest'
import { moveList, orderLists, orderArchives } from './ordering'
import type { ShoppingListRecord, ArchivedListRecord } from '../data/storage'
const record = (id: string, createdAt: number, position?: number): ShoppingListRecord =>
  ({ id, name: id, symbol: '🛒', kind: 'permanent', createdAt, position })
const archive = (id: string, completedAt: number): ArchivedListRecord =>
  ({ id, sourceListId: 'a', name: id, kind: 'permanent', completedAt, items: [] })
describe('E4 deterministic ordering', () => {
  it('sorts legacy lists and respects saved positions', () => {
    expect(orderLists([record('b', 2), record('a', 1)]).map(x => x.id)).toEqual(['a', 'b'])
    expect(orderLists([record('a', 1, 1), record('b', 2, 0)]).map(x => x.id)).toEqual(['b', 'a'])
  })
  it('moves one list and keeps the order after reloading records', () => {
    const next = moveList([record('a', 1), record('b', 2), record('c', 3)], 'b', -1)
    expect(orderLists([...next].reverse()).map(x => x.id)).toEqual(['b', 'a', 'c'])
    expect(moveList(next, 'b', -1)).toEqual(next)
  })
  it('sorts archives by completion time and stable id tie-break', () => {
    expect(orderArchives([archive('old', 1), archive('z', 3), archive('a', 3)]).map(x => x.id))
      .toEqual(['a', 'z', 'old'])
  })
})
