import type { SupabaseClient } from '@supabase/supabase-js'

/** E4 cloud metadata is read-only until a versioned server mutation protocol is verified. */
export interface CloudListMetadata {
  id: string
  ownerId: string
  name: string
  kind: 'permanent' | 'oneoff'
  position: number
  revision: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseCloudListMetadata(rows: unknown, accountId: string): CloudListMetadata[] {
  if (!uuid.test(accountId)) throw new Error('Verified account ID required')
  if (!Array.isArray(rows)) throw new Error('Invalid cloud list metadata')
  const ids = new Set<string>()
  return rows.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid cloud list metadata')
    const row = value as Record<string, unknown>
    if (typeof row.id !== 'string' || !uuid.test(row.id) || ids.has(row.id) ||
        row.owner_id !== accountId || typeof row.name !== 'string' ||
        !row.name.trim() || row.name.trim().length > 120 ||
        (row.kind !== 'permanent' && row.kind !== 'oneoff') ||
        !Number.isSafeInteger(row.position) || (row.position as number) < 0 ||
        !Number.isSafeInteger(row.revision) || (row.revision as number) < 0) {
      throw new Error('Invalid or unauthorized cloud list metadata')
    }
    ids.add(row.id)
    return { id: row.id, ownerId: accountId, name: row.name,
      kind: row.kind, position: row.position as number, revision: row.revision as number }
  })
}

/** Call only after an additive E4 migration is verified on an isolated lab. */
export async function fetchCloudListMetadata(
  client: Pick<SupabaseClient, 'from'>, accountId: string,
): Promise<CloudListMetadata[]> {
  if (!uuid.test(accountId)) throw new Error('Verified account ID required')
  const { data, error } = await client.from('shopping_lists')
    .select('id,owner_id,name,kind,position,revision')
    .eq('owner_id', accountId)
    .is('deleted_at', null)
    .order('position', { ascending: true })
  if (error) throw error
  return parseCloudListMetadata(data, accountId)
}
