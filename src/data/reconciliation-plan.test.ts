import { describe, expect, it } from 'vitest'
import type { Item } from '../domain/shopping'
import { planReconciliation } from './reconciliation-plan'

const a: Item = { id: 'a', listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 }
const b: Item = { id: 'b', listId: 'groceries', name: 'Хлеб', purchased: false, createdAt: 2 }

describe('conservative reconciliation planner', () => {
  it('adds remote-only items without dropping local-only items', () => {
    const result = planReconciliation([a], [b], [])
    expect(result.visible).toEqual([a, b])
    expect(result.remoteOnly).toEqual([b])
    expect(result.conflicts).toEqual([])
  })
  it('preserves offline updates and marks divergent copies', () => {
    const local = { ...a, purchased: true }
    const result = planReconciliation([local], [a], [{ operationId: 'op', kind: 'upsert', item: local }])
    expect(result.visible).toEqual([local])
    expect(result.conflicts).toEqual(['a'])
  })
  it('does not resurrect an item pending deletion', () => {
    const result = planReconciliation([], [a], [{ operationId: 'op', kind: 'delete', itemId: 'a' }])
    expect(result.visible).toEqual([])
    expect(result.conflicts).toEqual(['a'])
  })
  it('does not silently overwrite divergent unversioned copies', () => {
    const result = planReconciliation([{ ...a, name: 'Овсяное молоко' }], [a], [])
    expect(result.visible[0].name).toBe('Овсяное молоко')
    expect(result.conflicts).toEqual(['a'])
  })
  it('rejects duplicate IDs', () => {
    expect(() => planReconciliation([a, a], [], [])).toThrow('Duplicate item IDs')
  })
})
