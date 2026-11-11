/**
 * This is only a local session-shape and expiry guard, NOT cryptographic verification.
 * Cloud access must always rely on Supabase Auth and server-enforced RLS.
 */
export interface SessionCandidate {
  user: { id: string }
  access_token: string
  expires_at?: number
}

export function accountIdFromSessionCandidate(session: SessionCandidate | null): string | null {
  if (!session) return null
  const id = session.user?.id
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null
  }
  if (typeof session.access_token !== 'string' || !session.access_token.trim()) return null
  if (session.expires_at !== undefined && (!Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000)) return null
  return id.toLowerCase()
}
