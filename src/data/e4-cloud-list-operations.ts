import type { SupabaseClient } from '@supabase/supabase-js'
import type { CloudListMetadata } from './e4-cloud-list-metadata'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type CloudListChange =
  | { action: 'rename'; name: string }
  | { action: 'kind'; kind: 'permanent' | 'oneoff' }
  | { action: 'reorder'; position: number }

/**
 * Fail-closed client contract for the reviewed versioned metadata RPC.
 * Caller must durably persist the operation UUID before invoking this adapter.
 * This adapter is deliberately not wired into UI until the server RPC and
 * account-scoped operation queue pass hosted security/replay checks.
 */
export async function sendCloudListChange(
  client: Pick<SupabaseClient, 'rpc'>,
  list: CloudListMetadata,
  operationId: string,
  change: CloudListChange,
): Promise<CloudListMetadata> {
  if (!uuid.test(operationId) || !uuid.test(list.id) || !uuid.test(list.ownerId) ||
      !Number.isSafeInteger(list.revision) || list.revision < 0)
    throw new Error('Invalid list operation identity')
  const args: Record<string, unknown> = {
    p_operation: operationId, p_list: list.id, p_expected_revision: list.revision,
  }
  if (change.action === 'rename') {
    if (change.name.trim().length < 1 || change.name.trim().length > 120) throw new Error('Invalid list name')
    args.p_name = change.name.trim()
  } else if (change.action === 'kind') {
    if (change.kind !== 'permanent' && change.kind !== 'oneoff') throw new Error('Invalid list kind')
    args.p_kind = change.kind
  } else if (change.action === 'reorder') {
    if (!Number.isSafeInteger(change.position) || change.position < 0) throw new Error('Invalid list position')
    args.p_position = change.position
  } else throw new Error('Unknown list mutation')

  const { data, error } = await client.rpc('apply_e4_list_metadata', args)
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unverified list receipt')
  const receipt = data as Record<string, unknown>
  // The server's receipt is NOT a substitute for a fresh owner-scoped read.
  if (receipt.list_id !== list.id || !Number.isSafeInteger(receipt.revision) ||
      (receipt.revision as number) <= list.revision)
    throw new Error('Unverified list revision')
  return { ...list, revision: receipt.revision as number,
    ...(change.action === 'rename' ? { name: change.name.trim() } : {}),
    ...(change.action === 'kind' ? { kind: change.kind } : {}),
    ...(change.action === 'reorder' ? { position: change.position } : {}),
  }
}
