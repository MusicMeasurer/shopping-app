import { describe, expect, it } from 'vitest'
import { resolveVersionedMutation } from './versioned-mutation'
import type { Item } from '../domain/shopping'
const item: Item = { id: 'item', listId: 'groceries', name: 'Молоко', purchased: true, createdAt: 1 }
const base = { operationId: 'op', localListId: 'groceries' as const, remoteListId: 'remote', itemId: 'item' }
describe('versioned mutation conversion', () => {
  it('keeps remote list ID and expected version for updates', () => {
    expect(resolveVersionedMutation({ ...base, kind: 'cloud-update', expectedVersion: 3, item })).toEqual({
      kind: 'update', operationId: 'op', listId: 'remote', itemId: 'item',
      expectedVersion: 3, name: 'Молоко', purchased: true,
    })
  })
  it('keeps remote list ID and expected version for deletes', () => {
    expect(resolveVersionedMutation({ ...base, kind: 'cloud-delete', expectedVersion: 4 })).toEqual({
      kind: 'delete', operationId: 'op', listId: 'remote', itemId: 'item', expectedVersion: 4,
    })
  })
  it('refuses previously queued E4 quantity/unit edits without losing operation identity', () => {
    const extended = { ...item, quantity: 2, unit: 'кг' }
    expect(() => resolveVersionedMutation({ ...base, kind: 'cloud-add', item: extended }))
      .toThrow('Queued E4 quantity/unit edit')
    expect(() => resolveVersionedMutation({ ...base, kind: 'cloud-update', expectedVersion: 1, item: extended }))
      .toThrow('Queued E4 quantity/unit edit')
  })
  it('refuses ambiguous legacy operations', () => {
    expect(() => resolveVersionedMutation({ kind: 'upsert', operationId: 'old', item })).toThrow('Legacy operation')
    expect(() => resolveVersionedMutation({ kind: 'delete', operationId: 'old', itemId: 'item' })).toThrow('Legacy operation')
  })
})
