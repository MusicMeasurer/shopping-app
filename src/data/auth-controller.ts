import type { SignOutGuard } from './signout-guard'
import { accountIdFromSessionCandidate, type SessionCandidate } from './auth-scope'
import { transitionAuthView, type AuthView } from './auth-view'

const signOutTimeoutMs = 12000

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
export function createAuthController(client: AuthClient, onChange: (view: AuthView) => void, guard?: SignOutGuard, verifyIdentity?: (session: SessionCandidate) => Promise<string | null>, restoreOffline?: (session: SessionCandidate) => Promise<string | null>) {
  let active = true
  let generation = 0
  let pendingSignOut: ReturnType<AuthClient['signOut']> | undefined
  let signingOut = false
  let view: AuthView = { status: 'checking' }
  const emit = (next: AuthView) => {
    if (!active) return
    view = next
    onChange(next)
  }
  async function resolveSession(session: SessionCandidate | null, startedAt: number) {
    if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
    if (!session || !verifyIdentity) {
      emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
      return
    }
    const sameAccount = (view.status === 'account' || view.status === 'offline-account') &&
      view.accountId === accountIdFromSessionCandidate(session)
    if (!sameAccount) emit({ status: 'checking' })
    try {
      const verifiedId = await verifyIdentity(session)
      if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
      if (verifiedId && verifiedId === accountIdFromSessionCandidate(session)) {
        emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
      } else {
        if (restoreOffline && typeof navigator !== 'undefined' && !navigator.onLine) {
          const offlineId = await restoreOffline(session).catch(() => null)
          if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
          emit(offlineId && offlineId === accountIdFromSessionCandidate(session)
            ? { status: 'offline-account', accountId: offlineId } : { status: 'guest' })
        } else emit({ status: 'guest' })
      }
    } catch {
      if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
      // Keep the already verified workspace mounted during a transient failure.
      // Cloud operations still verify identity before syncing.
      if (sameAccount) return
      if (session && restoreOffline && typeof navigator !== 'undefined' && !navigator.onLine) {
        const offlineId = await restoreOffline(session).catch(() => null)
        if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
        emit(offlineId && offlineId === accountIdFromSessionCandidate(session)
          ? { status: 'offline-account', accountId: offlineId } : { status: 'guest' })
      } else emit({ status: 'guest' })
    }
  }
  const subscription = client.onAuthStateChange((event, session) => {
    generation++
    if (signingOut || guard?.isPending()) return
    if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
      emit(transitionAuthView(view, { type: 'SIGNED_OUT' }))
    } else {
      const startedAt = generation
      if (verifyIdentity) setTimeout(() => { void resolveSession(session, startedAt) }, 0)
      else void resolveSession(session, startedAt)
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
      await resolveSession(data.session, startedAt)
    } catch {
      if (generation === startedAt && view.status === 'checking') emit({ status: 'guest' })
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
      if (signingOut) return
      signingOut = true
      generation++
      emit({ status: 'checking' })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        guard?.markPending()
        pendingSignOut ??= client.signOut().finally(() => { pendingSignOut = undefined })
        const { error } = await Promise.race([
          pendingSignOut,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Sign-out timed out')), signOutTimeoutMs)
          }),
        ])
        if (error) throw new Error(error.message)
        guard?.clear()
        emit({ status: 'guest' })
      } catch (error) {
        // Keep the workspace locked: the SDK may still hold a valid session.
        // Do not claim the user is a guest until sign-out succeeds.
        emit({ status: 'checking' })
        throw error
      } finally {
        clearTimeout(timeout)
        signingOut = false
      }
    },
    dispose() {
      active = false
      subscription.unsubscribe()
    },
  }
}
