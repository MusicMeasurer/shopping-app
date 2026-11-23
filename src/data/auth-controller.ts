import type { SignOutGuard } from './signout-guard'
import { accountIdFromSessionCandidate, type SessionCandidate } from './auth-scope'
import { transitionAuthView, type AuthView } from './auth-view'
import { markAuthStage } from './auth-flow-diagnostics'

const signOutTimeoutMs = 12000

export interface AuthClient {
  getSession(): Promise<{ data: { session: SessionCandidate | null }; error: { message: string } | null }>
  onAuthStateChange(callback: (event: string, session: SessionCandidate | null) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: { message: string } | null }>
  signOut(scope?: 'local'): Promise<{ error: { message: string } | null }>
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
    markAuthStage('identity_check')
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
        markAuthStage('identity_verified')
        emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
      } else {
        markAuthStage('identity_rejected')
        if (restoreOffline && typeof navigator !== 'undefined' && !navigator.onLine) {
          const offlineId = await restoreOffline(session).catch(() => null)
          if (!active || signingOut || guard?.isPending() || generation !== startedAt) return
          emit(offlineId && offlineId === accountIdFromSessionCandidate(session)
            ? { status: 'offline-account', accountId: offlineId } : { status: 'guest' })
        } else emit({ status: 'guest' })
      }
    } catch (cause) {
      markAuthStage('identity_unavailable', cause)
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
    markAuthStage(event === 'SIGNED_OUT' || event === 'USER_DELETED' ? 'auth_event_signed_out' : 'auth_event')
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
    markAuthStage('initialize')
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

  /**
   * A successful Auth response is not the same as a confirmed workspace.
   * Reconcile explicitly instead of relying on a later onAuthStateChange
   * callback: Safari may deliver INITIAL_SESSION/refresh events out of order.
   * Each retry verifies the actual saved session with the Auth server;
   * never display account data based solely on cached getSession().
   */
  async function confirmSession(expectedAccountId?: string): Promise<string> {
    markAuthStage('session_recheck')
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!active || signingOut || guard?.isPending())
        throw new Error('Вход прерван сменой сессии.')
      const startedAt = generation
      const { data, error } = await client.getSession()
      if (error) throw new Error(error.message)
      const session = data.session
      const accountId = accountIdFromSessionCandidate(session)
      if (!session || !accountId || (expectedAccountId && accountId !== expectedAccountId)) {
        markAuthStage('session_interrupted')
        throw new Error('Не удалось подтвердить сессию после входа. Повторите вход.')
      }
      let verifiedId: string | null
      try {
        verifiedId = verifyIdentity ? await verifyIdentity(session) : accountId
      } catch (cause) {
        markAuthStage('identity_unavailable', cause)
        throw cause
      }
      if (!active || signingOut || guard?.isPending())
        throw new Error('Вход прерван сменой сессии.')
      if (generation !== startedAt) {
        // Another Auth event superseded our candidate while checking it.
        // Never publish stale credentials; re-read the current session.
        continue
      }
      if (verifiedId !== accountId) {
        markAuthStage('identity_rejected')
        throw new Error('Не удалось проверить аккаунт на сервере. Повторите вход.')
      }
      markAuthStage('session_confirmed')
      emit(transitionAuthView(view, { type: 'SESSION_RESOLVED', session }))
      return accountId
    }
    markAuthStage('session_interrupted')
    throw new Error('Сессия изменилась во время входа. Повторите вход.')
  }

  return {
    initialize,
    confirmSession,
    async signIn(email: string, password: string) {
      markAuthStage('credentials_requested')
      const { error } = await client.signInWithPassword({ email, password })
      if (error) {
        markAuthStage('credentials_rejected', error)
        throw error
      }
      markAuthStage('credentials_accepted')
      await confirmSession()
    },
    async signOut(scope?: 'local') {
      markAuthStage('signout_requested')
      // Hide account data before the remote sign-out request.
      if (signingOut) return
      signingOut = true
      generation++
      emit({ status: 'checking' })
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        guard?.markPending()
        if (!pendingSignOut) {
          const attempt = (scope ? client.signOut(scope) : client.signOut()).then(result => {
            // A late success must still unlock the hidden workspace, even after
            // the UI deadline or while a second attempt is in flight.
            if (!result.error && active) {
              guard?.clear()
              emit({ status: 'guest' })
            }
            return result
          }).finally(() => {
            if (pendingSignOut === attempt) pendingSignOut = undefined
          })
          pendingSignOut = attempt
        }
        const attempt = pendingSignOut
        let timedOut = false
        try {
          const { error } = await Promise.race([
            attempt,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => {
                timedOut = true
                reject(new Error('Sign-out timed out'))
              }, signOutTimeoutMs)
            }),
          ])
          if (error) throw new Error(error.message)
        } catch (error) {
          // A permanently stalled request must not block every future Retry.
          // The persisted guard stays set until some attempt succeeds.
          if (timedOut && pendingSignOut === attempt) pendingSignOut = undefined
          throw error
        }
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
