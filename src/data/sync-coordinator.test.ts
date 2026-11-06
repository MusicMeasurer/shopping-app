import { describe, expect, it, vi } from 'vitest'
import type { Item } from '../domain/shopping'
import type { PendingItemOperation } from './pending-operations'
import { createSyncCoordinator, type SyncDependencies } from './sync-coordinator'

const accountId = 'user-a'
const listId = '123e4567-e89b-42d3-a456-426614174000'
const itemId = '223e4567-e89b-42d3-a456-426614174001'
const operationId = '323e4567-e89b-42d3-a456-426614174002'
const item: Item = { id: itemId, listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1000 }
function setup() {
  let active = true
  let pending: PendingItemOperation[] = [{ kind: 'upsert', operationId, item }]
  const readLocal = vi.fn(async () => [item])
  const readPending = vi.fn(async () => [...pending])
  const acknowledge = vi.fn(async (id: string) => { pending = pending.filter(op => op.operationId !== id) })
  const fetch = vi.fn(async () => [{
    id: itemId, listId, name: 'Молоко', purchased: false,
    createdAt: '2026-11-06T05:00:00Z', version: 1,
  }])
  const send = vi.fn(async () => ({ operationId, listRevision: 1, itemVersion: 1 }))
  const dependencies: SyncDependencies = {
    accountId, listId, isActive: () => active,
    readLocal, readPending, acknowledge, fetch, send,
    resolveMutation: operation => ({
      kind: 'add', operationId: operation.operationId, listId,
      itemId: operation.kind === 'delete' ? operation.itemId : operation.item.id,
      name: 'Молоко', purchased: false,
    }),
  }
  return { dependencies, readLocal, readPending, acknowledge, fetch, send, deactivate: () => { active = false }, get pending() { return pending } }
}
describe('headless sync coordinator', () => {
  it('previews conflicts without modifying local storage or acknowledging pending changes', async () => {
    const test = setup()
    const coordinator = createSyncCoordinator(test.dependencies, () => 'groceries')
    const result = await coordinator.preview()
    expect(result.pendingCount).toBe(1)
    expect(result.conflicts).toEqual([itemId])
    expect(test.acknowledge).not.toHaveBeenCalled()
    expect(test.send).not.toHaveBeenCalled()
  })
  it('flushes a confirmed operation and then acknowledges it', async () => {
    const test = setup()
    const coordinator = createSyncCoordinator(test.dependencies, () => 'groceries')
    expect(await coordinator.flush()).toBe(1)
    expect(test.pending).toEqual([])
    expect(test.send).toHaveBeenCalledTimes(1)
    expect(test.acknowledge).toHaveBeenCalledWith(operationId)
  })
  it('does not send when the account has changed', async () => {
    const test = setup()
    test.deactivate()
    const coordinator = createSyncCoordinator(test.dependencies, () => 'groceries')
    await expect(coordinator.flush()).rejects.toThrow('Account changed')
    expect(test.send).not.toHaveBeenCalled()
  })
  it('does not acknowledge failed server operations', async () => {
    const test = setup()
    test.send.mockRejectedValueOnce(new Error('Version conflict'))
    const coordinator = createSyncCoordinator(test.dependencies, () => 'groceries')
    await expect(coordinator.flush()).rejects.toThrow('Version conflict')
    expect(test.pending).toHaveLength(1)
    expect(test.acknowledge).not.toHaveBeenCalled()
  })
})
