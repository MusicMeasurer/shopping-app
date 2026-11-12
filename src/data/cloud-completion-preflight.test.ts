import { describe, expect, it, vi } from 'vitest'
import { inspectCloudCompletion } from './cloud-completion-preflight'

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const remoteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const localListId = 'groceries' as const
function fixture(options: { pending?: unknown[]; local?: unknown[]; remote?: unknown[]; revision?: number; active?: boolean; mappings?: unknown[] } = {}) {
  const mappings = options.mappings ?? [{ localListId, remoteListId: remoteId }]
  const pending = options.pending ?? []
  const local = options.local ?? [{ id: itemId, listId: localListId, name: 'Молоко', purchased: true }]
  const remote = options.remote ?? [{ id: itemId, list_id: remoteId, name: 'Молоко', purchased: true, created_at: '2026-11-12T12:00:00Z', version: 1 }]
  const revision = options.revision ?? 1
  const storage = {
    readAccountListMappings: vi.fn().mockResolvedValue(mappings),
    readAccountPending: vi.fn().mockResolvedValue(pending),
    readAccountItems: vi.fn().mockResolvedValue(local),
  }
  const from = vi.fn((table: string) => {
    if (table === 'shopping_items') return {
      select: () => ({ eq: () => ({ is: () => ({ order: async () => ({ data: remote, error: null }) }) }) }),
    }
    return {
      select: () => ({ eq: () => ({ eq: () => ({ is: async () => ({
        data: [{ id: remoteId, owner_id: account, revision, deleted_at: null }], error: null,
      }) }) }) }),
    }
  })
  return { storage, client: { from }, isActive: () => options.active !== false, from }
}
const check = (f: ReturnType<typeof fixture>) => inspectCloudCompletion(
  f.storage as never, f.client as never, account, localListId, remoteId, f.isActive)

describe('E4 completion preflight', () => {
  it('accepts a fully reconciled cloud list without pending writes', async () => {
    expect(await check(fixture())).toEqual({ ready: true, reason: '', revision: 1 })
  })
  it('blocks an unverified mapping before remote reads', async () => {
    const f = fixture({ mappings: [] })
    expect((await check(f)).ready).toBe(false)
    expect(f.from).not.toHaveBeenCalled()
  })
  it('blocks cloud and legacy pending writes', async () => {
    for (const pending of [
      [{ kind: 'cloud-delete', remoteListId: remoteId }],
      [{ kind: 'upsert', item: { listId: localListId } }],
      [{ kind: 'delete', itemId }],
    ]) {
      const f = fixture({ pending })
      expect((await check(f)).ready).toBe(false)
      expect(f.from).not.toHaveBeenCalled()
    }
  })
  it('blocks cloud-only items and divergent purchase flags', async () => {
    expect((await check(fixture({ local: [] }))).ready).toBe(false)
    expect((await check(fixture({ local: [{ id: itemId, listId: localListId, name: 'Молоко', purchased: false }] }))).ready).toBe(false)
  })
  it('blocks an empty server list and account change', async () => {
    expect((await check(fixture({ remote: [] }))).ready).toBe(false)
    const f = fixture({ active: false })
    expect((await check(f)).ready).toBe(false)
    expect(f.from).not.toHaveBeenCalled()
  })
})
