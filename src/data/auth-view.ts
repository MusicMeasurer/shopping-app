import { accountIdFromSessionCandidate, type SessionCandidate } from './auth-scope'

/**
 * UI state only. This does not grant cloud access; Supabase RLS is authoritative.
 * Keep account data hidden until the auth client has resolved its initial session.
 */
export type AuthView =
  | { status: 'checking' }
  | { status: 'guest' }
  | { status: 'account'; accountId: string }

export type AuthEvent =
  | { type: 'SESSION_RESOLVED'; session: SessionCandidate | null }
  | { type: 'SIGNED_OUT' }
  | { type: 'SESSION_INVALIDATED' }
  | { type: 'CHECKING' }

export function transitionAuthView(_previous: AuthView, event: AuthEvent): AuthView {
  if (event.type === 'CHECKING') return { status: 'checking' }
  if (event.type === 'SIGNED_OUT' || event.type === 'SESSION_INVALIDATED') return { status: 'guest' }
  const accountId = accountIdFromSessionCandidate(event.session)
  return accountId ? { status: 'account', accountId } : { status: 'guest' }
}
