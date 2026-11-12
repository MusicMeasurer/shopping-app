import type { SupabaseClient } from '@supabase/supabase-js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type CompletionMode = 'marked_only' | 'all_purchased' | 'none_purchased'
export interface CompletionReceipt {
  operationId: string
  listId: string
  revision: number
  itemCount: number
  archiveId: string | null
  kind: 'permanent' | 'oneoff'
  mode: CompletionMode
}

/**
 * Low-level server RPC adapter. It must only be invoked by a future durable
 * completion coordinator that records operationId BEFORE sending and recovers
 * local tombstones AFTER receipt. Not wired to a user action.
 */
export async function sendCloudCompletion(
  client: Pick<SupabaseClient, 'rpc'>,
  request: { operationId: string; listId: string; expectedRevision: number; mode: CompletionMode },
): Promise<CompletionReceipt> {
  const { operationId, listId, expectedRevision, mode } = request
  if (!uuid.test(operationId) || !uuid.test(listId) ||
      !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      !['marked_only', 'all_purchased', 'none_purchased'].includes(mode))
    throw new Error('Неверные параметры завершения')
  const { data, error } = await client.rpc('complete_e4_list', {
    p_operation: operationId,
    p_list: listId,
    p_expected_revision: expectedRevision,
    p_mode: mode,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Неверный ответ сервера')
  const row = data as Record<string, unknown>
  if (row.operation_id !== operationId || row.list_id !== listId ||
      row.mode !== mode || (row.kind !== 'permanent' && row.kind !== 'oneoff') ||
      !Number.isSafeInteger(row.revision) || (row.revision as number) <= expectedRevision ||
      !Number.isSafeInteger(row.item_count) || (row.item_count as number) < 1 ||
      (row.archive_id !== null && (typeof row.archive_id !== 'string' || !uuid.test(row.archive_id))) ||
      (mode === 'all_purchased' && row.archive_id === null) ||
      (mode === 'none_purchased' && row.archive_id !== null))
    throw new Error('Неподтверждённый результат завершения')
  return {
    operationId, listId, mode, kind: row.kind,
    revision: row.revision as number,
    itemCount: row.item_count as number,
    archiveId: row.archive_id as string | null,
  }
}
