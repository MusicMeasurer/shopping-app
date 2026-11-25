import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListId, Item } from '../domain/shopping'
import { duplicatedItems, itemNameKey, matchingNamePair, sameItemSnapshot, type ItemNameDecision } from '../domain/item-names'
import type { Storage, VersionedItemChange } from './storage'
import { syncLedger } from './list-sync-ledger'
import { mergeItemEdit, type ItemDeletionConflict } from './item-conflict'
import type { PendingItemOperation } from './pending-operations'
import { createSyncCoordinator } from './sync-coordinator'
import { fetchRemoteItems, fetchRemoteTombstones, type RemoteItem } from './remote-snapshot'
import { planVersionedTombstones } from './versioned-tombstone-plan'
import { planReconciliation } from './reconciliation-plan'
import { applyRemoteMutation, type RemoteMutation } from './remote-mutation'
import { resolveVersionedMutation } from './versioned-mutation'

const itemFlushes = new WeakMap<object, Map<string, Promise<unknown>>>()

/** Batch upload and list-specific flushes consume the same durable receipts. */
export async function serializeAccountItemFlush<T>(storage: object, accountId: string, flush: () => Promise<T>): Promise<T> {
  let accounts = itemFlushes.get(storage)
  if (!accounts) {
    accounts = new Map()
    itemFlushes.set(storage, accounts)
  }
  const previous = accounts.get(accountId)
  const current = previous ? previous.then(flush, flush) : Promise.resolve().then(flush)
  accounts.set(accountId, current)
  try {
    return await current
  } finally {
    if (accounts.get(accountId) === current) accounts.delete(accountId)
  }
}

/**
 * Bind the headless coordinator to the existing account-scoped IndexedDB
 * stores. No guest data is ever read or uploaded. The remote list mapping
 * and version-aware mutation resolver must be supplied explicitly.
 *
 * Do not enable automatically on login: legacy operations have no remote
 * versions, and account-list bindings must be explicitly verified.
 */
export function createAccountSync(
  storage: Pick<Storage, 'readAccountItems' | 'readAccountPending' | 'claimAccountPending' | 'acknowledgeAccountPending' | 'readAccountListMappings' | 'commitAccountReceipt' | 'importRemoteOnlyBatch' | 'readAccountItemVersions' | 'applyReviewedRemoteDeletions' | 'reconcileRejectedEdit' | 'readSyncableAccountPending' | 'applyVersionedItemChanges'>,
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
  const ledger = syncLedger(storage)
  const activeOperations = new Set<string>()
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

  const pendingIds = (pending: readonly PendingItemOperation[]) => new Set(pending.map(operation =>
    operation.kind === 'upsert' ? operation.item.id : operation.itemId))
  const asLocal = (item: RemoteItem): Item => ({
    id: item.id, listId: localListId, name: item.name, purchased: item.purchased,
    createdAt: Date.parse(item.createdAt),
    ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
    ...(item.unit !== undefined ? { unit: item.unit } : {}),
  })
  async function importRemoteOnly({ reconcileNames = false } = {}): Promise<number> {
    assertActive()
    await verifyMapping()
    const [local, pending, remote, versions] = await Promise.all([
      storage.readAccountItems(accountId),
      storage.readAccountPending(accountId),
      fetchRemoteItems(client, remoteListId),
      reconcileNames ? storage.readAccountItemVersions(accountId) : [],
    ])
    assertActive()
    const localItems = local.filter(item => item.listId === localListId)
    const remoteItems = remote.map(asLocal)
    const plan = planReconciliation(localItems, remoteItems, pending)
    if (!reconcileNames && plan.conflicts.length) throw new Error('Resolve conflicting items before import')
    const remoteById = new Map(remote.map(item => [item.id, item]))
    const entries = plan.remoteOnly.map(item => {
      const source = remoteById.get(item.id)
      if (!source) throw new Error('Missing remote item version')
      return { item, version: source.version }
    })
    const remoteChanges: VersionedItemChange[] = []
    if (reconcileNames) {
      const localDuplicates = duplicatedItems(localItems).flat()
      const nameEvidence = new Set([...localDuplicates, ...duplicatedItems(remoteItems).flat()].map(item => item.id))
      const activeNames = new Set(remoteItems.map(item => itemNameKey(item.name)))
      const missingDuplicates = localDuplicates.filter(item =>
        !remoteById.has(item.id) && activeNames.has(itemNameKey(item.name)))
      const tombstones = missingDuplicates.length ? await fetchRemoteTombstones(client, remoteListId) : []
      const deleted = new Map(tombstones.map(row => [row.id, row.version]))
      const canSync = new Map(versions.filter(row => row.remoteListId === remoteListId)
        .map(row => [row.itemId, row.version]))
      const pendingItemIds = pendingIds(pending)
      const candidates = new Set(missingDuplicates.map(item => item.id))
      for (const before of localItems) {
        if (pendingItemIds.has(before.id)) continue
        const expectedVersion = canSync.get(before.id)
        const source = remoteById.get(before.id)
        const version = source?.version ?? (candidates.has(before.id) ? deleted.get(before.id) : undefined)
        if (version === undefined || expectedVersion === undefined || version <= expectedVersion) continue
        const after = source && asLocal(source)
        // A newer confirmed amount and purchase state can replace the cache
        // when no local write is queued. Renames and deletions still require
        // the existing name-conflict evidence.
        if (!nameEvidence.has(before.id) && (!after || before.name !== after.name)) continue
        remoteChanges.push({ before, expectedVersion, version, after })
      }
    }
    // Confirm that the reviewed remote snapshot is still current before importing.
    const latest = await fetchRemoteItems(client, remoteListId)
    assertActive()
    const signature = (rows: typeof remote) => JSON.stringify(rows.map(item => [
      item.id, item.listId, item.name, item.purchased, item.createdAt, item.version, item.quantity, item.unit,
    ]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))
    if (signature(remote) !== signature(latest)) {
      throw new Error('Remote list changed during import; retry comparison')
    }
    const feedId = 'legacy-feed:' + localListId
    if (entries.length || remoteChanges.length) ledger?.begin(accountId, feedId, [localListId], 'feed', false, 'items')
    let changed = 0
    try {
      await storage.importRemoteOnlyBatch(accountId, remoteListId, entries)
      assertActive()
      changed = remoteChanges.length
        ? await storage.applyVersionedItemChanges(accountId, localListId, remoteListId, remoteChanges)
        : 0
      if (entries.length || changed) ledger?.confirm(accountId, feedId, [localListId])
      else if (remoteChanges.length) ledger?.cancel(accountId, feedId)
    } catch (error) {
      if (isActive()) ledger?.fail(accountId, feedId)
      else ledger?.cancel(accountId, feedId)
      throw error
    }
    // Unrelated confirmed imports can proceed while an item has a pending edit.
    const processed = new Set(remoteChanges.map(entry => entry.before.id))
    if (reconcileNames && entries.length === 0 && changed === 0 &&
        plan.conflicts.some(id => !processed.has(id) && !pendingIds(pending).has(id))) {
      throw new Error('Resolve conflicting items before import')
    }
    return entries.length + changed
  }

  async function resolveItemName(decision: ItemNameDecision) {
    await verifyMapping()
    const { operationId, keep, change, name } = decision
    if (!matchingNamePair(keep, change) || change.listId !== localListId) throw new Error('Name conflict changed')
    const [items, pending, versions] = await Promise.all([
      storage.readAccountItems(accountId), storage.readAccountPending(accountId), storage.readAccountItemVersions(accountId),
    ])
    assertActive()
    const versionsForList = new Map(versions.filter(row => row.remoteListId === remoteListId)
      .map(row => [row.itemId, row.version]))
    const pendingItemIds = pendingIds(pending)
    const confirmed = (item: Item) => {
      const cached = items.find(row => row.id === item.id)
      const version = versionsForList.get(item.id)
      if (!cached || !sameItemSnapshot(cached, item) || version === undefined || pendingItemIds.has(item.id))
        throw new Error('Name conflict changed')
      return version
    }
    const keepVersion = confirmed(keep)
    const changeVersion = confirmed(change)
    const { data, error } = await client.rpc('resolve_e4_item_name_conflict', {
      p_operation: operationId, p_list: remoteListId, p_keep: keep.id, p_keep_version: keepVersion,
      p_change: change.id, p_change_version: changeVersion, p_name: name ?? null,
    })
    assertActive()
    if (error) throw error
    if (data?.operation_id !== operationId || !Number.isSafeInteger(data.item_version) ||
        data.item_version <= changeVersion) throw new Error('Invalid name resolution receipt')
    await storage.applyVersionedItemChanges(accountId, localListId, remoteListId, [{
      before: change, expectedVersion: changeVersion, version: data.item_version,
      after: name === undefined ? undefined : { ...change, name },
    }])
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
    send: async mutation => {
      activeOperations.add(mutation.operationId)
      ledger?.begin(accountId, mutation.operationId, [localListId], 'items')
      try { return await applyRemoteMutation(client, mutation) }
      catch (error) { if (isActive()) ledger?.fail(accountId, mutation.operationId); throw error }
    },
    commitReceipt: async (mutation, receipt) => {
      assertActive()
      try {
        await storage.commitAccountReceipt(accountId, mutation.operationId, mutation.listId, mutation.itemId, receipt.itemVersion)
        activeOperations.delete(mutation.operationId)
      } catch (error) { if (isActive()) ledger?.fail(accountId, mutation.operationId); throw error }
    },
    resolveMutation,
    handleRejected,
  }, list => {
    if (list !== remoteListId) throw new Error('Remote item belongs to another list')
    return localListId
  })
  return {
    ...coordinator,
    flush: () => serializeAccountItemFlush(storage, accountId, async () => {
      try { return await coordinator.flush() }
      finally {
        if (!isActive()) for (const id of activeOperations) ledger?.cancel(accountId, id)
        activeOperations.clear()
      }
    }),
    handleRejected, importRemoteOnly, previewDeletions, applyConfirmedDeletions, resolveItemDeletion, resolveItemName,
  }
}
