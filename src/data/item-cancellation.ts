import type { SupabaseClient } from '@supabase/supabase-js'
import type { Item } from '../domain/shopping'
import type { CloudPendingOperation } from './pending-operations'
import type { Storage } from './storage'
import { resolveVersionedMutation } from './versioned-mutation'
import { remoteMutationPayload } from './remote-mutation'
import { parseRemoteItems } from './remote-snapshot'

export interface ItemCancellation {
  cancellationId: string
  operation: Extract<CloudPendingOperation, { kind: 'cloud-add' | 'cloud-update' | 'cloud-delete' }>
}
export interface ItemCancellationReceipt {
  operationId: string; cancellationId: string; remoteListId: string; itemId: string
  status: 'cancelled' | 'superseded'; version: number | null; item?: Item
}
export type CancellationStorage = Pick<Storage,'readAccountItemCancellations'|'beginAccountItemCancellation'|
  'commitAccountItemCancellation'|'markAccountItemSyncFailed'>

export function parseItemCancellationReceipt(value: unknown, cancellation: ItemCancellation): ItemCancellationReceipt {
  const op = cancellation.operation
  if (!value || typeof value !== 'object') throw new Error('Invalid item cancellation result')
  const row = value as Record<string,unknown>
  if (row.operation_id !== op.operationId || row.cancellation_id !== cancellation.cancellationId ||
      row.list_id !== op.remoteListId || row.item_id !== op.itemId ||
      (row.status !== 'cancelled' && row.status !== 'superseded') ||
      (row.item_version !== null && (!Number.isSafeInteger(row.item_version) || (row.item_version as number) < 1)))
    throw new Error('Invalid item cancellation identity or version')
  const version = row.item_version as number | null
  let item: Item | undefined
  if (row.item !== null) {
    if (!row.item || typeof row.item !== 'object' || version === null) throw new Error('Invalid cancellation snapshot')
    const remote = parseRemoteItems([{ ...row.item, list_id: op.remoteListId, version }],op.remoteListId)[0]
    if (remote.id !== op.itemId) throw new Error('Cancellation item mismatch')
    item = { id: remote.id, listId: op.localListId, name: remote.name, purchased: remote.purchased,
      quantity: remote.quantity, unit: remote.unit, createdAt: Date.parse(remote.createdAt) }
  }
  return { operationId: op.operationId, cancellationId: cancellation.cancellationId, remoteListId: op.remoteListId,
    itemId: op.itemId, status: row.status, version, item }
}
export async function sendItemCancellation(client: Pick<SupabaseClient,'rpc'>, cancellation: ItemCancellation) {
  const op = cancellation.operation
  if (op.kind === 'cloud-update' && !op.base) throw new Error('Missing confirmed item snapshot')
  const before = op.kind === 'cloud-update' && op.base ? { name: op.base.name, purchased: op.base.purchased,
    quantity: op.base.quantity ?? null, unit: op.base.unit ?? null } : null
  const payload = { p_cancel: cancellation.cancellationId, p_original: remoteMutationPayload(resolveVersionedMutation(op)) }
  const {data,error} = op.kind === 'cloud-delete'
    ? await client.rpc('cancel_e4_item_delete',payload)
    : await client.rpc('cancel_e4_item_edit',{ ...payload, p_before: before })
  if (error) throw error
  return parseItemCancellationReceipt(data,cancellation)
}
/** Called inside the existing serialized account flush. No new polling. */
export async function flushItemCancellations(storage: CancellationStorage, client: Pick<SupabaseClient,'rpc'>,
  accountId: string, isActive: () => boolean, onReconciled: () => void, onlyListId?: string, onlyItemId?: string) {
  let failure: unknown
  for (const cancellation of await storage.readAccountItemCancellations(accountId)) {
    const op = cancellation.operation
    if (!isActive()) break
    if ((onlyListId && op.localListId !== onlyListId) || (onlyItemId && op.itemId !== onlyItemId)) continue
    try {
      if (!await storage.beginAccountItemCancellation(accountId,cancellation) || !isActive()) continue
      const receipt = await sendItemCancellation(client,cancellation)
      if (!isActive()) break
      await storage.commitAccountItemCancellation(accountId,cancellation,receipt)
      onReconciled()
    } catch (error) {
      if (isActive()) await storage.markAccountItemSyncFailed(accountId,op.operationId,cancellation.cancellationId)
      failure ??= error
    }
  }
  return failure
}
