import type { SupabaseClient } from '@supabase/supabase-js'
import type { Storage } from './storage'
import { pullAccountFeed } from './account-feed'
import { readSyncEventBatch } from './sync-event-feed'

const unsupported = new WeakSet<object>()
type FeedStorage = Pick<Storage, 'readAccountFeedPosition' | 'applyAccountFeed'>

/** Use one feed, never v1 and v2 together. Missing RPC is the only fallback.
 * At most two fixed batches per invocation; the existing scheduler handles
 * later batches. A partial batch must not advance the durable cursor. */
export async function pullSemanticAccountFeed(client: Pick<SupabaseClient, 'rpc'>,
  storage: FeedStorage, accountId: string, isActive: () => boolean, onRequest: () => void = () => {}): Promise<boolean> {
  if (unsupported.has(client)) return pullAccountFeed(client, storage, accountId, isActive, onRequest)
  for (let count = 0; count < 2; count++) {
    const expected = await storage.readAccountFeedPosition(accountId)
    const batch = await readSyncEventBatch(client, accountId, expected, isActive, onRequest)
    if (batch.kind === 'unsupported') {
      unsupported.add(client)
      return pullAccountFeed(client, storage, accountId, isActive, onRequest)
    }
    const next = batch.kind === 'snapshot' ? batch.position : batch.through
    const changes = batch.kind === 'snapshot' ? batch.changes : batch.events.map(event => event.change)
    if (!isActive()) throw new Error('Account changed during feed synchronization')
    if (!await storage.applyAccountFeed(accountId, expected, next, changes, batch.kind === 'snapshot', isActive, batch)) return true
    if (batch.kind === 'snapshot' || batch.head === batch.through) return true
  }
  return true
}

/** Working builds on the pinned test lab exercise v2. Other installations
 * retain the existing contract until explicitly enabled at release. */
export const workspaceSemanticFeedEnabled = import.meta.env.VITE_SYNC_EVENTS === 'true' ||
  import.meta.env.VITE_SUPABASE_URL === 'https://gmrqeubhotjpmtwokfeq.supabase.co'
