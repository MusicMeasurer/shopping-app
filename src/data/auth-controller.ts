import type { SignOutGuard } from './signout-guard'
import type { SessionCandidate } from './auth-scope'
import { transitionAuthView, type AuthView } from './auth-view'

export interface AuthClient {
  getSession(): Promise<{ data: { session: SessionCandidate | null }; error: { message: string } | null }>
  onAuthStateChange(callback: (event: string, session: SessionCandidate | null) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: { message: string } | null }>
  signOut(): Promise<{ error: { message: string } | null }>
}

/**
 * Adapter around Supabase Auth. No user ID may be supplied by the UI.
 * An auth event is only a local UI signal; Supabase RLS remains authoritative.
 */
export function createAuthController(client: AuthClient, onChange: (view: AuthView) => void, guard?: SignOutGuard) {
  let active = true
  let generation = 0
  let signingOut = false
  let view: AuthView = { status: 'checking' }
  const emit = (next: AuthView) => {
    if (!active) return
    view = next
    onChange(next)
  }
  const subscription = client.onAuthStateChange((event, session) => {
    generation++
    if (signingOut || guard?.isPending()) return
    if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      emit(transitionAuthView(view, { type: 'SIGNED_OUT' }))
    } else {
      emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
    }
  }).data.subscription

  async function initialize() {
    if (guard?.isPending()) {
      emit({ status: 'checking' })
      return
    }
    const startedAt = generation
    try {
      const { data, error } = await client.getSession()
      if (!active || generation !== startedAt) return
      if (error) throw new Error(error.message)
      emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session: data.session }))
    } catch {
      if (generation === startedAt) emit({ status: 'guest' })
    }
  }

  return {
    initialize,
    async signIn(email: string, password: string) {
      const { error } = await client.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
    },
    async signOut() {
      // Hide account data before the remote sign-out request.
      signingOut = true
      generation++
      emit({ status: 'checking' })
      try {
        guard?.markPending()
        const { error } = await client.signOut()
        if (error) throw new Error(error.message)
        guard?.clear()
        emit({ status: 'guest' })
      } catch (error) {
        // Keep the workspace locked: the SDK may still hold a valid session.
        // Do not claim the user is a guest until sign-out succeeds.
        emit({ status: 'checking' })
        throw error
      } finally {
        signingOut = false
      }
    },
    dispose() {
      active = false
      subscription.unsubscribe()
    },
  }
}
