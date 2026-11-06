import { describe, expect, it, vi } from 'vitest'
import { createAuthController, type AuthClient } from './auth-controller'
import type { SessionCandidate } from './auth-scope'
import type { AuthView } from './auth-view'

const id = '123e4567-e89b-42d3-a456-426614174000'
const secondId = '223e4567-e89b-42d3-a456-426614174001'
const session: SessionCandidate = { user: { id }, access_token: 'token' }

function fakeClient(initial: SessionCandidate | null = null) {
  let notify: (event: string, session: SessionCandidate | null) => void = () => {}
  const unsubscribe = vi.fn()
  const client: AuthClient = {
    getSession: vi.fn(async () => ({ data: { session: initial }, error: null })),
    onAuthStateChange: (callback) => {
      notify = callback
      return { data: { subscription: { unsubscribe } } }
    },
    signInWithPassword: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  }
  return { client, notify: (event: string, value: SessionCandidate | null) => notify(event, value), unsubscribe }
}

describe('auth controller', () => {
  it('restores a session and hides it on signout', async () => {
    const fake = fakeClient(session)
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    await controller.initialize()
    expect(views.at(-1)).toEqual({ status: 'account', accountId: id })
    await controller.signOut()
    expect(views.slice(-2)).toEqual([{ status: 'checking' }, { status: 'guest' }])
    controller.dispose()
    expect(fake.unsubscribe).toHaveBeenCalledOnce()
  })
  it('does not let a stale getSession overwrite a newer auth event', async () => {
    let resolve!: (result: { data: { session: SessionCandidate | null }; error: null }) => void
    const fake = fakeClient()
    fake.client.getSession = () => new Promise(r => { resolve = r })
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    const pending = controller.initialize()
    fake.notify('SIGNED_OUT', null)
    resolve({ data: { session }, error: null })
    await pending
    expect(views.at(-1)).toEqual({ status: 'guest' })
    controller.dispose()
  })
  it('keeps the workspace locked when signout returns an error', async () => {
    const fake = fakeClient(session)
    fake.client.signOut = async () => ({ error: { message: 'offline' } })
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    await controller.initialize()
    await expect(controller.signOut()).rejects.toThrow('offline')
    expect(views.at(-1)).toEqual({ status: 'checking' })
    controller.dispose()
  })
  it('switches between distinct account identities without retaining the previous account view', async () => {
    const fake = fakeClient(session)
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    await controller.initialize()
    fake.notify('SIGNED_OUT', null)
    fake.notify('SIGNED_IN', { user: { id: secondId }, access_token: 'second-token' })
    expect(views).toEqual([
      { status: 'account', accountId: id },
      { status: 'guest' },
      { status: 'account', accountId: secondId },
    ])
    controller.dispose()
  })
  it('rejects expired sessions on refresh and ignores callbacks after disposal', async () => {
    const fake = fakeClient(session)
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    await controller.initialize()
    fake.notify('TOKEN_REFRESHED', { ...session, expires_at: 1 })
    expect(views.at(-1)).toEqual({ status: 'guest' })
    controller.dispose()
    const count = views.length
    fake.notify('SIGNED_IN', session)
    expect(views).toHaveLength(count)
  })
  it('does not reopen account data when auth events arrive during a pending signout', async () => {
    const fake = fakeClient(session)
    let finish!: (value: { error: null }) => void
    fake.client.signOut = () => new Promise(resolve => { finish = resolve })
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    await controller.initialize()
    const pending = controller.signOut()
    fake.notify('TOKEN_REFRESHED', session)
    fake.notify('SIGNED_IN', session)
    expect(views.at(-1)).toEqual({ status: 'checking' })
    finish({ error: null })
    await pending
    expect(views.at(-1)).toEqual({ status: 'guest' })
    controller.dispose()
  })
  it('does not publish a session returned after disposal', async () => {
    let resolve!: (result: { data: { session: SessionCandidate | null }; error: null }) => void
    const fake = fakeClient()
    fake.client.getSession = () => new Promise(r => { resolve = r })
    const views: AuthView[] = []
    const controller = createAuthController(fake.client, view => views.push(view))
    const pending = controller.initialize()
    controller.dispose()
    resolve({ data: { session }, error: null })
    await pending
    expect(views).toEqual([])
  })
})
