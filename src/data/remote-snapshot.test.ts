import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchRemoteItems } from './remote-snapshot'

const listId = '123e4567-e89b-42d3-a456-426614174000'
const row = {
  id: '223e4567-e89b-42d3-a456-426614174001',
  list_id: listId, name: 'Молоко', purchased: false,
  created_at: '2026-11-06T05:00:00Z', version: 1,
}

function fakeClient(data: unknown, error: unknown = null) {
  const order = vi.fn(async () => ({ data, error }))
  const is = vi.fn(() => ({ order }))
  const eq = vi.fn(() => ({ is }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as Pick<SupabaseClient, 'from'>, from, select, eq, is, order }
}

describe('read-only remote snapshot', () => {
  it('requests only active items from the selected list', async () => {
    const fake = fakeClient([row])
    expect(await fetchRemoteItems(fake.client, listId)).toEqual([{
      id: row.id, listId, name: 'Молоко', purchased: false,
      createdAt: row.created_at, version: 1,
    }])
    expect(fake.from).toHaveBeenCalledWith('shopping_items')
    expect(fake.eq).toHaveBeenCalledWith('list_id', listId)
    expect(fake.is).toHaveBeenCalledWith('deleted_at', null)
  })
  it('rejects malformed IDs without making a request', async () => {
    const fake = fakeClient([])
    await expect(fetchRemoteItems(fake.client, 'groceries')).rejects.toThrow('Invalid remote list ID')
    expect(fake.from).not.toHaveBeenCalled()
  })
  it('never treats a failed request as an empty list', async () => {
    const fake = fakeClient(null, { message: 'offline' })
    await expect(fetchRemoteItems(fake.client, listId)).rejects.toMatchObject({ message: 'offline' })
  })
  it('rejects data belonging to another list', async () => {
    const fake = fakeClient([{ ...row, list_id: '323e4567-e89b-42d3-a456-426614174002' }])
    await expect(fetchRemoteItems(fake.client, listId)).rejects.toThrow('Invalid remote item')
  })
  it('rejects missing or invalid versions', async () => {
    const fake = fakeClient([{ ...row, version: '1' }])
    await expect(fetchRemoteItems(fake.client, listId)).rejects.toThrow('Invalid remote item')
  })
})
