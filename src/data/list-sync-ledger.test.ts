import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { ListSyncLedger, type SyncWork } from './list-sync-ledger'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'

const waiting = (id: string, ...listIds: string[]): SyncWork => ({ id, listIds, kind: 'items', phase: 'waiting' })
describe('list sync state is aggregated by actual operation and scoped account', () => {
  it('gives errors priority without blocking independent lists or losing queued newer edits', () => {
    const ledger = new ListSyncLedger()
    const work = [waiting('first', 'a'), waiting('next', 'a'), waiting('other', 'b')]
    ledger.begin('one', 'first', ['a'], 'items')
    expect(ledger.states('one', work, [], 100).get('a')?.state).toBe('running')
    expect(ledger.states('one', work, [], 100).get('b')?.state).toBe('waiting')
    ledger.fail('one', 'first')
    ledger.begin('one', 'other', ['b'], 'items')
    ledger.confirm('one', 'other', ['b'], 100)
    expect(ledger.states('one', work.slice(0, 2), [], 100).get('a')?.state).toBe('error')
    expect(ledger.states('one', work.slice(0, 2), [], 100).get('b')?.state).toBe('success')
    expect(ledger.states('two', [], [], 100).size).toBe(0)
    ledger.begin('one', 'first', ['a'], 'items')
    expect(ledger.states('one', work.slice(0, 2), [], 100).get('a')?.state).toBe('running')
    ledger.confirm('one', 'first', ['a'], 110)
    ledger.reconcile('one', [work[1]])
    expect(ledger.states('one', [work[1]], [], 110).get('a')?.state).toBe('waiting')
    expect(ledger.states('one', [], [], 110).has('a')).toBe(false)
    ledger.confirm('one', 'next', ['a'], 120)
    expect(ledger.states('one', [], [], 5119).get('a')?.state).toBe('success')
    expect(ledger.states('one', [], [], 5120).has('a')).toBe(false)
  })
  it('retains a conflict during unrelated running work, handles both merge participants and ignores stale success timers', () => {
    const ledger = new ListSyncLedger()
    const q: SyncWork[] = [{ id: 'merge', listIds: ['a', 'b'], phase: 'waiting', kind: 'lists' }]
    ledger.begin('one', 'merge', ['a','b'], 'lists')
    expect(ledger.states('one', q, ['a']).get('a')?.state).toBe('error')
    expect(ledger.states('one', q, ['a']).get('b')?.state).toBe('running')
    ledger.confirm('one', 'merge', ['a','b'], 100)
    ledger.begin('one', 'new', ['a'], 'items')
    expect(ledger.states('one', [waiting('new', 'a')], [], 5100).get('a')?.state).toBe('running')
    expect(ledger.states('one', [], [], 5100).has('b')).toBe(false)
    ledger.fail('one', 'new')
    ledger.reconcile('one', [])
    expect(ledger.states('one', [], []).has('a')).toBe(false)
  })
  it('reads durable queue after restart and creates success only after committing its matching receipt', async () => {
    const name = crypto.randomUUID(), account = crypto.randomUUID(), list = crypto.randomUUID(), other = crypto.randomUUID()
    const storage = createStorage(name)
    await storage.bindAccountList(account, list, list)
    const item = createItem(list, 'Milk')
    const operation = { kind: 'cloud-add' as const, operationId: crypto.randomUUID(), localListId: list,
      remoteListId: list, itemId: item.id, item }
    await storage.saveAccountEdit(account, operation)
    expect(await storage.readListSyncWork(account)).toEqual([waiting(operation.operationId, list)])
    expect(await storage.readListSyncWork(other)).toEqual([])
    await storage.close()
    const reopened = createStorage(name)
    const queue = await reopened.readListSyncWork(account)
    expect(reopened.listSyncLedger.states(account, queue, []).get(list)?.state).toBe('waiting')
    await reopened.claimAccountPending(account, operation.operationId)
    reopened.listSyncLedger.begin(account, operation.operationId, [list], 'items')
    expect(reopened.listSyncLedger.states(account, queue, []).get(list)?.state).toBe('running')
    await reopened.commitAccountReceipt(account, operation.operationId, list, item.id, 1)
    expect(await reopened.readListSyncWork(account)).toEqual([])
    expect(reopened.listSyncLedger.states(account, [], []).get(list)?.state).toBe('success')
    await reopened.close()
  })
  it('does not mark an empty feed or repeated unchanged revision successful', async () => {
    const storage = createStorage(crypto.randomUUID()), account = crypto.randomUUID(), list = crypto.randomUUID()
    const metadata = { id: list, ownerId: account, name: 'A', kind: 'permanent' as const, position: 0, revision: 1 }
    await storage.applyAccountFeed(account, undefined, '1', [{ entity: 'list', listId: list, metadata }], true, () => true)
    expect(storage.listSyncLedger.states(account, [], []).get(list)?.state).toBe('success')
    storage.listSyncLedger.reset(account)
    await storage.applyAccountFeed(account, '1', '1', [], false, () => true)
    await storage.applyAccountFeed(account, '1', '2', [{ entity: 'list', listId: list, metadata }], false, () => true)
    expect(storage.listSyncLedger.states(account, [], []).size).toBe(0)
    await storage.applyAccountFeed(account, '2', '3', [{ entity: 'list', listId: list, metadata: { ...metadata, name: 'B', revision: 2 } }], false, () => true)
    expect(storage.listSyncLedger.states(account, [], []).get(list)?.state).toBe('success')
    await storage.close()
  })
})
