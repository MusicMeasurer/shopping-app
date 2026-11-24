import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSyncEventBatch, type SyncEvent, type SyncEventBatch } from './sync-event-feed'
import { accumulateSyncEvidence, chooseFallbackList, resolveContextFate, type ActiveSyncContext,
  type ReconciledSyncContext } from './sync-event-fate'

const uid = (n: number) => '41000000-0000-4000-8000-' + String(n).padStart(12, '0')
const account = uid(1), foreign = uid(2), a = uid(101), b = uid(102), c = uid(103), item = uid(201)
const op = uid(301), op2 = uid(302), op3 = uid(303)
const timestamp = '2026-11-22T00:00:00Z'
const row = (listId: string, name: string, stamp = timestamp) => ({
  id: listId, owner_id: account, name, kind: 'permanent', position: 0, revision: 1, updated_at: stamp,
})
const live = (p: number, listId = a) => ({ event_position: String(p), entity: 'list', list_id: listId,
  entity_id: listId, deleted: false, snapshot: row(listId, 'Live') })
const removed = (p: number, listId: string, semantics?: object) => ({ event_position: String(p),
  entity: 'list', list_id: listId, entity_id: listId, deleted: true, snapshot: null,
  ...(semantics ? { semantics } : {}) })
const merged = (target: string, operation = op) => ({ operation_id: operation, event_reason: 'merged',
  source_name: 'Source', target_list_id: target, target_list_name: 'Historical' })
const deleted = { operation_id: op2, event_reason: 'deleted', source_name: 'Target' }
const page = (head: number, through: number, events: unknown[]) => ({ data: {
  head: String(head), through: String(through), events,
}, error: null })
const snapshot = (p: number) => ({ data: { position: String(p), lists: [row(c, 'C')], items: [] }, error: null })
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as SupabaseClient)
const active = () => true

describe('bounded semantic feed', () => {
  it('reads one normal page with no extra request and parses existing server update time', async () => {
    const rpc = vi.fn().mockResolvedValue(page(1, 1, [live(1)]))
    const onRequest = vi.fn()
    const result = await readSyncEventBatch(client(rpc), account, '0', active, onRequest)
    expect(result).toMatchObject({ kind: 'delta', from: '0', through: '1', head: '1',
      events: [{ position: '1', change: { metadata: { updatedAt: Date.parse(timestamp) } } }] })
    expect(rpc.mock.calls).toEqual([['pull_e4_account_changes_v2', { p_account: account, p_after: '0', p_limit: 200 }]])
    expect(onRequest).toHaveBeenCalledTimes(1)
  })
  it('stops at the fixed bound even when head advances on the next page', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(page(201, 201, Array.from({ length: 200 }, (_, i) => live(i + 1))))
      .mockResolvedValueOnce(page(202, 201, [removed(201, a, merged(b))]))
    const batch = await readSyncEventBatch(client(rpc), account, '0', active)
    expect(batch).toMatchObject({ kind: 'delta', through: '201', head: '202' })
    expect(rpc.mock.calls[1][1]).toEqual({ p_account: account, p_after: '200', p_limit: 200, p_through: '201' })
    expect(rpc).toHaveBeenCalledTimes(2)
    if (batch.kind !== 'delta') throw new Error('Expected delta')
    expect(accumulateSyncEvidence(undefined, batch).caughtUp).toBe(false)
  })
  it('does not make an empty trailing request at exactly 200 entries', async () => {
    const rpc = vi.fn().mockResolvedValue(page(200, 200, Array.from({ length: 200 }, (_, i) => live(i + 1))))
    await readSyncEventBatch(client(rpc), account, '0', active)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('accepts an empty poll at the saved head', async () => {
    const rpc = vi.fn().mockResolvedValue(page(12, 12, []))
    expect(await readSyncEventBatch(client(rpc), account, '12', active)).toMatchObject({ through: '12', events: [] })
  })
  it('falls back to a fresh snapshot without inventing history on expired position', async () => {
    const rpc = vi.fn().mockResolvedValueOnce(page(201, 201, Array.from({ length: 200 }, (_, i) => live(i + 1))))
      .mockResolvedValueOnce({ error: { code: 'P0002' } }).mockResolvedValueOnce(snapshot(300))
    expect(await readSyncEventBatch(client(rpc), account, '0', active)).toMatchObject({ kind: 'snapshot', position: '300' })
    expect(rpc.mock.calls[2][0]).toBe('snapshot_e4_account_changes')
  })
  it('reports unsupported RPC only before any v2 page and never confuses denial with fallback', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { code: 'PGRST202' } })
      .mockResolvedValueOnce({ error: { code: '42501' } })
    expect(await readSyncEventBatch(client(rpc), account, '0', active)).toEqual({ kind: 'unsupported', accountId: account })
    await expect(readSyncEventBatch(client(rpc), account, '0', active)).rejects.toMatchObject({ code: '42501' })
  })
  it('rejects gaps, short incomplete pages, changed bounds and malformed semantics', async () => {
    for (const response of [
      page(2, 2, [live(2)]), page(2, 2, [live(1)]), page(3, 2, [live(1), live(2)]),
      page(1, 1, [removed(1, a, merged(a))]),
      page(1, 1, [{ ...live(1), semantics: deleted }]),
      page(1, 1, [removed(1, a, { ...deleted, event_reason: 'archived' })]),
      page(1, 1, [{ ...removed(1, a), snapshot: row(a, 'Not allowed') }]),
      page(1, 1, [{ ...live(1), snapshot: { ...row(a, 'Foreign'), owner_id: foreign } }]),
    ]) {
      const rpc = vi.fn().mockResolvedValue(response)
      await expect(readSyncEventBatch(client(rpc), account, '0', active)).rejects.toThrow()
    }
  })
  it('rejects interrupted and account-switched batches rather than returning partial evidence', async () => {
    const first = page(201, 201, Array.from({ length: 200 }, (_, i) => live(i + 1)))
    const rpc = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Network lost'))
    await expect(readSyncEventBatch(client(rpc), account, '0', active)).rejects.toThrow('Network lost')
    let current = true
    const switched = vi.fn().mockImplementation(async () => { current = false; return page(1, 1, [live(1)]) })
    await expect(readSyncEventBatch(client(switched), account, '0', () => current)).rejects.toThrow('Account changed')
  })
  it('uses snapshot for new accounts with one request', async () => {
    const rpc = vi.fn().mockResolvedValue(snapshot(7))
    expect(await readSyncEventBatch(client(rpc), account, undefined, active)).toMatchObject({ kind: 'snapshot', position: '7' })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})

const rem = (p: number, listId: string, reason?: SyncEvent['semantics']): SyncEvent => ({
  position: String(p), change: { entity: 'list', listId, metadata: null }, ...(reason ? { semantics: reason } : {}),
})
const merge = (targetListId: string, operationId = op): NonNullable<SyncEvent['semantics']> => ({
  operationId, reason: 'merged', sourceName: 'Source', targetListId, targetListName: 'Historical',
})
const remove = (reason: 'deleted' | 'completed' | 'archived' = 'deleted', operationId = op2): NonNullable<SyncEvent['semantics']> => ({
  reason, operationId, sourceName: 'Removed',
})
const batch = (from: number, through: number, head: number, events: SyncEvent[]): Extract<SyncEventBatch, { kind: 'delta' }> => ({
  kind: 'delta', accountId: account, from: String(from), through: String(through), head: String(head), events,
})
const context: ActiveSyncContext = { accountId: account, listId: a }
const state = (lists: ReconciledSyncContext['lists'], extra: Partial<ReconciledSyncContext> = {}): ReconciledSyncContext => ({
  accountId: account, ready: true, lists, items: [], activity: [], ...extra,
})
const evidence = (events: SyncEvent[], head = events.length) => accumulateSyncEvidence(undefined, batch(0, events.length, head, events))
const listB = { id: b, name: 'Latest B', updatedAt: 20 }, listC = { id: c, name: 'Latest C', updatedAt: 30 }

describe('final context fate', () => {
  it('activates the actual merge target with its latest name and no reset', () => {
    expect(resolveContextFate(context, state([listB, listC]), evidence([rem(1, a, merge(b))]))).toMatchObject({
      kind: 'merge', nextListId: b, resetViewport: false, notice: { reason: 'merged', targetListId: b, targetListName: 'Latest B' },
    })
  })
  it('collapses merge then delete to one deletion of original source', () => {
    expect(resolveContextFate(context, state([listC]), evidence([rem(1, a, merge(b)), rem(2, b, remove())]))).toMatchObject({
      kind: 'recover', nextListId: c, resetViewport: true, notice: { sourceId: a, operationId: op2, reason: 'deleted' },
    })
  })
  it('collapses a chain to the final surviving recipient', () => {
    expect(resolveContextFate(context, state([listC]), evidence([rem(1, a, merge(b)), rem(2, b, merge(c, op2))]))).toMatchObject({
      kind: 'merge', nextListId: c, notice: { sourceId: a, targetListId: c, targetListName: 'Latest C', operationId: op2 },
    })
  })
  it('defers a masked or incomplete batch until later history arrives', () => {
    const first = evidence([rem(1, a, merge(b))], 2)
    expect(resolveContextFate(context, state([listC]), first)).toEqual({ kind: 'wait' })
    const next = accumulateSyncEvidence(first, batch(1, 2, 2, [rem(2, b, remove())]))
    expect(resolveContextFate(context, state([listC]), next)).toMatchObject({ notice: { reason: 'deleted' } })
    expect(accumulateSyncEvidence(next, batch(1, 2, 2, [rem(2, b, remove())]))).toBe(next)
  })
  it('evaluates a later change from the recipient of an already presented merge', () => {
    const first = resolveContextFate(context, state([listB]), evidence([rem(1, a, merge(b))]))
    const next = resolveContextFate({ accountId: account, listId: b }, state([listC]), evidence([rem(1, b, remove())]))
    expect(first).toMatchObject({ notice: { reason: 'merged', targetListId: b } })
    expect(next).toMatchObject({ notice: { sourceId: b, reason: 'deleted' }, nextListId: c })
  })
  it('recovers silently with missing/expired semantics or unavailable target with no known cause', () => {
    for (const e of [evidence([rem(1, a)]), evidence([rem(1, a, merge(b))]),
      accumulateSyncEvidence(evidence([rem(1, a, merge(b))]), { kind: 'snapshot', accountId: account, position: '3', changes: [] })]) {
      expect(resolveContextFate(context, state([listC]), e)).toEqual({ kind: 'recover', nextListId: c, resetViewport: true })
    }
  })
  it('does not guess a cyclic or out-of-order chain', () => {
    for (const e of [evidence([rem(1, a, merge(b)), rem(2, b, merge(a, op2))]),
      evidence([rem(1, b, remove()), rem(2, a, merge(b))])]) {
      expect(resolveContextFate(context, state([listC]), e)).toEqual({ kind: 'recover', nextListId: c, resetViewport: true })
    }
  })
  it('keeps current list and editing context when the active item still exists', () => {
    expect(resolveContextFate({ ...context, itemId: item }, state([{ id: a, name: 'A' }, listC],
      { items: [{ id: item, listId: a }] }), evidence([rem(1, b, remove())]))).toEqual({ kind: 'unchanged' })
  })
  it('reports the exact item removal reason and keeps the surviving list', () => {
    for (const reason of ['deleted', 'completed', 'archived'] as const) {
      const e: SyncEvent = { position: '1', change: { entity: 'item', listId: a, itemId: item, item: null },
        semantics: remove(reason, op3) }
      expect(resolveContextFate({ ...context, itemId: item }, state([{ id: a, name: 'A' }, listC]), evidence([e]))).toMatchObject({
        kind: 'recover', nextListId: a, resetViewport: true, notice: { reason, entity: 'item', sourceId: item },
      })
    }
  })
  it('waits for deferred/local pending reconciliation, suppresses own operation notice', () => {
    const e = evidence([rem(1, a, remove())])
    expect(resolveContextFate(context, state([listC], { ready: false }), e)).toEqual({ kind: 'wait' })
    expect(resolveContextFate(context, state([listC]), e, new Set([op2]))).toEqual({ kind: 'recover', nextListId: c, resetViewport: true })
  })
  it('rejects other accounts and overlapping evidence', () => {
    const e = evidence([rem(1, a, remove())])
    expect(() => resolveContextFate(context, state([listC], { accountId: foreign }), e)).toThrow('Foreign')
    expect(() => accumulateSyncEvidence(e, { ...batch(1, 2, 2, []), accountId: foreign })).toThrow('Foreign')
    expect(() => accumulateSyncEvidence(e, batch(0, 2, 2, []))).toThrow('Non-contiguous')
  })
  it('prefers activity history, then last modified, deterministic tie, and empty creation context', () => {
    expect(chooseFallbackList([listB, listC], [a, b])).toBe(b)
    expect(chooseFallbackList([listB, listC], [a])).toBe(c)
    expect(chooseFallbackList([{ ...listC, updatedAt: 20 }, listB], [])).toBe(b)
    expect(chooseFallbackList([{ id: b, name: 'unknown' }, listC], [])).toBe(c)
    expect(resolveContextFate(context, state([]), evidence([rem(1, a, remove())]))).toMatchObject({
      kind: 'recover', nextListId: null, resetViewport: true,
    })
  })
})
