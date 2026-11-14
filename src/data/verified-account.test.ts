import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifiedAccountId } from './verified-account'

const id = '123e4567-e89b-42d3-a456-426614174000'
const other = '223e4567-e89b-42d3-a456-426614174001'

function clientWithUser(userId: string | null, getUserFails = false) {
  const getUser = vi.fn(async () => {
    if (getUserFails) throw new Error('offline')
    return { data: { user: userId ? { id: userId } : null }, error: null }
  })
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { user: { id }, access_token: 'token' } },
        error: null,
      })),
      getUser,
    },
  } as unknown as Pick<SupabaseClient, 'auth'>
  return { client, getUser }
}

describe('server-verified account identity', () => {
  it('accepts a matching server identity', async () => {
    const { client, getUser } = clientWithUser(id)
    expect(await verifiedAccountId(client)).toBe(id)
    expect(getUser).toHaveBeenCalledWith('token')
  })
  it('rejects a different user returned by the server', async () => {
    const { client } = clientWithUser(other)
    expect(await verifiedAccountId(client)).toBeNull()
  })
  it('fails closed if server identity cannot be checked', async () => {
    const { client } = clientWithUser(id, true)
    expect(await verifiedAccountId(client)).toBeNull()
  })
  it('does not request identity without a session', async () => {
    const { client, getUser } = clientWithUser(id)
    vi.spyOn(client.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null } as never)
    expect(await verifiedAccountId(client)).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })
})
