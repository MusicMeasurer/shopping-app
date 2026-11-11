import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCloudListMetadata, parseCloudListMetadata } from './e4-cloud-list-metadata'

const account = '123e4567-e89b-42d3-a456-426614174000'
const list = '223e4567-e89b-42d3-a456-426614174001'
const row = { id: list, owner_id: account, name: 'Продукты', kind: 'permanent', position: 0, revision: 2 }

function fake(rows: unknown, error: unknown = null) {
  const order = vi.fn(async () => ({ data: rows, error }))
  const is = vi.fn(() => ({ order }))
  const eq = vi.fn(() => ({ is }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as Pick<SupabaseClient, 'from'>, from, select, eq, is, order }
}

describe('E4 cloud metadata preflight', () => {
  it('reads only owner-scoped, active and ordered metadata', async () => {
    const f = fake([row])
    expect(await fetchCloudListMetadata(f.client, account)).toEqual([{
      id: list, ownerId: account, name: 'Продукты', kind: 'permanent', position: 0, revision: 2,
    }])
    expect(f.select).toHaveBeenCalledWith('id,owner_id,name,kind,position,revision')
    expect(f.eq).toHaveBeenCalledWith('owner_id', account)
    expect(f.is).toHaveBeenCalledWith('deleted_at', null)
    expect(f.order).toHaveBeenCalledWith('position', { ascending: true })
  })
  it('rejects foreign and duplicate list identities', () => {
    expect(() => parseCloudListMetadata([{ ...row, owner_id: crypto.randomUUID() }], account)).toThrow()
    expect(() => parseCloudListMetadata([row, row], account)).toThrow()
  })
  it('rejects malformed kind, position, revision and name', () => {
    for (const invalid of [{ kind: 'shared' }, { position: -1 }, { revision: '1' }, { name: ' ' }]) {
      expect(() => parseCloudListMetadata([{ ...row, ...invalid }], account)).toThrow()
    }
  })
  it('fails closed before query on invalid account', async () => {
    const f = fake([])
    await expect(fetchCloudListMetadata(f.client, 'guest')).rejects.toThrow('Verified account')
    expect(f.from).not.toHaveBeenCalled()
  })
  it('propagates missing migration or network errors', async () => {
    const f = fake(null, { message: 'column does not exist' })
    await expect(fetchCloudListMetadata(f.client, account)).rejects.toMatchObject({ message: 'column does not exist' })
  })
})
