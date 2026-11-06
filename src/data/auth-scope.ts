/**
 * Never trust a user id supplied by a form, URL or unverified local preference.
 * Only a validated auth session may select an account's local data scope.
 */
export interface VerifiedIdentity {
  user: { id: string }
  access_token: string
  expires_at?: number
}

export function accountIdFromVerifiedSession(session: VerifiedIdentity | null): string | null {
  if (!session) return null
  const id = session.user?.id
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return null
  }
  if (typeof session.access_token !== 'string' || !session.access_token.trim()) return null
  if (session.expires_at !== undefined && (!Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000)) return null
  return id.toLowerCase()
}
