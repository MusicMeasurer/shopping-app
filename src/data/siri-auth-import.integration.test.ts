import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createStorage } from './storage'
import { createAuthController } from './auth-controller'
import { verifiedAccountId } from './verified-account'
import { createAccountSync } from './account-sync'
import type { AuthView } from './auth-view'
import type { SessionCandidate } from './auth-scope'

const owner = '123e4567-e89b-42d3-a456-426614174000'
const outsider = '223e4567-e89b-42d3-a456-426614174001'

function simulatedAuthenticatedClient(accountId: string, remoteListId: string) {
  const session: SessionCandidate = { user: { id: accountId }, access_token: 'test-only-session' }
  const remote = {
    id: '323e4567-e89b-42d3-a456-426614174002',
    list_id: remoteListId,
    name: 'Молоко через Siri',
    purchased: false,
    created_at: new Date().toISOString(),
    version: 1,
  }
  const order = vi.fn(async () => ({ data: [remote], error: null }))
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: { id: accountId } }, error: null })),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signInWithPassword: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({ order }) }) }) }),
  } as unknown as SupabaseClient
  return { client, session, order, remote }
}

describe('authenticated Siri import integration (simulated auth, not live sign-in)', () => {
  it('verifies account with Auth API before importing the Siri item into its durable local namespace', async () => {
    const remoteListId = '423e4567-e89b-42d3-a456-426614174003'
    const { client, order, remote } = simulatedAuthenticatedClient(owner, remoteListId)
    const storage = createStorage('siri-auth-integration-' + crypto.randomUUID())
    await storage.bindAccountList(owner, 'groceries', remoteListId)
    const views: AuthView[] = []
    const controller = createAuthController({
      getSession: () => client.auth.getSession() as never,
      onAuthStateChange: callback => client.auth.onAuthStateChange((_event, session) => callback(_event, session as SessionCandidate | null)),
      signInWithPassword: credentials => client.auth.signInWithPassword(credentials) as never,
      signOut: () => client.auth.signOut() as never,
    }, view => views.push(view), undefined, async () => verifiedAccountId(client))
    try {
      await controller.initialize()
      expect(views.at(-1)).toEqual({ status: 'account', accountId: owner })
      expect(client.auth.getUser).toHaveBeenCalledOnce()
      const active = () => views.at(-1)?.status === 'account'
      const sync = createAccountSync(storage, client, {
        accountId: owner, remoteListId, localListId: 'groceries', isActive: active,
      })
      expect(await sync.importRemoteOnly()).toBe(1)
      expect(order).toHaveBeenCalledTimes(2)
      expect((await storage.readAccountItems(owner)).map(row => row.name)).toEqual([remote.name])
      expect(await storage.readAccountItems(outsider)).toEqual([])
      expect(await storage.read()).toEqual([])
    } finally {
      controller.dispose()
      await storage.close()
    }
  })

  it('does not expose account data or fetch remote items when Auth API reports a different identity', async () => {
    const remoteListId = '523e4567-e89b-42d3-a456-426614174004'
    const { client, order } = simulatedAuthenticatedClient(owner, remoteListId)
    client.auth.getUser = vi.fn(async () => ({ data: { user: { id: outsider } }, error: null })) as never
    const views: AuthView[] = []
    const controller = createAuthController({
      getSession: () => client.auth.getSession() as never,
      onAuthStateChange: callback => client.auth.onAuthStateChange((_event, session) => callback(_event, session as SessionCandidate | null)),
      signInWithPassword: credentials => client.auth.signInWithPassword(credentials) as never,
      signOut: () => client.auth.signOut() as never,
    }, view => views.push(view), undefined, async () => verifiedAccountId(client))
    try {
      await controller.initialize()
      expect(views.at(-1)).toEqual({ status: 'guest' })
      expect(order).not.toHaveBeenCalled()
    } finally {
      controller.dispose()
    }
  })
})
