import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCloudListMetadata, type CloudListMetadata } from './e4-cloud-list-metadata'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Fail-closed E4 list creation. Requires the separately reviewed server RPC. */
export async function createCloudList(
  client: Pick<SupabaseClient, 'rpc'>,
  accountId: string,
  operationId: string,
  name: string,
  kind: 'permanent' | 'oneoff',
): Promise<CloudListMetadata> {
  if (!uuid.test(accountId) || !uuid.test(operationId) ||
      typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      (kind !== 'permanent' && kind !== 'oneoff')) {
    throw new Error('Invalid cloud list creation')
  }
  const { data, error } = await client.rpc('create_e4_list', {
    p_operation: operationId, p_name: name.trim(), p_kind: kind,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data as Record<string, unknown>).operation_id !== operationId) {
    throw new Error('Invalid cloud list creation receipt')
  }
  const row = data as Record<string, unknown>
  const parsed = parseCloudListMetadata([{
    id: row.list_id, owner_id: row.owner_id, name: row.name,
    kind: row.kind, position: row.position, revision: row.revision,
  }], accountId)[0]
  if (parsed.name !== name.trim() || parsed.kind !== kind || parsed.revision !== 0) {
    throw new Error('Cloud list creation receipt mismatch')
  }
  return parsed
}
