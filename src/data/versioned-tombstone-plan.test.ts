import { describe, expect, it } from 'vitest'
import { planVersionedTombstones } from './versioned-tombstone-plan'
import type { Item } from '../domain/shopping'
import type { RemoteTombstone } from './remote-snapshot'

const listId = '123e4567-e89b-42d3-a456-426614174000'
const item: Item = { id: 'item-1', listId: 'groceries', name: 'Хлеб', purchased: false, createdAt: 1 }
const tombstone: RemoteTombstone = { id: item.id, listId, version: 3, deletedAt: '2026-11-07T00:00:00Z' }
const known = { itemId: item.id, remoteListId: listId, version: 2 }
const plan = (versions = [known], pending: Parameters<typeof planVersionedTombstones>[3] = []) =>
  planVersionedTombstones([item], versions, [tombstone], pending, listId)

describe('version-aware deletion review', () => {
  it('identifies a server deletion when a prior local version is known', () => {
    expect(plan()).toEqual({ confirmedDeletions: [item.id], conflicts: [], unknownVersions: [] })
  })
  it('does not approve deletion when a local operation is pending', () => {
    expect(plan([known], [{ kind: 'upsert', operationId: 'op', item }]))
      .toEqual({ confirmedDeletions: [], conflicts: [item.id], unknownVersions: [] })
  })
  it('requires review when local server version is unknown', () => {
    expect(plan([])).toEqual({ confirmedDeletions: [], conflicts: [], unknownVersions: [item.id] })
  })
  it('rejects version regressions and cross-list versions', () => {
    expect(plan([{ ...known, version: 4 }]).conflicts).toEqual([item.id])
    expect(plan([{ ...known, version: 3 }]).conflicts).toEqual([item.id])
    expect(plan([{ ...known, remoteListId: 'another' }]).conflicts).toEqual([item.id])
  })
  it('rejects a tombstone from a different list', () => {
    expect(() => planVersionedTombstones([item], [known], [{ ...tombstone, listId: 'other' }], [], listId))
      .toThrow('list mismatch')
  })
})
