import type { SupabaseClient } from '@supabase/supabase-js'

/** Read-only discovery. Never bind a local list by its display name. */
export interface OwnedCloudList { id: string; name: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function fetchOwnedCloudLists(
  client: Pick<SupabaseClient, 'from'>,
  verifiedAccountId: string,
): Promise<OwnedCloudList[]> {
  if (!uuid.test(verifiedAccountId)) throw new Error('Verified account ID required')
  const { data, error } = await client.from('shopping_lists')
    .select('id,owner_id,name')
    .eq('owner_id', verifiedAccountId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid cloud list response')
  const seen = new Set<string>()
  return data.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('Invalid cloud list')
    const value = row as Record<string, unknown>
    if (typeof value.id !== 'string' || !uuid.test(value.id) ||
        value.owner_id !== verifiedAccountId ||
        typeof value.name !== 'string' || !value.name.trim() ||
        seen.has(value.id)) throw new Error('Invalid or duplicate owned cloud list')
    seen.add(value.id)
    return { id: value.id, name: value.name }
  })
}
