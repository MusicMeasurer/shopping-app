import { describe, expect, it } from 'vitest'
import { reconcileItems } from './reconcile'
import type { Item } from '../domain/shopping'

const milk: Item = { id: 'a', listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 }
const soap: Item = { id: 'b', listId: 'household', name: 'Мыло', purchased: false, createdAt: 2 }

describe('offline/cloud reconciliation', () => {
  it('keeps independent offline and cloud additions', () => {
    const result = reconcileItems([milk], [soap])
    expect(result.merged).toEqual([milk, soap])
    expect(result.conflicts).toEqual([])
  })
  it('does not duplicate identical records', () => {
    expect(reconcileItems([milk], [{ ...milk }]).merged).toEqual([milk])
  })
  it('preserves local item and exposes competing edits for resolution', () => {
    const changed = { ...milk, purchased: true }
    const result = reconcileItems([milk], [changed])
    expect(result.merged).toEqual([milk])
    expect(result.conflicts).toEqual([{ local: milk, remote: changed }])
  })
  it('retains remote-only records when local storage is empty', () => {
    expect(reconcileItems([], [soap])).toEqual({ merged: [soap], conflicts: [] })
  })
})
