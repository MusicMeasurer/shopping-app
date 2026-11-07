import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchOwnedCloudLists } from './owned-cloud-lists'

const account = '123e4567-e89b-42d3-a456-426614174000'
const list = '223e4567-e89b-42d3-a456-426614174001'
function setup(rows: unknown, error: unknown = null) {
  const order = vi.fn(async () => ({ data: rows, error }))
  const is = vi.fn(() => ({ order }))
  const eq = vi.fn(() => ({ is }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as Pick<SupabaseClient, 'from'>, from, select, eq, is, order }
}
describe('owned cloud list discovery', () => {
  it('queries only active lists belonging to the verified account', async () => {
    const test = setup([{ id: list, owner_id: account, name: 'Продукты' }])
    expect(await fetchOwnedCloudLists(test.client, account)).toEqual([{ id: list, name: 'Продукты' }])
    expect(test.from).toHaveBeenCalledWith('shopping_lists')
    expect(test.select).toHaveBeenCalledWith('id,owner_id,name')
    expect(test.eq).toHaveBeenCalledWith('owner_id', account)
    expect(test.is).toHaveBeenCalledWith('deleted_at', null)
    expect(test.order).toHaveBeenCalledWith('created_at', { ascending: true })
  })
  it('rejects foreign rows instead of binding them to local lists', async () => {
    const test = setup([{ id: list, owner_id: crypto.randomUUID(), name: 'Продукты' }])
    await expect(fetchOwnedCloudLists(test.client, account)).rejects.toThrow('Invalid')
  })
  it('rejects duplicate list IDs and malformed data', async () => {
    const test = setup([{ id: list, owner_id: account, name: 'A' }, { id: list, owner_id: account, name: 'B' }])
    await expect(fetchOwnedCloudLists(test.client, account)).rejects.toThrow('duplicate')
  })
  it('fails closed before requesting data for an invalid identity', async () => {
    const test = setup([])
    await expect(fetchOwnedCloudLists(test.client, 'guest')).rejects.toThrow('Verified')
    expect(test.from).not.toHaveBeenCalled()
  })
  it('propagates server errors without returning a misleading empty list', async () => {
    const test = setup(null, new Error('Network unavailable'))
    await expect(fetchOwnedCloudLists(test.client, account)).rejects.toThrow('Network unavailable')
  })
})
