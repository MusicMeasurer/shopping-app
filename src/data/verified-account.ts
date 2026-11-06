import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdFromSessionCandidate, type SessionCandidate } from './auth-scope'

/**
 * A cached getSession() response is not proof of identity. Verify with Auth
 * server before allowing a persisted account to become the active UI scope.
 * This function intentionally fails closed when offline or when IDs differ.
 */
export async function verifiedAccountId(client: Pick<SupabaseClient, 'auth'>): Promise<string | null> {
  const { data: sessionData, error: sessionError } = await client.auth.getSession()
  if (sessionError || !sessionData.session) return null
  const candidate = accountIdFromSessionCandidate(sessionData.session as SessionCandidate)
  if (!candidate) return null
  try {
    const { data: userData, error: userError } = await client.auth.getUser()
    if (userError || !userData.user) return null
    return userData.user.id.toLowerCase() === candidate ? candidate : null
  } catch {
    return null
  }
}
