import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Server operations use stable UUIDs for idempotency. A failed/ambiguous
 * request must be retried with the EXACT same payload and operation ID.
 * Never auto-rebase a version conflict: it needs explicit reconciliation.
 */
interface ItemAttributes { quantity: number | null; unit: string | null }

export type RemoteMutation =
  | { kind: 'add'; operationId: string; listId: string; itemId: string; name: string; purchased: boolean; attributes?: ItemAttributes }
  | { kind: 'update'; operationId: string; listId: string; itemId: string; expectedVersion: number; name?: string; purchased?: boolean; attributes?: ItemAttributes }
  | { kind: 'delete'; operationId: string; listId: string; itemId: string; expectedVersion: number }

export interface RemoteMutationReceipt {
  operationId: string
  listRevision: number
  itemVersion: number
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function applyRemoteMutation(
  client: Pick<SupabaseClient, 'rpc'>,
  mutation: RemoteMutation,
): Promise<RemoteMutationReceipt> {
  if (![mutation.operationId, mutation.listId, mutation.itemId].every(value => uuid.test(value))) {
    throw new Error('Invalid mutation identifiers')
  }
  if (mutation.kind !== 'add' && (!Number.isSafeInteger(mutation.expectedVersion) || mutation.expectedVersion < 0)) {
    throw new Error('Missing valid expected version')
  }
  if (mutation.kind === 'add' && (!mutation.name.trim() || mutation.name.trim().length > 120)) {
    throw new Error('Invalid item name')
  }
  if (mutation.kind === 'update' && mutation.name === undefined && mutation.purchased === undefined && mutation.attributes === undefined) {
    throw new Error('Empty item update')
  }
  if (mutation.kind === 'update' && mutation.name !== undefined &&
      (!mutation.name.trim() || mutation.name.trim().length > 120)) {
    throw new Error('Invalid item name')
  }
  const args = {
    p_operation: mutation.operationId,
    p_list: mutation.listId,
    p_action: mutation.kind,
    p_item: mutation.itemId,
    p_name: mutation.kind === 'delete' ? null : mutation.name ?? null,
    p_purchased: mutation.kind === 'delete' ? null : mutation.purchased ?? null,
    p_expected_version: mutation.kind === 'add' ? null : mutation.expectedVersion,
  }
  const attributes = mutation.kind === 'delete' ? undefined : mutation.attributes
  const { data, error } = attributes
    ? await client.rpc('apply_e4_item_change', { ...args, p_quantity: attributes.quantity, p_unit: attributes.unit })
    : await client.rpc('apply_item_change', args)
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid mutation receipt')
  const receipt = data as Record<string, unknown>
  if (receipt.operation_id !== mutation.operationId ||
      !Number.isSafeInteger(receipt.list_revision) || (receipt.list_revision as number) < 0 ||
      !Number.isSafeInteger(receipt.item_version) || (receipt.item_version as number) < 0) {
    throw new Error('Invalid mutation receipt')
  }
  return {
    operationId: receipt.operation_id as string,
    listRevision: receipt.list_revision as number,
    itemVersion: receipt.item_version as number,
  }
}
