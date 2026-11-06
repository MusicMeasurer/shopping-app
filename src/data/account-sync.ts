import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListId } from '../domain/shopping'
import type { Storage } from './storage'
import type { PendingItemOperation } from './pending-operations'
import { createSyncCoordinator } from './sync-coordinator'
import { fetchRemoteItems } from './remote-snapshot'
import { applyRemoteMutation, type RemoteMutation } from './remote-mutation'
import { resolveVersionedMutation } from './versioned-mutation'

/**
 * Bind the headless coordinator to the existing account-scoped IndexedDB
 * stores. No guest data is ever read or uploaded. The remote list mapping
 * and version-aware mutation resolver must be supplied explicitly.
 *
 * Do not enable automatically on login: legacy operations have no remote
 * versions, and account-list bindings must be explicitly verified.
 */
export function createAccountSync(
  storage: Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings'>,
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  options: {
    accountId: string
    remoteListId: string
    localListId: ListId
    isActive: () => boolean
    resolveMutation?: (operation: PendingItemOperation) => RemoteMutation
  },
) {
  const { accountId, remoteListId, localListId, isActive, resolveMutation = resolveVersionedMutation } = options
  if (!accountId.trim() || !remoteListId.trim()) throw new Error('Account and remote list are required')
  const assertActive = () => {
    if (!isActive()) throw new Error('Account changed during synchronization')
  }
  const verifyMapping = async () => {
    assertActive()
    const mappings = await storage.readAccountListMappings(accountId)
    assertActive()
    if (!mappings.some(mapping => mapping.localListId === localListId && mapping.remoteListId === remoteListId)) {
      throw new Error('Missing verified account list mapping')
    }
  }
  return createSyncCoordinator({
    accountId,
    listId: remoteListId,
    isActive,
    readLocal: async () => {
      assertActive()
      await verifyMapping()
      const rows = await storage.readAccountItems(accountId)
      assertActive()
      return rows.filter(item => item.listId === localListId)
    },
    readPending: async () => {
      assertActive()
      await verifyMapping()
      const rows = await storage.readAccountPending(accountId)
      assertActive()
      // Do not silently skip pending deletions: they have no listId in
      // the current schema. Reject mixed/unresolvable queues instead.
      for (const operation of rows) {
        if (operation.kind === 'upsert' && operation.item.listId !== localListId) {
          throw new Error('Account queue contains operations for another list')
        }
        if ((operation.kind === 'cloud-add' || operation.kind === 'cloud-update' || operation.kind === 'cloud-delete') &&
            (operation.remoteListId !== remoteListId || operation.localListId !== localListId)) {
          throw new Error('Account queue contains operations for another list')
        }
        if (operation.kind === 'delete') {
          throw new Error('Pending deletion requires a durable list mapping')
        }
      }
      return rows
    },
    acknowledge: async operationId => {
      assertActive()
      await storage.acknowledgeAccountPending(accountId, operationId)
    },
    fetch: () => fetchRemoteItems(client, remoteListId),
    send: mutation => applyRemoteMutation(client, mutation),
    resolveMutation,
  }, list => {
    if (list !== remoteListId) throw new Error('Remote item belongs to another list')
    return localListId
  })
}
