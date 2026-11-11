import type { SupabaseClient } from '@supabase/supabase-js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const secret = /^[0-9a-f]{64}$/

export type SiriCredentialEnrollment = {
  credentialId: string
  token: string
  expiresInDays: number
}

/** Call only after the user explicitly requests Shortcut enrollment.
 * Never persist the returned token in localStorage, IndexedDB, logs or URLs.
 * Display it once for direct transfer to the user's Shortcut.
 */
export async function enrollSiriCredential(
  client: Pick<SupabaseClient, 'rpc'>,
  cloudListId: string,
): Promise<SiriCredentialEnrollment> {
  if (!uuid.test(cloudListId)) throw new Error('Select a valid cloud list')
  const { data, error } = await client.rpc('enroll_siri_shortcut', { p_list: cloudListId })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid enrollment response')
  const response = data as Record<string, unknown>
  if (typeof response.credential_id !== 'string' || !uuid.test(response.credential_id) ||
      typeof response.token !== 'string' || !secret.test(response.token) ||
      response.expires_in_days !== 90) {
    throw new Error('Invalid enrollment response')
  }
  return {
    credentialId: response.credential_id,
    token: response.token,
    expiresInDays: response.expires_in_days,
  }
}

export async function revokeSiriCredential(
  client: Pick<SupabaseClient, 'rpc'>,
  credentialId: string,
): Promise<boolean> {
  if (!uuid.test(credentialId)) throw new Error('Invalid credential ID')
  const { data, error } = await client.rpc('revoke_siri_shortcut', { p_credential: credentialId })
  if (error) throw error
  if (typeof data !== 'boolean') throw new Error('Invalid revocation response')
  return data
}

export type SiriCredentialMetadata = {
  credentialId: string
  expiresAt: string
  revokedAt: string | null
}

/** Metadata only. The secret is never returned after enrollment. */
export async function listSiriCredentials(
  client: Pick<SupabaseClient, 'rpc'>,
  cloudListId: string,
): Promise<SiriCredentialMetadata[]> {
  if (!uuid.test(cloudListId)) throw new Error('Select a valid cloud list')
  const { data, error } = await client.rpc('list_siri_shortcuts', { p_list: cloudListId })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid credential list')
  return data.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid credential metadata')
    const value = row as Record<string, unknown>
    if (typeof value.credential_id !== 'string' || !uuid.test(value.credential_id) ||
        typeof value.expires_at !== 'string' || Number.isNaN(Date.parse(value.expires_at)) ||
        (value.revoked_at !== null && (typeof value.revoked_at !== 'string' || Number.isNaN(Date.parse(value.revoked_at))))) {
      throw new Error('Invalid credential metadata')
    }
    return { credentialId: value.credential_id, expiresAt: value.expires_at, revokedAt: value.revoked_at as string | null }
  })
}
