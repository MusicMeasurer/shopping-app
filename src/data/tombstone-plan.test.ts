import { describe, expect, it } from 'vitest'
import { planTombstones } from './tombstone-plan'
import type { Item } from '../domain/shopping'
import type { RemoteTombstone } from './remote-snapshot'

const item: Item = { id: 'item-1', listId: 'groceries', name: 'Хлеб', purchased: false, createdAt: 1 }
const deleted: RemoteTombstone = { id: item.id, listId: 'remote-list', version: 3, deletedAt: '2026-11-07T00:00:00Z' }

describe('read-only tombstone review', () => {
  it('flags locally present server-deleted items without removing them', () => {
    expect(planTombstones([item], [deleted], [])).toEqual({
      localCandidates: [item.id], pendingConflicts: [],
    })
    expect(item.name).toBe('Хлеб')
  })
  it('separates pending edits from deletion candidates', () => {
    expect(planTombstones([item], [deleted], [{ operationId: 'op', kind: 'upsert', item }]))
      .toEqual({ localCandidates: [], pendingConflicts: [item.id] })
  })
  it('ignores tombstones with no local or pending item', () => {
    expect(planTombstones([], [deleted], []))
      .toEqual({ localCandidates: [], pendingConflicts: [] })
  })
  it('rejects duplicate tombstones', () => {
    expect(() => planTombstones([item], [deleted, deleted], [])).toThrow('Duplicate')
  })
})
