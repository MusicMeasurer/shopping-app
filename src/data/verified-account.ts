import { traceSync } from './sync-diagnostics'
import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { accountIdFromSessionCandidate, type SessionCandidate } from './auth-scope'

/**
 * A cached getSession() response is not proof of identity. Verify with Auth
 * server before allowing a persisted account to become the active UI scope.
 * This function intentionally fails closed when offline or when IDs differ.
 */
export async function verifiedAccountId(client: Pick<SupabaseClient, 'auth'>): Promise<string | null> {
  return checkVerifiedAccountId(client).catch(() => null)
}

/** Preserve transient failures for actions that can retry or explain them. */
export async function checkVerifiedAccountId(client: Pick<SupabaseClient, 'auth'>): Promise<string | null> {
  const { data: sessionData, error: sessionError } = await traceSync('session-read', () => client.auth.getSession(), {}, result => !result.error && !!result.data.session)
  if (isAuthRetryableFetchError(sessionError) || (sessionError?.status ?? 0) >= 500) throw sessionError
  if (sessionError || !sessionData.session) return null
  return verifySessionIdentity(client, sessionData.session as SessionCandidate)
}

/** Distinguish a temporary connection failure from a rejected identity. */
export async function verifySessionIdentity(client: Pick<SupabaseClient, 'auth'>, session: SessionCandidate): Promise<string | null> {
  const candidate = accountIdFromSessionCandidate(session)
  if (!candidate) return null
  const { data, error } = await traceSync('identity', () => client.auth.getUser(session.access_token), {}, result => !result.error && result.data.user?.id.toLowerCase() === candidate)
  if (isAuthRetryableFetchError(error) || (error?.status ?? 0) >= 500) throw error
  return !error && data.user?.id.toLowerCase() === candidate ? candidate : null
}
