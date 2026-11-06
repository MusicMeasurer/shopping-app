import { describe, expect, it, vi } from 'vitest'
import { createSignOutGuard } from './signout-guard'
import { createAuthController, type AuthClient } from './auth-controller'
import type { AuthView } from './auth-view'

const id = '123e4567-e89b-42d3-a456-426614174000'
const session = { user: { id }, access_token: 'token' }

describe('persisted sign-out guard', () => {
  it('persists pending intent across guard instances', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const first = createSignOutGuard(storage)
    first.markPending()
    expect(createSignOutGuard(storage).isPending()).toBe(true)
    first.clear()
    expect(createSignOutGuard(storage).isPending()).toBe(false)
  })
  it('does not restore an account while previous sign-out remains pending', async () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const guard = createSignOutGuard(storage)
    guard.markPending()
    let callback: (event: string, value: typeof session | null) => void = () => {}
    const getSession = vi.fn(async () => ({ data: { session }, error: null }))
    const client: AuthClient = {
      getSession,
      onAuthStateChange: cb => {
        callback = cb
        return { data: { subscription: { unsubscribe() {} } } }
      },
      signInWithPassword: async () => ({ error: null }),
      signOut: async () => ({ error: null }),
    }
    const views: AuthView[] = []
    const controller = createAuthController(client, view => views.push(view), guard)
    await controller.initialize()
    callback('INITIAL_SESSION', session)
    expect(getSession).not.toHaveBeenCalled()
    expect(views.at(-1)).toEqual({ status: 'checking' })
    await controller.signOut()
    expect(guard.isPending()).toBe(false)
    expect(views.at(-1)).toEqual({ status: 'guest' })
    controller.dispose()
  })
})
