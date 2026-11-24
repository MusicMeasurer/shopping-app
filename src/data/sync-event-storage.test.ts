import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStorage } from './storage'
import { pullSemanticAccountFeed } from './sync-event-runtime'
import { noticeKey } from './sync-event-state'
const uid = (n: number) => '51000000-0000-4000-8000-' + String(n).padStart(12, '0')
const account = uid(1), foreign = uid(2), a = uid(101), b = uid(102), c = uid(103), item = uid(201), op = uid(301), op2 = uid(302)
const date = '2026-11-24T12:00:00Z'
const list = (id: string, updated_at = date) => ({ id, owner_id: account, name: id === a ? 'A' : id === b ? 'B' : 'C',
  position: 0, revision: 1, kind: 'permanent', updated_at })
const initial = { data: { position: '10', lists: [list(a), list(b), list(c, '2026-11-24T13:00:00Z')],
  items: [{ id: item, list_id: a, name: 'Tea', purchased: false, version: 1, created_at: date }] }, error: null }
const rem = (p: number, id: string, target?: string, operation = op) => ({
  event_position: String(p), list_id: id, entity_id: id, entity: 'list', deleted: true, snapshot: null,
  semantics: { operation_id: operation, event_reason: target ? 'merged' : 'deleted', source_name: id === a ? 'A' : 'B',
    ...(target ? { target_list_id: target, target_list_name: 'B' } : {}) },
})
const page = (through: number, events: unknown[], head = through) => ({ data: { head: String(head), through: String(through), events }, error: null })
const active = () => true
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc } as unknown as SupabaseClient)
async function setup() {
  const db = crypto.randomUUID(), storage = createStorage(db)
  const rpc = vi.fn().mockResolvedValueOnce(initial)
  const api = client(rpc)
  await pullSemanticAccountFeed(api, storage, account, active)
  await storage.recordAccountSyncContext(account, a)
  return { db, storage, rpc, api }
}
describe('durable semantic synchronization', () => {
  it('persists data, cursor and notice atomically; freezes presented merge and follows with deletion after restart', async () => {
    const { db, storage, rpc, api } = await setup()
    rpc.mockResolvedValueOnce(page(11, [rem(11, a, b)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect(await storage.readAccountFeedPosition(account)).toBe('11')
    expect((await storage.readAccountFeedLists(account)).map(row => row.id)).not.toContain(a)
    const first = (await storage.readAccountSemanticState(account))!
    const key = noticeKey(first.pending!)!
    await storage.presentAccountSyncNotice(account, key)
    await storage.close()
    const reopened = createStorage(db)
    expect((await reopened.readAccountSemanticState(account))?.presented?.fate.notice?.targetListId).toBe(b)
    rpc.mockResolvedValueOnce(page(12, [rem(12, b, undefined, op2)]))
    await pullSemanticAccountFeed(api, reopened, account, active)
    const second = (await reopened.readAccountSemanticState(account))!
    expect(second.presented).toEqual(first.pending)
    expect(second.pending?.fate.notice).toMatchObject({ sourceId: b, reason: 'deleted' })
    expect(await reopened.acknowledgeAccountSyncNotice(account, key)).toEqual({ kind: 'next-notice' })
    expect(await reopened.acknowledgeAccountSyncNotice(account, key)).toEqual({ kind: 'ignored' })
    const nextKey = noticeKey((await reopened.readAccountSemanticState(account))!.pending!)!
    await reopened.presentAccountSyncNotice(account, nextKey)
    expect(await reopened.acknowledgeAccountSyncNotice(account, nextKey)).toEqual({ kind: 'navigate', nextListId: c, resetViewport: true })
    expect(await reopened.acknowledgeAccountSyncNotice(account, nextKey)).toEqual({ kind: 'ignored' })
    await reopened.close()
  })
  it('collapses before presentation across bounded batches and preserves pending on automatic context capture', async () => {
    const { storage, rpc, api } = await setup()
    const filler = Array.from({ length: 200 }, (_, i) => ({ event_position: String(11 + i),
      entity: 'list', entity_id: c, list_id: c, deleted: false, snapshot: list(c, '2026-11-24T13:00:00Z') }))
    rpc.mockResolvedValueOnce(page(211, filler))
      .mockResolvedValueOnce(page(211, [rem(211, a, b)], 212))
      .mockResolvedValueOnce(page(212, [rem(212, b, undefined, op2)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect(rpc).toHaveBeenCalledTimes(4)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate.notice).toMatchObject({ sourceId: a, reason: 'deleted' })
    await storage.recordAccountSyncContext(account, c)
    expect((await storage.readAccountSemanticState(account))?.context?.listId).toBe(a)
    await storage.close()
  })
  it('resumes at the last committed page and does not repeat its requests or publish a premature notice', async () => {
    const { db, storage, rpc, api } = await setup()
    const filler = Array.from({ length: 199 }, (_, i) => ({ event_position: String(12 + i),
      entity: 'list', entity_id: c, list_id: c, deleted: false, snapshot: list(c) }))
    rpc.mockResolvedValueOnce(page(211, [rem(11, a, b), ...filler]))
      .mockRejectedValueOnce(new Error('Interrupted page'))
    await expect(pullSemanticAccountFeed(api, storage, account, active)).rejects.toThrow('Interrupted page')
    expect(await storage.readAccountFeedPosition(account)).toBe('210')
    const partial = (await storage.readAccountSemanticState(account))!
    expect(partial.batchThrough).toBe('211')
    expect(partial.ready).toBe(false)
    expect(partial.pending).toBeUndefined()
    await storage.close()
    const reopened = createStorage(db)
    rpc.mockResolvedValueOnce(page(211, [rem(211, b, undefined, op2)]))
    await pullSemanticAccountFeed(api, reopened, account, active)
    expect(rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_after: '210', p_through: '211' })
    expect((await reopened.readAccountSemanticState(account))?.pending?.fate.notice).toMatchObject({ sourceId: a, reason: 'deleted' })
    await reopened.close()
  })
  it('does not lose a saved notice when the server returns no more history', async () => {
    const { storage, rpc, api } = await setup()
    rpc.mockResolvedValueOnce(page(11, [rem(11, a, b)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    const saved = (await storage.readAccountSemanticState(account))!.pending
    rpc.mockResolvedValueOnce({ error: { code: 'P0002' } })
      .mockResolvedValueOnce({ data: { position: '20', lists: [list(b), list(c)], items: [] }, error: null })
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate.notice).toEqual(saved?.fate.notice)
    await storage.close()
  })
  it('unknown removal restores silently and uses last changed list, never last created', async () => {
    const { storage, rpc, api } = await setup()
    const { semantics: _semantics, ...unknown } = rem(11, a)
    rpc.mockResolvedValueOnce(page(11, [unknown]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate).toEqual({
      kind: 'recover', nextListId: c, resetViewport: true,
    })
    expect(await storage.acknowledgeAccountSyncNotice(account, null)).toEqual({ kind: 'navigate', nextListId: c, resetViewport: true })
    expect(await storage.acknowledgeAccountSyncNotice(account, null)).toEqual({ kind: 'ignored' })
    await storage.close()
  })
  it('uses latest pending list changes for fallback and records draft activity', async () => {
    const { storage } = await setup()
    await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    await storage.ensureVerifiedAccountProfile(account)
    const draft = { id: uid(501), name: 'Draft', symbol: '🛒', kind: 'permanent' as const, createdAt: Date.parse('2026-11-01T00:00:00Z') }
    await storage.saveAccountDraftList(account, draft)
    await storage.recordAccountSyncContext(account, draft.id)
    expect((await storage.readAccountSemanticState(account))?.activity[0]).toBe(draft.id)
    await storage.promoteAccountDraft((await storage.readAccountDraftLists(account))[0], {
      id: uid(502), ownerId: account, name: 'Draft', kind: 'permanent', position: 4,
    })
    expect((await storage.readAccountSemanticState(account))?.activity[0]).toBe(uid(502))
    await storage.close()
    const second = await setup()
    await second.storage.queueLocalListChange(account, b, 'rename', 'B edited')
    second.rpc.mockResolvedValueOnce(page(11, [rem(11, a)]))
    await pullSemanticAccountFeed(second.api, second.storage, account, active)
    expect((await second.storage.readAccountSemanticState(account))?.pending?.fate.nextListId).toBe(b)
    await second.storage.close()
  })
  it('suppresses an operation initiated on this device', async () => {
    const { storage, rpc, api } = await setup()
    await storage.rememberAccountSyncOperation(account, op)
    rpc.mockResolvedValueOnce(page(11, [rem(11, a)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate.notice).toBeUndefined()
    await storage.close()
  })
  it('rolls back both evidence and cursor on account switch and retries', async () => {
    const { storage, rpc, api } = await setup()
    rpc.mockResolvedValueOnce(page(11, [rem(11, a, b)]))
    let checks = 0
    await expect(pullSemanticAccountFeed(api, storage, account, () => ++checks < 5)).rejects.toThrow('Account changed')
    expect(await storage.readAccountFeedPosition(account)).toBe('10')
    expect((await storage.readAccountSemanticState(account))?.pending).toBeUndefined()
    expect((await storage.readAccountFeedLists(account)).map(row => row.id)).toContain(a)
    rpc.mockResolvedValueOnce(page(11, [rem(11, a, b)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate.notice?.targetListId).toBe(b)
    await storage.close()
  })
  it('only falls back for a missing RPC and does not repeat capability probes', async () => {
    const { storage, rpc, api } = await setup()
    rpc.mockResolvedValueOnce({ error: { code: 'PGRST202' } }).mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null })
    await pullSemanticAccountFeed(api, storage, account, active)
    await pullSemanticAccountFeed(api, storage, account, active)
    expect(rpc.mock.calls.map(row => row[0])).toEqual(['snapshot_e4_account_changes', 'pull_e4_account_changes_v2',
      'pull_e4_account_changes', 'pull_e4_account_changes'])
    await storage.close()
  })
  it('hides and purges semantic data when account deletion is confirmed', async () => {
    const { storage, rpc, api } = await setup()
    await storage.migrateLegacyGuestToProfile()
    await storage.markGuestCutoverReady()
    await storage.ensureVerifiedAccountProfile(account)
    await storage.rememberAccountSyncOperation(foreign, op2)
    rpc.mockResolvedValueOnce(page(11, [rem(11, a, b)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    await storage.rememberDeletedAccount(account)
    expect(await storage.readAccountSemanticState(account)).toBeUndefined()
    expect(await storage.presentAccountSyncNotice(account, 'unknown')).toBeUndefined()
    await expect(storage.rememberAccountSyncOperation(account, op)).rejects.toThrow('deleted')
    await storage.purgeDeletedAccount(account)
    expect(await storage.readAccountSemanticState(account)).toBeUndefined()
    expect((await storage.readAccountSemanticState(foreign))?.own[0].id).toBe(op2)
    await storage.close()
  })
  it('preserves the editor item fate and history of active lists', async () => {
    const { storage, rpc, api } = await setup()
    await storage.recordAccountSyncContext(account, b)
    await storage.recordAccountSyncContext(account, a, item)
    rpc.mockResolvedValueOnce(page(11, [{ event_position: '11', list_id: a, entity_id: item, entity: 'item',
      deleted: true, snapshot: null, semantics: { operation_id: op, event_reason: 'archived', source_name: 'Tea' } }]))
    await pullSemanticAccountFeed(api, storage, account, active)
    const pending = (await storage.readAccountSemanticState(account))!.pending!
    expect(pending.fate.notice).toMatchObject({ sourceId: item, reason: 'archived' })
    await storage.presentAccountSyncNotice(account, noticeKey(pending)!)
    expect(await storage.acknowledgeAccountSyncNotice(account, noticeKey(pending)!)).toEqual({ kind: 'navigate', nextListId: a, resetViewport: true })
    rpc.mockResolvedValueOnce(page(12, [rem(12, a, undefined, op2)]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate).toMatchObject({ nextListId: b })
    await storage.close()
  })
  it('retains deferred event evidence until a pending local edit is reconciled', async () => {
    const { storage, rpc, api } = await setup()
    await storage.recordAccountSyncContext(account, a, item)
    const [current] = await storage.readAccountItems(account)
    await storage.saveAccountEdit(account, { kind: 'cloud-update', localListId: a, remoteListId: a,
      operationId: op2, itemId: item, expectedVersion: 1, item: { ...current, purchased: true } })
    rpc.mockResolvedValueOnce(page(11, [{ event_position: '11', list_id: a, entity_id: item, entity: 'item',
      deleted: true, snapshot: null, semantics: { operation_id: op, event_reason: 'deleted', source_name: 'Tea' } }]))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending).toBeUndefined()
    expect(await storage.readAccountFeedPosition(account)).toBe('11')
    await storage.acknowledgeAccountPending(account, op2)
    rpc.mockResolvedValueOnce(page(11, []))
    await pullSemanticAccountFeed(api, storage, account, active)
    expect((await storage.readAccountSemanticState(account))?.pending?.fate.notice).toMatchObject({ sourceId: item, reason: 'deleted' })
    await storage.close()
  })
})
