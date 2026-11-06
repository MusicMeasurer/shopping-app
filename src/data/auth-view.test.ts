import { describe, expect, it } from 'vitest'
import { transitionAuthView, type AuthView } from './auth-view'

const accountId = '123e4567-e89b-42d3-a456-426614174000'
const account: AuthView = { status: 'account', accountId }

describe('auth view transitions', () => {
  it('does not expose guest data before initial session resolution', () => {
    expect(transitionAuthView(account, { type: 'CHECKING' })).toEqual({ status: 'checking' })
  })
  it('resolves missing sessions to guest', () => {
    expect(transitionAuthView({ status: 'checking' }, { type: 'SESSION_RESOLVED', session: null })).toEqual({ status: 'guest' })
  })
  it('switches account scopes on a new session', () => {
    const otherId = '123e4567-e89b-42d3-a456-426614174001'
    expect(transitionAuthView(account, { type: 'SESSION_RESOLVED', session: { user: { id: otherId }, access_token: 'token' } })).toEqual({ status: 'account', accountId: otherId })
  })
  it('drops the previous account on sign-out or invalidation', () => {
    expect(transitionAuthView(account, { type: 'SIGNED_OUT' })).toEqual({ status: 'guest' })
    expect(transitionAuthView(account, { type: 'SESSION_INVALIDATED' })).toEqual({ status: 'guest' })
  })
  it('rejects an expired session', () => {
    expect(transitionAuthView(account, { type: 'SESSION_RESOLVED', session: { user: { id: accountId }, access_token: 'token', expires_at: 1 } })).toEqual({ status: 'guest' })
  })
})
