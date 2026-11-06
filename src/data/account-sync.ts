import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListId } from '../domain/shopping'
import type { Storage } from './storage'
import type { PendingItemOperation } from './pending-operations'
import { createSyncCoordinator } from './sync-coordinator'
import { fetchRemoteItems } from './remote-snapshot'
import { planReconciliation } from './reconciliation-plan'
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
  storage: Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings' | 'commitAccountReceipt' | 'importRemoteOnlyBatch'>,
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
  async function importRemoteOnly(): Promise<number> {
    assertActive()
    await verifyMapping()
    const [local, pending, remote] = await Promise.all([
      storage.readAccountItems(accountId),
      storage.readAccountPending(accountId),
      fetchRemoteItems(client, remoteListId),
    ])
    assertActive()
    const localItems = local.filter(item => item.listId === localListId)
    const remoteItems = remote.map(item => ({
      id: item.id, listId: localListId, name: item.name,
      purchased: item.purchased, createdAt: Date.parse(item.createdAt),
    }))
    const plan = planReconciliation(localItems, remoteItems, pending)
    if (plan.conflicts.length) throw new Error('Resolve conflicting items before import')
    const remoteById = new Map(remote.map(item => [item.id, item]))
    const entries = plan.remoteOnly.map(item => {
      const source = remoteById.get(item.id)
      if (!source) throw new Error('Missing remote item version')
      return { item, version: source.version }
    })
    assertActive()
    await storage.importRemoteOnlyBatch(accountId, remoteListId, entries)
    return entries.length
  }
  const coordinator = createSyncCoordinator({
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
      // Versioned operations carry durable list identity and can safely
      // be processed one list at a time. Legacy deletes have no list
      // identity; fail closed rather than guess which list owns them.
      if (rows.some(operation => operation.kind === 'delete')) {
        throw new Error('Pending deletion requires a durable list mapping')
      }
      return rows.filter(operation => {
        if (operation.kind === 'upsert') return operation.item.listId === localListId
        if (operation.kind === 'delete') throw new Error('Pending deletion requires a durable list mapping')
        return operation.localListId === localListId && operation.remoteListId === remoteListId
      })
    },
    acknowledge: async operationId => {
      assertActive()
      await storage.acknowledgeAccountPending(accountId, operationId)
    },
    fetch: () => fetchRemoteItems(client, remoteListId),
    send: mutation => applyRemoteMutation(client, mutation),
    commitReceipt: async (mutation, receipt) => {
      assertActive()
      await storage.commitAccountReceipt(accountId, mutation.operationId, mutation.listId, mutation.itemId, receipt.itemVersion)
    },
    resolveMutation,
  }, list => {
    if (list !== remoteListId) throw new Error('Remote item belongs to another list')
    return localListId
  })
  return { ...coordinator, importRemoteOnly }
}
