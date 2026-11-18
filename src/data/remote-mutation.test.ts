import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyRemoteMutation } from './remote-mutation'

const operationId = '123e4567-e89b-42d3-a456-426614174000'
const listId = '223e4567-e89b-42d3-a456-426614174001'
const itemId = '323e4567-e89b-42d3-a456-426614174002'
function fakeClient(data: unknown = { operation_id: operationId, list_revision: 4, item_version: 2 }, error: unknown = null) {
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data, error }))
  return { client: { rpc } as unknown as Pick<SupabaseClient, 'rpc'>, rpc }
}
describe('remote mutation adapter', () => {
  it('sends a stable add operation and validates the server receipt', async () => {
    const fake = fakeClient()
    const mutation = { kind: 'add' as const, operationId, listId, itemId, name: 'Молоко', purchased: false }
    expect(await applyRemoteMutation(fake.client, mutation)).toEqual({
      operationId, listRevision: 4, itemVersion: 2,
    })
    expect(fake.rpc).toHaveBeenCalledWith('apply_item_change', {
      p_operation: operationId, p_list: listId, p_action: 'add',
      p_item: itemId, p_name: 'Молоко', p_purchased: false, p_expected_version: null,
    })
  })
  it('includes the expected version for an update', async () => {
    const fake = fakeClient()
    await applyRemoteMutation(fake.client, {
      kind: 'update', operationId, listId, itemId, expectedVersion: 2, purchased: true,
    })
    expect(fake.rpc).toHaveBeenCalledWith('apply_item_change', expect.objectContaining({ p_action: 'update', p_expected_version: 2, p_purchased: true }))
  })
  it('uses the E4 RPC for explicit attribute clears', async () => {
    const fake = fakeClient()
    await applyRemoteMutation(fake.client, {
      kind: 'update', operationId, listId, itemId, expectedVersion: 2,
      attributes: { quantity: null, unit: null },
    })
    expect(fake.rpc).toHaveBeenCalledWith('apply_e4_item_change', expect.objectContaining({
      p_expected_version: 2, p_quantity: null, p_unit: null,
    }))
  })
  it('never issues an unversioned delete', async () => {
    const fake = fakeClient()
    await expect(applyRemoteMutation(fake.client, {
      kind: 'delete', operationId, listId, itemId, expectedVersion: -1,
    })).rejects.toThrow('Missing valid expected version')
    expect(fake.rpc).not.toHaveBeenCalled()
  })
  it('propagates a version conflict instead of silently retrying', async () => {
    const fake = fakeClient(null, { message: 'Version conflict' })
    await expect(applyRemoteMutation(fake.client, {
      kind: 'delete', operationId, listId, itemId, expectedVersion: 1,
    })).rejects.toMatchObject({ message: 'Version conflict' })
    expect(fake.rpc).toHaveBeenCalledTimes(1)
  })
  it('rejects a receipt for a different operation', async () => {
    const fake = fakeClient({ operation_id: itemId, list_revision: 4, item_version: 2 })
    await expect(applyRemoteMutation(fake.client, {
      kind: 'add', operationId, listId, itemId, name: 'Хлеб', purchased: false,
    })).rejects.toThrow('Invalid mutation receipt')
  })
})

it('uploads the creation time of a new batch without changing retry semantics', async () => {
  const mutation = { kind: 'add' as const, operationId, listId, itemId, name: 'Рис', purchased: false, createdAt: 123 }
  const olderServer = fakeClient()
  olderServer.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
  await applyRemoteMutation(olderServer.client, mutation)
  expect(olderServer.rpc.mock.calls.map(call => call[0])).toEqual(['add_e4_ordered_item', 'apply_e4_item_change'])
  expect(olderServer.rpc).toHaveBeenNthCalledWith(1, 'add_e4_ordered_item', expect.objectContaining({
    p_created_at: '1970-01-01T00:00:00.123Z',
  }))

  const ambiguousFailure = fakeClient(null, { code: '504' })
  await expect(applyRemoteMutation(ambiguousFailure.client, mutation)).rejects.toMatchObject({ code: '504' })
  expect(ambiguousFailure.rpc).toHaveBeenCalledTimes(1)
})
