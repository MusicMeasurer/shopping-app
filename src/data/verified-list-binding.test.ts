import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import { bindVerifiedOwnedList } from './verified-list-binding'

const account = '123e4567-e89b-42d3-a456-426614174000'
const list = '223e4567-e89b-42d3-a456-426614174001'
function setup(rows: unknown = [{ id: list, owner_id: account, name: 'Продукты' }]) {
  const order = vi.fn(async () => ({ data: rows, error: null }))
  const client = { from: vi.fn(() => ({
    select: () => ({ eq: () => ({ is: () => ({ order }) }) }),
  })) } as unknown as Pick<SupabaseClient, 'from'>
  const readAccountListMappings = vi.fn(async () => [] as Awaited<ReturnType<Storage['readAccountListMappings']>>)
  const bindAccountList = vi.fn(async () => {})
  const storage = { readAccountListMappings, bindAccountList }
  let active = true
  return { client, storage, bindAccountList, readAccountListMappings,
    isActive: () => active, deactivate: () => { active = false } }
}
describe('explicit verified list binding', () => {
  it('binds an explicitly selected owned list ID', async () => {
    const test = setup()
    await bindVerifiedOwnedList(test.storage, test.client, account, 'groceries', list, test.isActive)
    expect(test.bindAccountList).toHaveBeenCalledExactlyOnceWith(account, 'groceries', list)
  })
  it('refuses an unowned list even if the name matches', async () => {
    const test = setup([{ id: list, owner_id: crypto.randomUUID(), name: 'Продукты' }])
    await expect(bindVerifiedOwnedList(test.storage, test.client, account, 'groceries', list, test.isActive)).rejects.toThrow()
    expect(test.bindAccountList).not.toHaveBeenCalled()
  })
  it('refuses a missing selection', async () => {
    const test = setup([])
    await expect(bindVerifiedOwnedList(test.storage, test.client, account, 'groceries', list, test.isActive)).rejects.toThrow('not owned')
    expect(test.bindAccountList).not.toHaveBeenCalled()
  })
  it('does not silently replace a previous mapping', async () => {
    const test = setup()
    test.readAccountListMappings.mockResolvedValueOnce([{
      key: 'key', accountId: account, localListId: 'groceries', remoteListId: crypto.randomUUID(),
    }])
    await expect(bindVerifiedOwnedList(test.storage, test.client, account, 'groceries', list, test.isActive)).rejects.toThrow('already bound')
    expect(test.bindAccountList).not.toHaveBeenCalled()
  })
  it('does not bind after account invalidation during discovery', async () => {
    const test = setup()
    const pending = test.storage.readAccountListMappings
    pending.mockImplementationOnce(async () => { test.deactivate(); return [] })
    await expect(bindVerifiedOwnedList(test.storage, test.client, account, 'groceries', list, test.isActive)).rejects.toThrow('Account changed')
    expect(test.bindAccountList).not.toHaveBeenCalled()
  })
})
