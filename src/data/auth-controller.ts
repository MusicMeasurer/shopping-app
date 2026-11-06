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
export function createAuthController(client: AuthClient, onChange: (view: AuthView) => void) {
  let active = true
  let generation = 0
  let view: AuthView = { status: 'checking' }
  const emit = (next: AuthView) => {
    if (!active) return
    view = next
    onChange(next)
  }
  const subscription = client.onAuthStateChange((event, session) => {
    generation++
    if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      emit(transitionAuthView(view, { type: 'SIGNED_OUT' }))
    } else {
      emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
    }
  }).data.subscription

  async function initialize() {
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
      emit({ status: 'checking' })
      try {
        const { error } = await client.signOut()
        if (error) throw new Error(error.message)
        emit({ status: 'guest' })
      } catch (error) {
        // Fail closed: do not expose previous account data after an uncertain sign-out.
        emit({ status: 'guest' })
        throw error
      }
    },
    dispose() {
      active = false
      subscription.unsubscribe()
    },
  }
}
