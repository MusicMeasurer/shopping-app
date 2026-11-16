import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListId, Item } from '../domain/shopping'
import type { Storage } from './storage'
import { mergeItemEdit, type ItemDeletionConflict } from './item-conflict'
import type { PendingItemOperation } from './pending-operations'
import { createSyncCoordinator } from './sync-coordinator'
import { fetchRemoteItems, fetchRemoteTombstones } from './remote-snapshot'
import { planVersionedTombstones } from './versioned-tombstone-plan'
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
  storage: Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'claimAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings' | 'commitAccountReceipt' | 'importRemoteOnlyBatch' | 'readAccountItemVersions' | 'applyReviewedRemoteDeletions' | 'reconcileRejectedEdit' | 'readSyncableAccountPending'>,
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  options: {
    accountId: string
    remoteListId: string
    localListId: ListId
    isActive: () => boolean
    onReconciled?: () => void
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
  async function previewDeletions() {
    assertActive()
    await verifyMapping()
    const [items, versions, pending, tombstones] = await Promise.all([
      storage.readAccountItems(accountId),
      storage.readAccountItemVersions(accountId),
      storage.readAccountPending(accountId),
      fetchRemoteTombstones(client, remoteListId),
    ])
    assertActive()
    const local = items.filter(item => item.listId === localListId)
    const plan = planVersionedTombstones(local, versions, tombstones, pending, remoteListId)
    const byId = new Map(local.map(item => [item.id, item]))
    return {
      ...plan,
      reviewItems: plan.confirmedDeletions.map(id => {
        const item = byId.get(id)
        if (!item) throw new Error('Deletion preview item missing')
        return { id: item.id, name: item.name }
      }),
    }
  }
  async function applyConfirmedDeletions(reviewedIds: readonly string[]): Promise<number> {
    assertActive()
    if (!reviewedIds.length || new Set(reviewedIds).size !== reviewedIds.length) {
      throw new Error('Explicit unique deletion selection is required')
    }
    await verifyMapping()
    const [items, versions, pending, initial] = await Promise.all([
      storage.readAccountItems(accountId), storage.readAccountItemVersions(accountId),
      storage.readAccountPending(accountId), fetchRemoteTombstones(client, remoteListId),
    ])
    assertActive()
    const local = items.filter(item => item.listId === localListId)
    const plan = planVersionedTombstones(local, versions, initial, pending, remoteListId)
    if (reviewedIds.some(id => !plan.confirmedDeletions.includes(id))) {
      throw new Error('Deletion selection contains an unresolved conflict')
    }
    const latest = await fetchRemoteTombstones(client, remoteListId)
    assertActive()
    const signature = (rows: typeof initial) => JSON.stringify(rows.map(row =>
      [row.id, row.listId, row.version, row.deletedAt]).sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))))
    if (signature(initial) !== signature(latest)) {
      throw new Error('Remote deletions changed during confirmation')
    }
    const byId = new Map(local.map(item => [item.id, item]))
    const known = new Map(versions.map(row => [row.itemId, row]))
    const tombstones = new Map(latest.map(row => [row.id, row]))
    const entries: { item: Item; expectedLocalVersion: number; serverDeletedVersion: number }[] =
      reviewedIds.map(id => {
        const item = byId.get(id)
        const version = known.get(id)
        const tombstone = tombstones.get(id)
        if (!item || !version || !tombstone || version.remoteListId !== remoteListId ||
            tombstone.version <= version.version) {
          throw new Error('Deletion selection no longer has safe version evidence')
        }
        return { item, expectedLocalVersion: version.version, serverDeletedVersion: tombstone.version }
      })
    assertActive()
    await storage.applyReviewedRemoteDeletions(accountId, remoteListId, entries)
    return entries.length
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
      ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
      ...(item.unit !== undefined ? { unit: item.unit } : {}),
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
    // Detect server edits that occurred while the first snapshot was being reviewed.
    // This is an optimistic check, not a server-side transaction or a lock.
    const latest = await fetchRemoteItems(client, remoteListId)
    assertActive()
    const signature = (rows: typeof remote) => JSON.stringify(rows.map(item => [
      item.id, item.listId, item.name, item.purchased, item.createdAt, item.version, item.quantity, item.unit,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    if (signature(remote) !== signature(latest)) {
      throw new Error('Remote list changed during import; retry comparison')
    }
    await storage.importRemoteOnlyBatch(accountId, remoteListId, entries)
    return entries.length
  }
  async function fetchItemState(itemId: string) {
    const rows = await fetchRemoteItems(client, remoteListId, true)
    const row = rows.find(item => item.id === itemId)
    const tombstone = row ? undefined : (await fetchRemoteTombstones(client, remoteListId)).find(item => item.id === itemId)
    assertActive()
    const item: Item | undefined = row && {
      id: row.id, listId: localListId, name: row.name, purchased: row.purchased,
      quantity: row.quantity, unit: row.unit, createdAt: Date.parse(row.createdAt),
    }
    return { item, version: row?.version ?? tombstone?.version, fieldChangedAt: row?.fieldChangedAt ?? {} }
  }

  async function handleRejected(operation: PendingItemOperation, error: unknown): Promise<boolean> {
    if (operation.kind !== 'cloud-update' && operation.kind !== 'cloud-delete') return false
    const message = (error as { message?: string } | null)?.message
    if (message !== 'Version conflict' && message !== 'Item unavailable') return false
    const state = await fetchItemState(operation.itemId)
    if (state.version === undefined || state.version <= operation.expectedVersion) return false
    const serverVersion = state.version
    const serverItem = state.item
    const identifiers = {
      operationId: crypto.randomUUID(), itemId: operation.itemId, remoteListId, localListId,
    }
    if (operation.kind === 'cloud-delete' && !serverItem) {
      await storage.reconcileRejectedEdit(accountId, operation, { serverVersion })
    } else if (!serverItem || operation.kind === 'cloud-delete') {
      const item = operation.kind === 'cloud-update' ? operation.item : serverItem
      if (!item) return false
      await storage.reconcileRejectedEdit(accountId, operation, { conflict: {
        ...identifiers, operationId: operation.operationId, item, remoteVersion: serverVersion,
        deleted: serverItem ? 'local' : 'cloud',
      } })
    } else {
      if (!operation.base || !operation.editTimes) {
        await storage.reconcileRejectedEdit(accountId, operation, { defer: true })
        return true
      }
      const item = mergeItemEdit(operation.base, operation.item, serverItem, operation.editTimes, state.fieldChangedAt)
      const changed = item.name !== serverItem.name || item.purchased !== serverItem.purchased ||
        item.quantity !== serverItem.quantity || item.unit !== serverItem.unit
      await storage.reconcileRejectedEdit(accountId, operation, {
        serverVersion, serverItem,
        replacement: changed ? {
          ...identifiers, kind: 'cloud-update', expectedVersion: serverVersion, item,
          base: serverItem, editTimes: operation.editTimes,
        } : undefined,
      })
    }
    options.onReconciled?.()
    return true
  }

  async function resolveItemDeletion(conflict: ItemDeletionConflict, keepItem: boolean) {
    await verifyMapping()
    const operation = (await storage.readAccountPending(accountId))
      .find(row => row.operationId === conflict.operationId)
    if (!operation || (operation.kind !== 'cloud-delete' && operation.kind !== 'cloud-update') ||
        operation.remoteListId !== remoteListId || operation.localListId !== localListId)
      throw new Error('Conflict is no longer available')
    const state = await fetchItemState(operation.itemId)
    if (state.version === undefined || Boolean(state.item) !== (conflict.deleted === 'local'))
      throw new Error('Cloud item changed; synchronize again')
    if (state.version !== conflict.remoteVersion) {
      if (!state.item) throw new Error('Cloud deletion changed; synchronize again')
      await storage.reconcileRejectedEdit(accountId, operation, { conflict: {
        ...conflict, item: state.item, remoteVersion: state.version,
      } })
      throw new Error('Cloud item changed; review the latest version')
    }
    const identifiers = { operationId: crypto.randomUUID(), remoteListId, localListId }
    let replacement
    if (keepItem && !state.item) {
      const item = { ...conflict.item, id: crypto.randomUUID(), createdAt: Date.now() }
      replacement = { ...identifiers, kind: 'cloud-add' as const, itemId: item.id, item }
    } else if (!keepItem && state.item) {
      replacement = {
        ...identifiers, kind: 'cloud-delete' as const, itemId: operation.itemId,
        expectedVersion: state.version, base: state.item,
      }
    }
    await storage.reconcileRejectedEdit(accountId, operation, {
      serverVersion: state.version, serverItem: keepItem ? state.item : undefined, replacement,
    })
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
      const rows = await storage.readSyncableAccountPending(accountId)
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
    claimPending: operationId => storage.claimAccountPending(accountId, operationId),
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
    handleRejected,
  }, list => {
    if (list !== remoteListId) throw new Error('Remote item belongs to another list')
    return localListId
  })
  return { ...coordinator, importRemoteOnly, previewDeletions, applyConfirmedDeletions, resolveItemDeletion }
}
