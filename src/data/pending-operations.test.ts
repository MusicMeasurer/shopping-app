import { describe, expect, it } from 'vitest'
import { acknowledgeOperation, enqueueOperation, type PendingItemOperation } from './pending-operations'
const add: PendingItemOperation = {
  operationId: 'op-1',
  kind: 'upsert',
  item: { id: 'item-1', listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 },
}
const remove: PendingItemOperation = { operationId: 'op-2', kind: 'delete', itemId: 'item-1' }

describe('pending item operations', () => {
  it('preserves ordering of offline edits', () => {
    expect(enqueueOperation(enqueueOperation([], add), remove)).toEqual([add, remove])
  })
  it('deduplicates identical retries', () => {
    expect(enqueueOperation([add], add)).toEqual([add])
  })
  it('rejects reusing an ID with a different payload', () => {
    expect(() => enqueueOperation([add], { ...add, kind: 'delete', itemId: 'other' })).toThrow()
  })
  it('acknowledges only a confirmed operation', () => {
    expect(acknowledgeOperation([add, remove], 'op-1')).toEqual([remove])
  })
  it('retains the queue if an unknown operation is acknowledged', () => {
    expect(acknowledgeOperation([add], 'unknown')).toEqual([add])
  })
})
