import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Read-only server snapshot for a single list. The caller must have a
 * server-verified account session; Supabase RLS remains the access boundary.
 * Never replace local state with this result until pending writes are reconciled.
 */
export interface RemoteItem {
  id: string
  listId: string
  name: string
  purchased: boolean
  createdAt: string
  version: number
}

export async function fetchRemoteItems(client: Pick<SupabaseClient, 'from'>, listId: string): Promise<RemoteItem[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listId)) {
    throw new Error('Invalid remote list ID')
  }
  const { data, error } = await client.from('shopping_items')
    .select('id,list_id,name,purchased,created_at,version')
    .eq('list_id', listId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid remote snapshot')
  return data.map((row: unknown): RemoteItem => {
    if (!row || typeof row !== 'object') throw new Error('Invalid remote item')
    const value = row as Record<string, unknown>
    if (typeof value.id !== 'string' || typeof value.list_id !== 'string' ||
        value.list_id !== listId || typeof value.name !== 'string' ||
        !value.name.trim() || typeof value.purchased !== 'boolean' ||
        typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
        !Number.isSafeInteger(value.version) || (value.version as number) < 0) {
      throw new Error('Invalid remote item')
    }
    return {
      id: value.id, listId: value.list_id, name: value.name,
      purchased: value.purchased, createdAt: value.created_at,
      version: value.version as number,
    }
  })
}

/** Deleted server rows are tombstones, not missing items. Never apply them blindly. */
export interface RemoteTombstone {
  id: string
  listId: string
  version: number
  deletedAt: string
}

export async function fetchRemoteTombstones(client: Pick<SupabaseClient, 'from'>, listId: string): Promise<RemoteTombstone[]> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(listId)) {
    throw new Error('Invalid remote list ID')
  }
  const { data, error } = await client.from('shopping_items')
    .select('id,list_id,version,deleted_at')
    .eq('list_id', listId)
    .not('deleted_at', 'is', null)
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid tombstone snapshot')
  return data.map((row: unknown): RemoteTombstone => {
    if (!row || typeof row !== 'object') throw new Error('Invalid tombstone')
    const value = row as Record<string, unknown>
    if (typeof value.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
        value.list_id !== listId || !Number.isSafeInteger(value.version) ||
        (value.version as number) < 0 || typeof value.deleted_at !== 'string' ||
        !Number.isFinite(Date.parse(value.deleted_at))) throw new Error('Invalid tombstone')
    return { id: value.id, listId, version: value.version as number, deletedAt: value.deleted_at }
  })
}
