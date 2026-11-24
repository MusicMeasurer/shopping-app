import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCloudListMetadata, type CloudListMetadata } from './e4-cloud-list-metadata'
import { parseRemoteItems, type RemoteItem } from './remote-snapshot'
import type { Storage } from './storage'

export type AccountFeedChange =
  | { entity: 'list'; listId: string; metadata: CloudListMetadata | null }
  | { entity: 'item'; listId: string; itemId: string; item: RemoteItem | null }

const pageSize = 200
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid account feed record')
  return raw as Record<string, unknown>
}

export function id(raw: unknown): string {
  if (typeof raw !== 'string' || !uuid.test(raw)) throw new Error('Invalid account feed identifier')
  return raw
}

export function position(raw: unknown): string {
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(raw) ||
      BigInt(raw) > 9223372036854775807n) throw new Error('Invalid account feed position')
  return raw
}

/** Shared parsers: legacy and semantic feeds use the same data validation. */
export function parseAccountFeedSnapshot(data: unknown, accountId: string): { next: string; changes: AccountFeedChange[] } {
  const row = record(data)
  const next = position(row.position)
  const lists = parseCloudListMetadata(row.lists, accountId)
  const listIds = new Set(lists.map(list => list.id))
  if (!Array.isArray(row.items)) throw new Error('Missing account snapshot items')
  const changes: AccountFeedChange[] = lists.map(metadata => ({ entity: 'list', listId: metadata.id, metadata }))
  for (const raw of row.items) {
    const listId = id(record(raw).list_id)
    if (!listIds.has(listId)) throw new Error('Account snapshot item has no list')
    const item = parseRemoteItems([raw], listId)[0]
    changes.push({ entity: 'item', listId, itemId: id(item.id), item })
  }
  return { next, changes }
}
export function parseAccountFeedChange(row: Record<string, unknown>, accountId: string): AccountFeedChange {
  const listId = id(row.list_id)
  const entityId = id(row.entity_id)
  if (typeof row.deleted !== 'boolean') throw new Error('Invalid account feed deletion')
  if (row.entity === 'list' && entityId === listId) {
    const metadata = row.deleted ? null : parseCloudListMetadata([row.snapshot], accountId)[0]
    if (metadata && metadata.id !== listId) throw new Error('Account feed list identity mismatch')
    return { entity: 'list', listId, metadata }
  } else if (row.entity === 'item') {
    const item = row.deleted ? null : parseRemoteItems([row.snapshot], listId)[0]
    if (item && item.id !== entityId) throw new Error('Account feed item identity mismatch')
    return { entity: 'item', listId, itemId: entityId, item }
  } else throw new Error('Unknown account feed entity')
}

export async function pullAccountFeed(
  client: Pick<SupabaseClient, 'rpc'>,
  storage: Pick<Storage, 'readAccountFeedPosition' | 'applyAccountFeed'>,
  accountId: string,
  isActive: () => boolean,
  onRequest: () => void = () => {},
): Promise<boolean> {
  let cursor = await storage.readAccountFeedPosition(accountId)
  const assertActive = () => {
    if (!isActive()) throw new Error('Account changed during feed synchronization')
  }
  const snapshot = async () => {
    assertActive()
    onRequest()
    const { data, error } = await client.rpc('snapshot_e4_account_changes', { p_account: accountId })
    if (error?.code === 'PGRST202' && cursor === undefined) return false
    if (error) throw error
    const { next, changes } = parseAccountFeedSnapshot(data, accountId)
    assertActive()
    await storage.applyAccountFeed(accountId, cursor, next, changes, true, isActive)
    cursor = next
    return true
  }
  if (cursor === undefined) return snapshot()
  while (isActive()) {
    onRequest()
    const { data, error } = await client.rpc('pull_e4_account_changes', { p_account: accountId, p_after: cursor, p_limit: pageSize })
    assertActive()
    if (error?.code === 'P0002') return snapshot()
    if (error) throw error
    if (!Array.isArray(data) || data.length > pageSize) throw new Error('Invalid account feed page')
    let next: string = cursor
    const changes: AccountFeedChange[] = []
    for (const raw of data) {
      const row = record(raw)
      const eventPosition = position(row.event_position)
      if (BigInt(eventPosition) !== BigInt(next) + 1n) throw new Error('Non-contiguous account feed page')
      next = eventPosition
      changes.push(parseAccountFeedChange(row, accountId))
    }
    if (!await storage.applyAccountFeed(accountId, cursor, next, changes, false, isActive)) return true
    cursor = next
    if (data.length < pageSize) return true
  }
  throw new Error('Account changed during feed synchronization')
}
