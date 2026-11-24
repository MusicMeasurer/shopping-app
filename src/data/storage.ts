import type { AccountFeedChange } from './account-feed'
import { newSemanticState, rememberContext, rememberOwnOperation, storeSemanticBatch, evaluateSemanticState, semanticReady, presentSemanticNotice, acknowledgeSemanticNotice, consumeSilentRecovery, type AccountSemanticState, type SemanticBatch } from './sync-event-state'
import type { ReconciledSyncContext } from './sync-event-fate'
import { recordEditTimes, type ItemDeletionConflict } from './item-conflict'
import { openDB, type DBSchema, type IDBPObjectStore } from 'idb'
import { MAX_LOCAL_PROFILES, profileName, addProfile, bindProfile, initializeProfiles, switchProfile, removeProfileMetadata, type LocalProfileRegistry } from './local-profiles'
import { hasItemName, itemNameKey, matchingNamePair, sameItemSnapshot } from '../domain/item-names'
import { ItemSaveError } from './item-save-error'
import { lists as defaultLists, type Item } from '../domain/shopping'
import { ListMergeConflict, planListMerge, sameMergeSnapshot, type ListMergeSnapshot, type MergeChoice } from '../domain/list-merge'
import type { CloudArchiveCompletion } from './cloud-archive'
import type { CloudListChange } from './e4-cloud-list-operations'
import type { CloudListMetadata } from './e4-cloud-list-metadata'
import type { CompletionMode } from './cloud-completion-rpc'
import type { PendingItemOperation, CloudPendingOperation } from './pending-operations'

function listNameKey(name: string) {
  return name.trim().toLowerCase()
}

function assertFreeListName(lists: readonly { id: string; name: string }[], id: string, name: string) {
  if (lists.some(list => list.id !== id && listNameKey(list.name) === listNameKey(name)))
    throw new Error('Список с таким названием уже существует.')
}

function checkItemNames(existing: Item[], updates: readonly Item[]) {
  const byId = new Map(existing.map(item => [item.id, item]))
  for (const item of updates) {
    const previous = byId.get(item.id)
    if ((!previous || previous.listId !== item.listId || itemNameKey(previous.name) !== itemNameKey(item.name)) &&
        hasItemName([...byId.values()], item.listId, item.name, item.id))
      throw new ItemSaveError('Товар с таким названием уже есть в списке.')
    byId.set(item.id, item)
  }
}

function checkNamePair(keep: Item | undefined, change: Item | undefined, expectedKeep: Item, expectedChange: Item) {
  if (!keep || !change || !matchingNamePair(keep, change) ||
      !sameItemSnapshot(keep, expectedKeep) || !sameItemSnapshot(change, expectedChange))
    throw new ItemSaveError('Товары изменились. Проверьте конфликт ещё раз.')
}

export interface VersionedItemChange {
  before: Item
  expectedVersion: number
  after?: Item
  version: number
}

export interface CloudCompletionIntent {
  operationId: string; accountId: string; localListId: string; remoteListId: string;
  expectedRevision: number; mode: CompletionMode;
  itemIds: string[]; createdAt: number
}
export interface CloudCompletionRequest {
  operationId: string
  accountId: string
  localListId: string
  remoteListId: string
  name: string
  mode: CompletionMode
  confirmedMarked?: boolean
  localKind?: ShoppingListRecord['kind']
  fromLocalCopy?: boolean
  confirmedItemIds?: readonly string[]
  createdAt: number
}
interface ScopedCompletionRequest extends CloudCompletionRequest { key: string; items: string }

type CompletionItems = [string, string, boolean, number | null, string | null][]

function completionArchive(request: ScopedCompletionRequest, id: string): CloudArchiveCompletion | undefined {
  if (request.mode === 'delete_list' || request.mode === 'none_purchased') return
  const items = (JSON.parse(request.items) as CompletionItems)
    .filter(([, , purchased]) => request.mode === 'all_purchased' || purchased)
    .map(([, name, , quantity, unit], ordinal) => ({ name, quantity, unit, ordinal }))
  if (items.length) return {
    id, operationId: request.operationId, sourceListId: request.remoteListId, sourceListName: request.name,
    completedAt: new Date(request.createdAt).toISOString(), items,
  }
}


function completionItemSnapshot(items: Item[]): string {
  return JSON.stringify(items.map(item => [item.id, item.name, item.purchased, item.quantity, item.unit])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0]))))
}
interface ScopedCompletionIntent { key: string; accountId: string; intent: CloudCompletionIntent }
export interface AccountDraftList extends ShoppingListRecord {
  accountId: string
  operationId: string
  nameConflict?: boolean
}
interface ScopedDraftList extends AccountDraftList { key: string }
type ListMetadata = Pick<CloudListMetadata, 'name' | 'kind' | 'position' | 'updatedAt'>
export interface LocalListChange {
  operationId: string
  sequence: number
  localListId: string
  remoteListId: string
  change: CloudListChange
  before: ListMetadata
  targetId?: string
  prepared?: CloudListMetadata
}
export interface QueuedListMerge {
  operationId: string
  expected: ListMergeSnapshot
  choices: [string, MergeChoice][]
  result: Item[]
  source: { localListId: string; remoteListId: string }
  target: { localListId: string; remoteListId: string }
  revisions?: { sourceRevision: number; targetRevision: number }
}
interface ScopedListMapping {
  key: string; accountId: string; localListId: string; remoteListId: string
  symbol?: string; metadata?: ListMetadata; cloudRevision?: number; pendingMetadata?: LocalListChange[]; pendingMerge?: QueuedListMerge
}

function mergeTouches(merge: QueuedListMerge | undefined, id: string) {
  return merge?.source.localListId === id || merge?.target.localListId === id
}

function mergeSnapshot(mappings: ScopedListMapping[], items: Item[], sourceId: string, targetId: string): ListMergeSnapshot {
  const metadata = projectListMetadata(mappings)
  const source = metadata.get(sourceId)
  const target = metadata.get(targetId)
  if (!source || !target || sourceId === targetId) throw new ListMergeConflict()
  return { source: { id: sourceId, name: source.name, kind: source.kind },
    target: { id: targetId, name: target.name, kind: target.kind },
    items: items.filter(item => item.listId === sourceId || item.listId === targetId) }
}

function orderedListChanges(mappings: ScopedListMapping[]) {
  return mappings.flatMap(row => row.pendingMetadata ?? []).sort((a, b) => a.sequence - b.sequence)
}

function projectListMetadata(mappings: ScopedListMapping[]) {
  const lists = new Map<string, ListMetadata>(mappings.flatMap(row => row.metadata ? [[row.localListId, { ...row.metadata }] as const] : []))
  for (const { localListId, change } of orderedListChanges(mappings)) {
    const list = lists.get(localListId)
    if (!list) continue
    if (change.action === 'rename') list.name = change.name
    else if (change.action === 'kind') list.kind = change.kind
    else {
      for (const other of lists.values()) {
        if (other === list) continue
        if (other.position >= change.position && other.position < list.position) other.position++
        else if (other.position <= change.position && other.position > list.position) other.position--
      }
      list.position = change.position
    }
  }
  return lists
}
interface ScopedOperation {
  key: string
  accountId: string
  operation: PendingItemOperation
  queuedAt?: number
  neverDispatched?: boolean
  conflict?: ItemDeletionConflict
  deferred?: boolean
}
interface ScopedVersion { key: string; accountId: string; itemId: string; remoteListId: string; version: number }
interface ScopedItem { key: string; accountId: string; item: Item }
export interface ShoppingListRecord {
  id: string; name: string; symbol: string; kind: 'permanent' | 'oneoff'; createdAt: number; position?: number
}
export interface ArchivedListRecord {
  id: string; sourceListId: string; name: string; kind: 'permanent' | 'oneoff'; completedAt: number; items: Item[]
}
function checkConfirmedPurchases(items: Item[], confirmedItemIds?: readonly string[]): void {
  const markedIds = items.filter(item => item.purchased).map(item => item.id)
  if (!confirmedItemIds?.length || markedIds.length !== confirmedItemIds.length ||
      markedIds.some(id => !confirmedItemIds.includes(id))) {
    throw new Error('Список изменился. Проверьте отметки и подтвердите перенос заново.')
  }
}

function itemsForCompletion(items: Item[], mode: Exclude<CompletionMode, 'delete_list'>): Item[] {
  if (mode === 'none_purchased') return []
  if (mode === 'all_purchased') return items.map(item => ({ ...item, purchased: true }))
  const marked = items.filter(item => item.purchased)
  if (!marked.length) throw new Error('Нет отмеченных товаров')
  return marked
}
interface ProfileOwnedRecord<T> { key: string; profileId: string; record: T }
interface GuestImport {
  key: string; accountId: string; operationId: string; imported: boolean
  lists: ShoppingListRecord[]; items: Item[]; archives: ArchivedListRecord[]
  collisionMode?: 'separate' | 'merge'
  removeSource?: boolean
  archiveOnly?: boolean
}
interface AccountDeletionRecord {
  accountId: string
  purged: boolean
  acknowledged: boolean
}
interface ShoppingDB extends DBSchema {
  installationIdentity: { key: string; value: { id: string; proof: string } }
  accountDeletions: { key: string; value: AccountDeletionRecord }
  guestImports: { key: string; value: GuestImport }
  profileLists: { key: string; value: ProfileOwnedRecord<ShoppingListRecord>; indexes: { byProfile: string } }
  profileItems: { key: string; value: ProfileOwnedRecord<Item>; indexes: { byProfile: string } }
  profileArchives: { key: string; value: ProfileOwnedRecord<ArchivedListRecord>; indexes: { byProfile: string } }
  profilePendingOperations: { key: string; value: ProfileOwnedRecord<PendingItemOperation>; indexes: { byProfile: string } }
  profileMigrations: { key: string; value: { key: string; profileId: string; completedAt: number } }
  profileCutover: { key: string; value: { key: string; profileId: string; activatedAt: number } }
  localProfileRegistry: { key: string; value: { key: string; registry: LocalProfileRegistry } }
  lists: { key: string; value: ShoppingListRecord }
  archives: { key: string; value: ArchivedListRecord }
  items: { key: string; value: Item }
  accountItems: { key: string; value: ScopedItem; indexes: { byAccount: string } }
  pendingOperations: { key: string; value: PendingItemOperation }
  accountOperations: { key: string; value: ScopedOperation; indexes: { byAccount: string } }
  accountDraftLists: { key: string; value: ScopedDraftList; indexes: { byAccount: string } }
  accountArchiveCache: { key: string; value: { accountId: string; snapshots: CloudArchiveCompletion[]; awaitingRefresh?: string[] } }
  accountCompletionRequests: { key: string; value: ScopedCompletionRequest; indexes: { byAccount: string } }
  accountCompletions: { key: string; value: ScopedCompletionIntent; indexes: { byAccount: string } }
  accountListMappings: { key: string; value: ScopedListMapping; indexes: { byAccount: string } }
  accountFeed: { key: string; value: { accountId: string; position: string; deferred: AccountFeedChange[] } }
  accountSyncEvents: { key: string; value: AccountSemanticState }
  accountItemVersions: { key: string; value: ScopedVersion; indexes: { byAccount: string } }
}
function accountKey(accountId: string, operationId: string): string {
  if (!accountId.trim() || !operationId.trim()) throw new Error('Account and operation IDs are required')
  return JSON.stringify([accountId, operationId])
}
export function createStorage(name = 'shopping-app') {
  const blockedListeners = new Set<() => void>()
  let upgradeBlocked = false
  const database = openDB<ShoppingDB>(name, 19, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('installationIdentity')) db.createObjectStore('installationIdentity')
      if (!db.objectStoreNames.contains('accountDeletions')) db.createObjectStore('accountDeletions', { keyPath: 'accountId' })
      if (!db.objectStoreNames.contains('accountFeed')) db.createObjectStore('accountFeed', { keyPath: 'accountId' })
      if (!db.objectStoreNames.contains('accountSyncEvents')) db.createObjectStore('accountSyncEvents', { keyPath: 'accountId' })
      if (!db.objectStoreNames.contains('guestImports')) db.createObjectStore('guestImports', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('pendingOperations')) db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
      if (!db.objectStoreNames.contains('accountArchiveCache')) db.createObjectStore('accountArchiveCache', { keyPath: 'accountId' })
      if (!db.objectStoreNames.contains('accountDraftLists')) {
        const store = db.createObjectStore('accountDraftLists', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountCompletionRequests')) {
        const store = db.createObjectStore('accountCompletionRequests', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountCompletions')) {
        const store = db.createObjectStore('accountCompletions', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountOperations')) {
        const store = db.createObjectStore('accountOperations', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountItems')) {
        const store = db.createObjectStore('accountItems', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountListMappings')) {
        const store = db.createObjectStore('accountListMappings', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      if (!db.objectStoreNames.contains('accountItemVersions')) {
        const store = db.createObjectStore('accountItemVersions', { keyPath: 'key' })
        store.createIndex('byAccount', 'accountId')
      }
      for (const storeName of ['profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations'] as const) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'key' })
          store.createIndex('byProfile', 'profileId')
        }
      }
      if (!db.objectStoreNames.contains('profileMigrations')) db.createObjectStore('profileMigrations', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('profileCutover')) db.createObjectStore('profileCutover', { keyPath: 'key' })
      // Additive v8 metadata only. Legacy lists, items, archives and queues remain untouched.
      if (!db.objectStoreNames.contains('localProfileRegistry')) db.createObjectStore('localProfileRegistry', { keyPath: 'key' })
      // Additive upgrade from E3 v6 and from E4 v3. Never delete or overwrite data.
      if (!db.objectStoreNames.contains('lists')) {
        db.createObjectStore('lists', { keyPath: 'id' })
        for (const list of defaultLists) void tx.objectStore('lists').put({ ...list, kind: 'permanent', createdAt: 0 })
      }
      if (!db.objectStoreNames.contains('archives')) db.createObjectStore('archives', { keyPath: 'id' })

    },
    // The v14 barrier closes pre-consent v13 writers before source snapshots
    // can be frozen or removed. Older builds cannot reopen this database.
    // Uncooperative connections block the upgrade; no transfer can start then.
    blocking() { void database.then(db => db.close()) },
    blocked() {
      upgradeBlocked = true
      for (const listener of blockedListeners) listener()
    },
  })
  /** The fence is checked inside the SAME readwrite transaction as a legacy mutation.
   * New clients cannot race the cutover marker. Already-open older builds
   * lack this guard and still require separate version coordination.
   */
  async function legacyMutation(
    stores: ('lists' | 'items' | 'archives' | 'pendingOperations')[],
    mutate: (tx: import('idb').IDBPTransaction<ShoppingDB, ('lists' | 'items' | 'archives' | 'pendingOperations' | 'profileCutover')[], 'readwrite'>) => Promise<void>,
  ): Promise<void> {
    const db = await database
    const tx = db.transaction([...stores, 'profileCutover'], 'readwrite')
    const done = tx.done
    void done.catch(() => {})
    try {
      if (await tx.objectStore('profileCutover').get('legacy-guest-v1')) {
        throw new Error('Legacy guest writes blocked after profile cutover')
      }
      await mutate(tx)
      await done
    } catch (error) {
      try { tx.abort() } catch { /* already finished */ }
      await done.catch(() => {})
      throw error
    }
  }
  async function markListsChanged(
    store: Pick<IDBPObjectStore<ShoppingDB, ['localProfileRegistry'], 'localProfileRegistry', 'readwrite'>, 'get' | 'put'>,
    lookup: { profileId: string } | { accountId: string },
  ) {
    const record = await store.get('device')
    if (!record) return
    const match = record.registry.profiles.find(p =>
      'profileId' in lookup ? p.id === lookup.profileId : p.cloudAccountId === lookup.accountId)
    if (!match) return
    const listsChangedAt = Math.max(Date.now(), match.listsChangedAt ?? match.createdAt)
    const profiles = record.registry.profiles.map(p => p.id === match.id ? { ...p, listsChangedAt } : p)
    await store.put({ ...record, registry: { ...record.registry, profiles } })
  }

  async function writeAccountEdit(accountId: string, operation: CloudPendingOperation, mergeOnly = false): Promise<boolean> {
    if (!operation.itemId.trim() || !operation.localListId.trim() ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.remoteListId) ||
        (operation.kind !== 'cloud-add' && (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < 0)) ||
        (operation.kind !== 'cloud-delete' && (operation.item.id !== operation.itemId || operation.item.listId !== operation.localListId))) {
      throw new Error('Invalid account edit operation')
    }
    const key = accountKey(accountId, operation.operationId)
    const db = await database
    const tx = db.transaction(['localProfileRegistry', 'accountItems', 'accountOperations', 'accountListMappings', 'accountCompletions', 'accountCompletionRequests', 'accountItemVersions'], 'readwrite')
    const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, operation.localListId))
    if (!mapping || mapping.remoteListId !== operation.remoteListId) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Missing verified list mapping')
    }
    if ((await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
      .some(row => mergeTouches(row.pendingMerge, operation.localListId))) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Объединение этих списков ожидает синхронизации.')
    }
    const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
    const request = await tx.objectStore('accountCompletionRequests').get(accountKey(accountId, operation.remoteListId))
    if (request || intents.some(row => row.intent.remoteListId === operation.remoteListId)) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Completion pending; list edits are temporarily locked')
    }
    const operations = tx.objectStore('accountOperations')
    const existing = await operations.get(key)
    if (existing) {
      const { base: _base, editTimes: _times, ...payload } =
        existing.operation as CloudPendingOperation & { base?: Item; editTimes?: unknown }
      if (JSON.stringify(payload) !== JSON.stringify(operation)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Operation ID collision with different payload')
      }
      await tx.done
      return true
    }
    const queued = (await operations.index('byAccount').getAll(accountId)).filter(({ operation: pending }) =>
      (pending.kind === 'upsert' ? pending.item.id : pending.itemId) === operation.itemId)
    if (operation.kind !== 'cloud-delete') {
      const rows = await tx.objectStore('accountItems').index('byAccount').getAll(accountId)
      try { checkItemNames(rows.map(row => row.item), [operation.item]) }
      catch (error) {
        tx.abort()
        await tx.done.catch(() => {})
        throw error
      }
    }
    if (mergeOnly) {
      const row = queued.length === 1 ? queued[0] : undefined
      const pending = row?.operation
      if (row?.neverDispatched && !row.conflict && (pending?.kind === 'cloud-add' || pending?.kind === 'cloud-update') &&
          operation.kind !== 'cloud-delete' && pending.remoteListId === operation.remoteListId &&
          pending.localListId === operation.localListId) {
        await tx.objectStore('accountItems').put({ key: accountKey(accountId, operation.itemId), accountId, item: operation.item })
        const editTimes = pending.kind === 'cloud-update'
          ? { editTimes: recordEditTimes(pending.item, operation.item, pending.editTimes) }
          : {}
        await operations.put({ ...row, queuedAt: Date.now(), operation: { ...pending, item: operation.item, ...editTimes } })
        await markListsChanged(tx.objectStore('localProfileRegistry'), { accountId })
        await tx.done
        return true
      }
      await tx.done
      return false
    }
    if (queued.some(row => row.operation.kind !== 'delete')) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Item has an unconfirmed cloud change')
    }
    const itemKey = accountKey(accountId, operation.itemId)
    const items = tx.objectStore('accountItems')
    const old = await items.get(itemKey)
    const confirmed = await tx.objectStore('accountItemVersions').get(itemKey)
    if (operation.kind !== 'cloud-add' && confirmed &&
        (confirmed.remoteListId !== operation.remoteListId || confirmed.version !== operation.expectedVersion)) {
      tx.abort()
      await tx.done.catch(() => {})
      throw new Error('Item version changed while saving')
    }
    if (old && operation.kind === 'cloud-update') {
      operation = { ...operation, base: old.item, editTimes: recordEditTimes(old.item, operation.item) }
    } else if (old && operation.kind === 'cloud-delete') {
      operation = { ...operation, base: old.item }
    }
    if (operation.kind === 'cloud-delete') {
      await items.delete(itemKey)
    } else {
      await items.put({ key: itemKey, accountId, item: operation.item })
    }
    await operations.add({ key, accountId, operation, queuedAt: Date.now(), neverDispatched: true })
    await markListsChanged(tx.objectStore('localProfileRegistry'), { accountId })
    await tx.done
    return true
  }

  return {
    /** Immediately notifies late subscribers if an older open tab blocks schema upgrade. */
    subscribeUpgradeBlocked(listener: () => void): () => void {
      blockedListeners.add(listener)
      if (upgradeBlocked) listener()
      return () => { blockedListeners.delete(listener) }
    },
    /** Atomic first-use initialization; preserves legacy stores and stable identity across restarts. */
    async ensureLocalProfiles(): Promise<LocalProfileRegistry> {
      const tx = (await database).transaction('localProfileRegistry', 'readwrite')
      const existing = await tx.store.get('device')
      if (existing) { await tx.done; return existing.registry }
      const registry = initializeProfiles(crypto.randomUUID(), Date.now())
      await tx.store.add({ key: 'device', registry })
      await tx.done
      return registry
    },
    async markAccountListsChanged(accountId: string): Promise<void> {
      const tx = (await database).transaction('localProfileRegistry', 'readwrite')
      await markListsChanged(tx.store, { accountId })
      await tx.done
    },
    async readReservedProfileSources(): Promise<string[]> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'guestImports'])
      const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
      if (!registry || registry.profiles.length <= MAX_LOCAL_PROFILES) return []
      const batches = await tx.objectStore('guestImports').getAll()
      await tx.done
      return batches.filter(batch => !batch.imported && batch.removeSource &&
        registry.profiles.some(profile => profile.cloudAccountId === batch.accountId)).map(batch => batch.key)
    },
    async readLocalProfiles(): Promise<LocalProfileRegistry | null> {
      return (await (await database).get('localProfileRegistry', 'device'))?.registry ?? null
    },
    /** Copy legacy guest data into its original local profile, atomically and idempotently.
     * Legacy stores are deliberately retained for rollback and older clients.
     * This method does not activate profile-scoped writes in the UI.
     */
    async migrateLegacyGuestToProfile(): Promise<string> {
      const db = await database
      const tx = db.transaction([
        'localProfileRegistry', 'profileMigrations', 'lists', 'items', 'archives',
        'pendingOperations', 'profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations',
      ], 'readwrite')
      const completion = tx.done
      void completion.catch(() => {})
      try {
        let registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry) {
          registry = initializeProfiles(crypto.randomUUID(), Date.now())
          await tx.objectStore('localProfileRegistry').add({ key: 'device', registry })
        }
        // Only the original profile may inherit legacy guest data; a bound or
        // switched account must never be assigned the legacy guest namespace.
        const original = registry.profiles[0]
        if (!original || original.cloudAccountId !== null) throw new Error('Legacy guest profile ownership is ambiguous')
        const marker = await tx.objectStore('profileMigrations').get('legacy-guest-v1')
        if (marker) {
          if (marker.profileId !== original.id) throw new Error('Legacy migration owner mismatch')
          await completion
          return original.id
        }
        for (const record of await tx.objectStore('lists').getAll()) {
          const key = JSON.stringify([original.id, record.id])
          if (await tx.objectStore('profileLists').get(key)) throw new Error('Profile migration destination collision')
          await tx.objectStore('profileLists').add({ key, profileId: original.id, record })
        }
        for (const record of await tx.objectStore('items').getAll()) {
          const key = JSON.stringify([original.id, record.id])
          if (await tx.objectStore('profileItems').get(key)) throw new Error('Profile migration destination collision')
          await tx.objectStore('profileItems').add({ key, profileId: original.id, record })
        }
        for (const record of await tx.objectStore('archives').getAll()) {
          const key = JSON.stringify([original.id, record.id])
          if (await tx.objectStore('profileArchives').get(key)) throw new Error('Profile migration destination collision')
          await tx.objectStore('profileArchives').add({ key, profileId: original.id, record })
        }
        for (const record of await tx.objectStore('pendingOperations').getAll()) {
          const key = JSON.stringify([original.id, record.operationId])
          if (await tx.objectStore('profilePendingOperations').get(key)) throw new Error('Profile migration destination collision')
          await tx.objectStore('profilePendingOperations').add({ key, profileId: original.id, record })
        }
        await tx.objectStore('profileMigrations').add({
          key: 'legacy-guest-v1', profileId: original.id, completedAt: Date.now(),
        })
        await completion
        return original.id
      } catch (error) {
        try { tx.abort() } catch { /* transaction already completed or aborted */ }
        await completion.catch(() => {})
        throw error
      }
    },
    /** Transactionally validate the entire guest snapshot and record cutover readiness.
     * No UI or legacy writer is switched by this marker alone.
     */
    async markGuestCutoverReady(): Promise<string> {
      const db = await database
      const tx = db.transaction([
        'localProfileRegistry', 'profileMigrations', 'profileCutover',
        'lists', 'items', 'archives', 'pendingOperations',
        'profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations',
      ], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        const original = registry?.profiles[0]
        const migration = await tx.objectStore('profileMigrations').get('legacy-guest-v1')
        if (!original || original.cloudAccountId !== null || !migration ||
            migration.profileId !== original.id) throw new Error('Original guest migration missing or ambiguous')
        // Late legacy-only additions can be replayed safely. Conflicting edits,
        // deletions, or profile-side edits are ambiguous and block cutover.
        // All reconciliation and the fence marker share one readwrite transaction.
        const reconcile = async <T extends { id: string }>(
          source: T[], scoped: ProfileOwnedRecord<T>[],
          store: 'profileLists' | 'profileItems' | 'profileArchives',
        ) => {
          const byId = new Map(source.map(row => [row.id, row]))
          for (const entry of scoped) {
            const legacy = byId.get(entry.record.id)
            if (!legacy || entry.key !== JSON.stringify([original.id, entry.record.id]) ||
                JSON.stringify(legacy) !== JSON.stringify(entry.record)) {
              throw new Error('Legacy guest data conflicts with profile snapshot; cutover blocked')
            }
          }
          const copied = new Set(scoped.map(row => row.record.id))
          for (const row of source) if (!copied.has(row.id)) {
            const key = JSON.stringify([original.id, row.id])
            await tx.objectStore(store).add({ key, profileId: original.id, record: row as unknown as ShoppingListRecord & Item & ArchivedListRecord })
          }
        }
        const lists = await tx.objectStore('lists').getAll()
        const profileLists = await tx.objectStore('profileLists').index('byProfile').getAll(original.id)
        const items = await tx.objectStore('items').getAll()
        const profileItems = await tx.objectStore('profileItems').index('byProfile').getAll(original.id)
        const archives = await tx.objectStore('archives').getAll()
        const profileArchives = await tx.objectStore('profileArchives').index('byProfile').getAll(original.id)
        const pending = await tx.objectStore('pendingOperations').getAll()
        const profilePending = await tx.objectStore('profilePendingOperations').index('byProfile').getAll(original.id)
        await reconcile(lists, profileLists, 'profileLists')
        await reconcile(items, profileItems, 'profileItems')
        await reconcile(archives, profileArchives, 'profileArchives')
        const legacyQueue = new Map(pending.map(row => [row.operationId, row]))
        for (const entry of profilePending) {
          const legacy = legacyQueue.get(entry.record.operationId)
          if (!legacy || entry.key !== JSON.stringify([original.id, entry.record.operationId]) ||
              JSON.stringify(legacy) !== JSON.stringify(entry.record)) {
            throw new Error('Legacy pending operations conflict with profile snapshot; cutover blocked')
          }
        }
        const copiedOperations = new Set(profilePending.map(row => row.record.operationId))
        for (const row of pending) if (!copiedOperations.has(row.operationId)) {
          const key = JSON.stringify([original.id, row.operationId])
          await tx.objectStore('profilePendingOperations').add({ key, profileId: original.id, record: row })
        }
        const existing = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (existing && existing.profileId !== original.id) throw new Error('Cutover ownership mismatch')
        if (!existing) await tx.objectStore('profileCutover').add({
          key: 'legacy-guest-v1', profileId: original.id, activatedAt: Date.now(),
        })
        await done
        return original.id
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async readGuestCutoverOwner(): Promise<string | null> {
      return (await (await database).get('profileCutover', 'legacy-guest-v1'))?.profileId ?? null
    },
    /** Profile-local queue acknowledgement; cannot touch another profile. */
    async acknowledgeProfilePending(profileId: string, operationId: string): Promise<void> {
      if (!profileId.trim() || !operationId.trim()) throw new Error('Profile and operation IDs required')
      await (await database).delete('profilePendingOperations', JSON.stringify([profileId, operationId]))
    },
    /** Atomically delete a one-off list and its own profile's items. */
    async deleteProfileList(profileId: string, listId: string): Promise<void> {
      if (!profileId.trim() || !listId.trim()) throw new Error('Profile and list IDs required')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'profileItems', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const key = JSON.stringify([profileId, listId])
        if (!await tx.objectStore('profileLists').get(key)) throw new Error('Список не найден в профиле')
        const items = await tx.objectStore('profileItems').index('byProfile').getAll(profileId)
        for (const row of items) if (row.record.listId === listId) await tx.objectStore('profileItems').delete(row.key)
        await tx.objectStore('profileLists').delete(key)
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    /** Add a separate local profile without modifying the original profile's data. */
    async createLocalProfile(id: string, createdAt: number): Promise<LocalProfileRegistry> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileCutover'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('localProfileRegistry').get('device')
        if (!current) throw new Error('Initialize local profiles first')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!cutover) throw new Error('Profile cutover is not active')
        if (current.registry.profiles[0]?.id !== cutover.profileId) throw new Error('Profile cutover owner mismatch')
        const stable = { ...current.registry, profiles: current.registry.profiles.map((p, index) =>
          p.cloudAccountId ? p : { ...p, name: profileName(p, index) }) }
        const names = new Set(stable.profiles.map((p, index) => profileName(p, index)))
        let number = stable.profiles.length + 1
        while (names.has(`Локальный профиль ${number}`)) number++
        const registry = addProfile(stable, { id, cloudAccountId: null, createdAt, name: `Локальный профиль ${number}` })
        await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
        await done
        return registry
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    /** Bind an existing secondary local profile to an independently verified account.
     * Never claim the original guest: its offline lists must survive sign-out.
     * The caller must verify the live server identity before calling this method.
     */
    async bindVerifiedLocalProfile(profileId: string, verifiedAccountId: string): Promise<LocalProfileRegistry> {
      if (!profileId.trim() || !verifiedAccountId.trim()) throw new Error('Verified profile and account required')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileCutover'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('localProfileRegistry').get('device')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!current || !cutover || current.registry.profiles[0]?.id !== cutover.profileId) {
          throw new Error('Profile cutover is not active')
        }
        if (profileId === cutover.profileId) throw new Error('Original guest profile must remain unbound')
        const registry = bindProfile(current.registry, profileId, verifiedAccountId)
        await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
        await done
        return registry
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async readInstallationIdentity(): Promise<{ id: string; proof: string }> {
      const tx = (await database).transaction('installationIdentity', 'readwrite')
      const existing = await tx.store.get('device')
      const identity = existing ?? { id: crypto.randomUUID(), proof: crypto.randomUUID() }
      if (!existing) await tx.store.add(identity, 'device')
      await tx.done
      return identity
    },
    async readAccountDeletions(): Promise<AccountDeletionRecord[]> {
      return (await database).getAll('accountDeletions')
    },
    async isDeletedAccount(accountId: string): Promise<boolean> {
      return !!await (await database).get('accountDeletions', accountId)
    },
    async rememberDeletedAccount(accountId: string): Promise<void> {
      const tx = (await database).transaction('accountDeletions', 'readwrite')
      if (!await tx.store.get(accountId)) await tx.store.add({ accountId, purged: false, acknowledged: false })
      await tx.done
    },
    async purgeDeletedAccount(accountId: string): Promise<void> {
      const accountIndexed = ['accountItems', 'accountOperations', 'accountCompletions', 'accountCompletionRequests',
        'accountListMappings', 'accountItemVersions', 'accountDraftLists'] as const
      const profileIndexed = ['profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations'] as const
      const tx = (await database).transaction(['accountDeletions', 'localProfileRegistry', 'profileMigrations',
        'profileCutover', 'accountArchiveCache', 'accountFeed', 'accountSyncEvents', 'guestImports', 'lists', 'items', 'archives', 'pendingOperations', ...accountIndexed, ...profileIndexed], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const marker = await tx.objectStore('accountDeletions').get(accountId)
        if (!marker) throw new Error('Account deletion is not confirmed')
        if (!marker.purged) {
          for (const storeName of accountIndexed) {
            const store = tx.objectStore(storeName)
            for (const key of await store.index('byAccount').getAllKeys(accountId)) await store.delete(key)
          }
          await tx.objectStore('accountArchiveCache').delete(accountId)
          await tx.objectStore('accountFeed').delete(accountId)
          await tx.objectStore('accountSyncEvents').delete(accountId)
          await tx.objectStore('profileMigrations').delete('restore-account:' + accountId)
          const imports = tx.objectStore('guestImports')
          const legacyOwner = (await tx.objectStore('profileMigrations').get('legacy-guest-v1'))?.profileId
          const legacyImport = legacyOwner ? await imports.get(legacyOwner) : undefined
          if (legacyImport?.accountId === accountId && legacyImport.removeSource && legacyImport.imported) {
            for (const store of ['lists', 'items', 'archives', 'pendingOperations'] as const) await tx.objectStore(store).clear()
          }
          for (const batch of await imports.getAll()) {
            if (batch.accountId === accountId) await imports.delete(batch.key)
          }
          const registries = tx.objectStore('localProfileRegistry')
          const saved = await registries.get('device')
          const profile = saved?.registry.profiles.find(row => row.cloudAccountId === accountId)
          if (saved && profile) {
            for (const storeName of profileIndexed) {
              const store = tx.objectStore(storeName)
              for (const key of await store.index('byProfile').getAllKeys(profile.id)) await store.delete(key)
            }
            const registry = saved.registry.profiles.length === 1
              ? { ...saved.registry, profiles: [...saved.registry.profiles,
                { id: crypto.randomUUID(), cloudAccountId: null, createdAt: Date.now(), name: 'Мои покупки' }] }
              : saved.registry
            const remaining = removeProfileMetadata(registry, profile.id)
            const fence = tx.objectStore('profileCutover')
            const cutover = await fence.get('legacy-guest-v1')
            if (cutover?.profileId === profile.id) await fence.put({ ...cutover, profileId: remaining.profiles[0].id })
            await registries.put({ key: 'device', registry: remaining })
          }
          await tx.objectStore('accountDeletions').put({ ...marker, purged: true })
        }
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await done.catch(() => {})
        throw error
      }
    },
    async acknowledgeDeletedAccount(accountId: string): Promise<void> {
      const tx = (await database).transaction('accountDeletions', 'readwrite')
      const marker = await tx.store.get(accountId)
      if (marker?.purged) await tx.store.put({ ...marker, acknowledged: true })
      await tx.done
    },
    /** Consent is explicit and belongs to the active unbound source, never another account. */
    async ensureVerifiedAccountProfile(verifiedAccountId: string, options: {
      login?: string; sourceProfileId?: string; collisionMode?: 'separate' | 'merge'
    } = {}): Promise<LocalProfileRegistry> {
      if (!verifiedAccountId.trim()) throw new Error('Verified account required')
      const db = await database
      const tx = db.transaction(['accountDeletions', 'localProfileRegistry', 'profileCutover', 'guestImports', 'profileLists', 'profileItems', 'profileArchives'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        if (await tx.objectStore('accountDeletions').get(verifiedAccountId)) throw new Error('Account deletion was confirmed')
        const current = await tx.objectStore('localProfileRegistry').get('device')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!current || !cutover || current.registry.profiles[0]?.id !== cutover.profileId) throw new Error('Profile cutover is not active')
        current.registry = { ...current.registry, profiles: current.registry.profiles.map((p, index) =>
          p.cloudAccountId ? p : { ...p, name: profileName(p, index) }) }
        const existing = current.registry.profiles.find(p => p.cloudAccountId === verifiedAccountId)
        if (options.sourceProfileId) {
          const source = current.registry.profiles.find(p => p.id === options.sourceProfileId)
          if (!source || source.cloudAccountId || current.registry.activeProfileId !== source.id || !options.collisionMode)
            throw new Error('Transfer source changed; consent required')
          const prior = await tx.objectStore('guestImports').get(source.id)
          if (prior && !prior.imported && prior.accountId !== verifiedAccountId) throw new Error('Profile transfer already assigned')
          if (!prior || prior.imported) {
            const [lists, items, archives] = await Promise.all([
              tx.objectStore('profileLists').index('byProfile').getAll(source.id),
              tx.objectStore('profileItems').index('byProfile').getAll(source.id),
              tx.objectStore('profileArchives').index('byProfile').getAll(source.id),
            ])
            await tx.objectStore('guestImports').put({ key: source.id, accountId: verifiedAccountId,
              operationId: crypto.randomUUID(), imported: false, removeSource: true, collisionMode: options.collisionMode,
              lists: lists.map(r => r.record), items: items.map(r => r.record), archives: archives.map(r => r.record) })
          }
        }
        let registry = existing ? { ...current.registry, activeProfileId: existing.id }
          : addProfile(current.registry, { id: crypto.randomUUID(), cloudAccountId: verifiedAccountId, createdAt: Date.now() }, options.sourceProfileId)
        const activatedAt = Date.now()
        registry = { ...registry, profiles: registry.profiles.map(p => p.cloudAccountId === verifiedAccountId
          ? { ...p, login: options.login?.trim() || p.login, lastActivatedAt: activatedAt, lastCloudActivatedAt: activatedAt } : p) }
        await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
        await done
        return registry
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async setProfileTransferPromptSkipped(profileId: string, skipped: boolean): Promise<LocalProfileRegistry> {
      const tx = (await database).transaction('localProfileRegistry', 'readwrite')
      const current = await tx.store.get('device')
      const profile = current?.registry.profiles.find(row => row.id === profileId)
      if (!current || !profile || profile.cloudAccountId) {
        await tx.done
        throw new Error('An independent local profile is required')
      }
      const registry = { ...current.registry, profiles: current.registry.profiles.map(row =>
        row.id === profileId ? { ...row, skipTransferPrompt: skipped } : row) }
      await tx.store.put({ key: 'device', registry })
      await tx.done
      return registry
    },
    async renameLocalProfile(profileId: string, name: string): Promise<LocalProfileRegistry> {
      name = name.trim()
      if (!name || name.length > 120) throw new Error('Введите имя от 1 до 120 символов.')
      const tx = (await database).transaction(['localProfileRegistry', 'guestImports'], 'readwrite')
      const current = await tx.objectStore('localProfileRegistry').get('device')
      const profile = current?.registry.profiles.find(p => p.id === profileId)
      if (!current || !profile || profile.cloudAccountId || (await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Имя связанного или переносимого профиля изменить нельзя.')
      }
      const registry = { ...current.registry, profiles: current.registry.profiles.map(p => p.id === profileId ? { ...p, name } : p) }
      await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
      await tx.done
      return registry
    },
    async readGuestImports(accountId: string): Promise<GuestImport[]> {
      return (await (await database).getAll('guestImports')).filter(row => row.accountId === accountId && !row.imported)
    },
    async confirmGuestImport(batch: GuestImport, mappings: readonly {
      id: string; name: string; kind: 'permanent' | 'oneoff'; position: number; symbol?: string
    }[], items: readonly { item: Item; version: number }[], confirmedArchive?: CloudArchiveCompletion[]): Promise<void> {
      const tx = (await database).transaction(['accountDeletions', 'accountArchiveCache', 'guestImports', 'accountListMappings', 'accountItems', 'accountItemVersions', 'localProfileRegistry', 'profileCutover', 'profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(batch.accountId)) throw new Error('Account data was deleted')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('guestImports').get(batch.key)
        if (!current || current.accountId !== batch.accountId || current.operationId !== batch.operationId)
          throw new Error('Guest import ownership changed')
        if (!current.imported) {
          if (current.archiveOnly) {
            if (!confirmedArchive || confirmedArchive.length !== current.archives.length) throw new Error('Archive transfer not confirmed')
            const cache = tx.objectStore('accountArchiveCache')
            const existing = await cache.get(batch.accountId)
            const ids = new Set(confirmedArchive.map(row => row.id))
            await cache.put({ accountId: batch.accountId, awaitingRefresh: [...new Set([...(existing?.awaitingRefresh ?? []), ...ids])],
              snapshots: [...confirmedArchive, ...(existing?.snapshots.filter(row => !ids.has(row.id)) ?? [])] })
          }
          for (const { id, name, kind, position, symbol } of mappings) {
            const key = accountKey(batch.accountId, id)
            const existing = (await tx.objectStore('accountListMappings').index('byAccount').getAll(batch.accountId)).find(row => row.remoteListId === id)
            if (existing) continue
            await tx.objectStore('accountListMappings').add({
              key, accountId: batch.accountId, localListId: id, remoteListId: id, symbol, metadata: { name, kind, position },
            })
          }
          for (const { item, version } of items) {
            const key = accountKey(batch.accountId, item.id)
            if (await tx.objectStore('accountItems').get(key)) continue
            const mapping = (await tx.objectStore('accountListMappings').index('byAccount').getAll(batch.accountId)).find(row => row.remoteListId === item.listId)
            await tx.objectStore('accountItems').add({ key, accountId: batch.accountId, item: { ...item, listId: mapping?.localListId ?? item.listId } })
            await tx.objectStore('accountItemVersions').add({
              key, accountId: batch.accountId, itemId: item.id, remoteListId: item.listId, version,
            })
          }
          if (current.removeSource) {
            const saved = await tx.objectStore('localProfileRegistry').get('device')
            if (!saved?.registry.profiles.some(p => p.cloudAccountId === batch.accountId)) throw new Error('Transfer target missing')
            const registry = removeProfileMetadata(saved.registry, batch.key)
            for (const storeName of ['profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations'] as const) {
              const store = tx.objectStore(storeName)
              for (const key of await store.index('byProfile').getAllKeys(batch.key)) await store.delete(key)
            }
            const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
            if (cutover?.profileId === batch.key) await tx.objectStore('profileCutover').put({ ...cutover, profileId: registry.profiles[0].id })
            await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
            await markListsChanged(tx.objectStore('localProfileRegistry'), { accountId: batch.accountId })
          }
          await tx.objectStore('guestImports').put({ ...current, imported: true, lists: [], items: [], archives: [] })
        }
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    /** Persist the active local profile. Does not authenticate or rebind cloud accounts. */
    async switchLocalProfile(profileId: string): Promise<LocalProfileRegistry> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileCutover'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('localProfileRegistry').get('device')
        if (!current) throw new Error('Local profiles not initialized')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!cutover) throw new Error('Profile cutover is not active')
        const registry = switchProfile(current.registry, profileId, Date.now())
        await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
        await done
        return registry
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async readLocalProfileDeletion(profileId: string) {
      const tx = (await database).transaction(['localProfileRegistry', 'profileArchives', 'profileItems'])
      const [saved, archives, items] = await Promise.all([
        tx.objectStore('localProfileRegistry').get('device'),
        tx.objectStore('profileArchives').index('byProfile').getAllKeys(profileId),
        tx.objectStore('profileItems').index('byProfile').getAll(profileId),
      ])
      await tx.done
      if (!saved?.registry.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
      return { registry: saved.registry, archiveCount: archives.length, hasMarked: items.some(row => row.record.purchased) }
    },
    /** Transfer and purge device data in one transaction. Linked sources only clear their local cache. */
    async deleteLocalProfile(profileId: string, confirmationId: string, choice?: {
      archiveCount: number; hasMarked: boolean
      target?: { id: string; accountId: string | null } | 'new'
    }): Promise<LocalProfileRegistry> {
      if (!profileId.trim() || confirmationId !== profileId) throw new Error('Profile deletion confirmation mismatch')
      const db = await database
      const tx = db.transaction([
        'localProfileRegistry', 'profileCutover', 'profileLists', 'profileItems',
        'profileArchives', 'profilePendingOperations', 'guestImports', 'profileMigrations', 'accountDeletions',
        'lists', 'items', 'archives', 'pendingOperations',
        'accountItems', 'accountOperations', 'accountCompletions', 'accountCompletionRequests', 'accountListMappings', 'accountItemVersions', 'accountArchiveCache', 'accountDraftLists', 'accountFeed', 'accountSyncEvents',
      ], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('localProfileRegistry').get('device')
        if (!current) throw new Error('Local profiles not initialized')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!cutover) throw new Error('Profile cutover is not active')
        if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) throw new Error('Profile has unsynced operations; deletion blocked')
        const source = current.registry.profiles.find(profile => profile.id === profileId)
        if (!source) throw new Error('Unknown local profile')
        const accountId = source.cloudAccountId
        const archives = tx.objectStore('profileArchives')
        const snapshots = await archives.index('byProfile').getAll(profileId)
        if ((accountId && choice) || (!accountId && snapshots.length && !choice))
          throw new Error('Profile deletion preview changed')
        if (!accountId && choice && (snapshots.length !== choice.archiveCount ||
            (!choice.hasMarked && (await tx.objectStore('profileItems').index('byProfile').getAll(profileId))
              .some(row => row.record.purchased)))) {
          throw new Error('Profile deletion preview changed')
        }
        if (accountId) {
          const [operations, completions, requests, drafts, imports] = await Promise.all([
            tx.objectStore('accountOperations').index('byAccount').count(accountId),
            tx.objectStore('accountCompletions').index('byAccount').count(accountId),
            tx.objectStore('accountCompletionRequests').index('byAccount').count(accountId),
            tx.objectStore('accountDraftLists').index('byAccount').count(accountId),
            tx.objectStore('guestImports').getAll(),
          ])
          if (operations || completions || requests || drafts || imports.some(batch => batch.accountId === accountId && !batch.imported) ||
              (await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId)).some(row => row.pendingMetadata?.length || row.pendingMerge))
            throw new Error('Profile has unsynced operations; deletion blocked')
          await tx.objectStore('profileMigrations').put({
            key: 'restore-account:' + accountId, profileId, completedAt: Date.now(),
          })
          await tx.objectStore('accountArchiveCache').delete(accountId)
          await tx.objectStore('accountFeed').delete(accountId)
          await tx.objectStore('accountSyncEvents').delete(accountId)
          for (const storeName of ['accountItems', 'accountListMappings', 'accountItemVersions'] as const) {
            const store = tx.objectStore(storeName)
            for (const key of await store.index('byAccount').getAllKeys(accountId)) await store.delete(key)
          }
        }
        const pending = await tx.objectStore('profilePendingOperations').index('byProfile').getAll(profileId)
        if (pending.length) throw new Error('Profile has unsynced operations; deletion blocked')
        let registry = {
          ...current.registry,
          profiles: current.registry.profiles.map((profile, index) =>
            profile.cloudAccountId || profile.name ? profile : { ...profile, name: profileName(profile, index) }),
        }
        const last = registry.profiles.length === 1
        const targetChoice = choice?.target
        if (targetChoice && (accountId || !snapshots.length)) throw new Error('No local purchase archive to transfer')
        if (targetChoice === 'new' && !last) throw new Error('Profile deletion target changed')
        if (last) registry = addProfile(registry, { id: crypto.randomUUID(), cloudAccountId: null, createdAt: Date.now(), name: 'Мои покупки' })
        if (targetChoice) {
          const target = targetChoice === 'new' ? registry.profiles.find(profile => profile.id === registry.activeProfileId)
            : registry.profiles.find(profile => profile.id === targetChoice.id && profile.cloudAccountId === targetChoice.accountId)
          if (!target || target.id === profileId || (await tx.objectStore('guestImports').get(target.id))?.removeSource ||
              (target.cloudAccountId && await tx.objectStore('accountDeletions').get(target.cloudAccountId)))
            throw new Error('Profile deletion target changed')
          if (target.cloudAccountId) {
            const operationId = crypto.randomUUID()
            await tx.objectStore('guestImports').add({
              key: `archive:${operationId}`, accountId: target.cloudAccountId, operationId, imported: false,
              lists: [], items: [], archives: snapshots.map(row => row.record), collisionMode: 'separate', archiveOnly: true,
            })
          } else {
            for (const { record } of snapshots) {
              const id = await archives.get(JSON.stringify([target.id, record.id])) ? crypto.randomUUID() : record.id
              await archives.add({ key: JSON.stringify([target.id, id]), profileId: target.id, record: { ...record, id } })
            }
          }
        }
        registry = removeProfileMetadata(registry, profileId)
        if (cutover.profileId === profileId) {
          await tx.objectStore('profileCutover').put({ ...cutover, profileId: registry.profiles[0].id })
          if ((await tx.objectStore('profileMigrations').get('legacy-guest-v1'))?.profileId === profileId) {
            for (const name of ['lists', 'items', 'archives', 'pendingOperations'] as const) await tx.objectStore(name).clear()
          }
        }
        for (const storeName of ['profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations'] as const) {
          const store = tx.objectStore(storeName)
          const records = await store.index('byProfile').getAll(profileId)
          for (const row of records) await store.delete(row.key)
        }
        await tx.objectStore('localProfileRegistry').put({ key: 'device', registry })
        await done
        return registry
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async needsAccountCacheRestore(accountId: string): Promise<boolean> {
      return !!await (await database).get('profileMigrations', 'restore-account:' + accountId)
    },
    async confirmAccountCacheRestore(accountId: string): Promise<void> {
      await (await database).delete('profileMigrations', 'restore-account:' + accountId)
    },
    /** All profile writes require an existing profile and completed legacy cutover.
     * This guard prevents accidental cross-profile writes before migration.
     */
    async saveProfileItem(profileId: string, item: Item, pair?: { keep: Item; change: Item }): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        const key = JSON.stringify([profileId, item.id])
        const store = tx.objectStore('profileItems')
        if (pair) checkNamePair((await store.get(JSON.stringify([profileId, pair.keep.id])))?.record,
          (await store.get(key))?.record, pair.keep, pair.change)
        checkItemNames((await store.index('byProfile').getAll(profileId)).map(row => row.record), [item])
        await store.put({ key, profileId, record: item })
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    /** Batch import is atomic: a multiline add never saves only part of a list. */
    async saveProfileItems(profileId: string, items: Item[]): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        const store = tx.objectStore('profileItems')
        checkItemNames((await store.index('byProfile').getAll(profileId)).map(row => row.record), items)
        for (const item of items) {
          const key = JSON.stringify([profileId, item.id])
          await store.put({ key, profileId, record: item })
        }
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already finished */ }
        await done.catch(() => {})
        throw error
      }
    },
    async removeProfileItem(profileId: string, itemId: string, pair?: { keep: Item; change: Item }): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        const store = tx.objectStore('profileItems')
        const key = JSON.stringify([profileId, itemId])
        if (pair) checkNamePair((await store.get(JSON.stringify([profileId, pair.keep.id])))?.record,
          (await store.get(key))?.record, pair.keep, pair.change)
        await store.delete(key)
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    /** Refuse cutover if legacy guest data changed after its one-time snapshot.
     * No writes occur on failure; this prevents silently discarding newer edits.
     */
    async verifyLegacyProfileCutover(): Promise<string> {
      const db = await database
      const tx = db.transaction([
        'localProfileRegistry', 'profileMigrations', 'lists', 'items', 'archives',
        'pendingOperations', 'profileLists', 'profileItems', 'profileArchives', 'profilePendingOperations',
      ], 'readonly')
      const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
      const original = registry?.profiles[0]
      const marker = await tx.objectStore('profileMigrations').get('legacy-guest-v1')
      if (!original || original.cloudAccountId !== null || !marker || marker.profileId !== original.id) {
        await tx.done
        throw new Error('Legacy profile cutover is not ready')
      }
      const same = <T extends { id: string }>(legacy: T[], scoped: ProfileOwnedRecord<T>[]) =>
        legacy.length === scoped.length && legacy.every(record => {
          const match = scoped.find(row => row.key === JSON.stringify([original.id, record.id]))
          return match && JSON.stringify(match.record) === JSON.stringify(record)
        })
      const legacyLists = await tx.objectStore('lists').getAll()
      const profileLists = await tx.objectStore('profileLists').index('byProfile').getAll(original.id)
      const legacyItems = await tx.objectStore('items').getAll()
      const profileItems = await tx.objectStore('profileItems').index('byProfile').getAll(original.id)
      const legacyArchives = await tx.objectStore('archives').getAll()
      const profileArchives = await tx.objectStore('profileArchives').index('byProfile').getAll(original.id)
      const legacyQueue = await tx.objectStore('pendingOperations').getAll()
      const profileQueue = await tx.objectStore('profilePendingOperations').index('byProfile').getAll(original.id)
      await tx.done
      if (!same(legacyLists, profileLists) || !same(legacyItems, profileItems) ||
          !same(legacyArchives, profileArchives) ||
          legacyQueue.length !== profileQueue.length ||
          legacyQueue.some(record => {
            const row = profileQueue.find(row => row.key === JSON.stringify([original.id, record.operationId]))
            return !row || JSON.stringify(row.record) !== JSON.stringify(record)
          })) {
        throw new Error('Legacy data changed since profile snapshot; cutover blocked')
      }
      return original.id
    },
    /** Profile-only list operations. No legacy or other profile stores are mutated. */
    async saveProfileList(profileId: string, list: ShoppingListRecord): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
      if (!registry?.profiles.some(profile => profile.id === profileId)) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Unknown local profile')
      }
      const lists = await tx.objectStore('profileLists').index('byProfile').getAll(profileId)
      assertFreeListName(lists.map(row => row.record), list.id, list.name)
      await tx.objectStore('profileLists').put({
        key: JSON.stringify([profileId, list.id]), profileId, record: list,
      })
      await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
      await tx.done
    },
    /** Atomic E4 drag reorder within one verified local profile. */
    async reorderProfileLists(profileId: string, records: ShoppingListRecord[]): Promise<void> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        const store = tx.objectStore('profileLists')
        const current = await store.index('byProfile').getAll(profileId)
        if (current.length !== records.length || new Set(records.map(row => row.id)).size !== records.length ||
          records.some(row => !current.some(saved => saved.record.id === row.id))) throw new Error('List set changed during reorder')
        for (const row of records) await store.put({key: JSON.stringify([profileId,row.id]),profileId,record:row})
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {tx.abort();await done.catch(()=>{});throw error}
    },
    async renameProfileList(profileId: string, listId: string, name: string | null, symbol?: string): Promise<void> {
      const trimmed = name?.trim()
      if (name !== null && (!trimmed || trimmed.length > 120)) throw new Error('Введите название списка от 1 до 120 символов.')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const key = JSON.stringify([profileId, listId])
      const existing = await tx.objectStore('profileLists').get(key)
      if (!existing) { await tx.done; throw new Error('Список не найден в профиле') }
      if (trimmed !== undefined && listNameKey(existing.record.name) !== listNameKey(trimmed)) {
        const lists = await tx.objectStore('profileLists').index('byProfile').getAll(profileId)
        assertFreeListName(lists.map(row => row.record), listId, trimmed)
      }
      await tx.objectStore('profileLists').put({ ...existing, record: { ...existing.record, name: trimmed ?? existing.record.name, symbol: symbol ?? existing.record.symbol } })
      await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
      await tx.done
    },
    async changeProfileListKind(profileId: string, listId: string, kind: ShoppingListRecord['kind']): Promise<void> {
      if (kind !== 'permanent' && kind !== 'oneoff') throw new Error('Недопустимый тип списка')
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const key = JSON.stringify([profileId, listId])
      const existing = await tx.objectStore('profileLists').get(key)
      if (!existing) { await tx.done; throw new Error('Список не найден в профиле') }
      await tx.objectStore('profileLists').put({ ...existing, record: { ...existing.record, kind } })
      await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
      await tx.done
    },
    async readProfileListMerge(profileId: string, sourceId: string, targetId: string): Promise<ListMergeSnapshot> {
      const tx = (await database).transaction(['profileLists', 'profileItems'])
      const lists = tx.objectStore('profileLists')
      const [source, target, rows] = await Promise.all([
        lists.get(JSON.stringify([profileId, sourceId])),
        lists.get(JSON.stringify([profileId, targetId])),
        tx.objectStore('profileItems').index('byProfile').getAll(profileId),
      ])
      await tx.done
      if (!source || !target || sourceId === targetId) throw new Error('Один из списков недоступен.')
      return { source: source.record, target: target.record,
        items: rows.map(row => row.record).filter(item => item.listId === sourceId || item.listId === targetId) }
    },
    async mergeProfileLists(profileId: string, expected: ListMergeSnapshot, choices: ReadonlyMap<string, MergeChoice>): Promise<void> {
      const tx = (await database).transaction(['localProfileRegistry', 'profileLists', 'profileItems', 'profilePendingOperations', 'guestImports'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = tx.objectStore('localProfileRegistry')
        const profile = (await registry.get('device'))?.registry.profiles.find(row => row.id === profileId)
        if (!profile || profile.cloudAccountId || (await tx.objectStore('guestImports').get(profileId))?.removeSource)
          throw new Error('Локальный профиль недоступен для объединения.')
        const lists = tx.objectStore('profileLists')
        const items = tx.objectStore('profileItems')
        const sourceKey = JSON.stringify([profileId, expected.source.id])
        const targetKey = JSON.stringify([profileId, expected.target.id])
        const [source, target, allRows, pending] = await Promise.all([
          lists.get(sourceKey), lists.get(targetKey), items.index('byProfile').getAll(profileId),
          tx.objectStore('profilePendingOperations').index('byProfile').getAll(profileId),
        ])
        const includesList = (id: string) => id === expected.source.id || id === expected.target.id
        const rows = allRows.filter(row => includesList(row.record.listId))
        if (!source || !target) throw new ListMergeConflict()
        const current = { source: source.record, target: target.record, items: rows.map(row => row.record) }
        if (!sameMergeSnapshot(expected, current)) throw new ListMergeConflict()
        if (pending.some(({ record }) => 'localListId' in record ? includesList(record.localListId)
          : record.kind === 'upsert' ? includesList(record.item.listId) : rows.some(row => row.record.id === record.itemId)))
          throw new Error('В этих списках есть ожидающие операции. Повторите после синхронизации.')
        const result = planListMerge(current, choices)
        const keptIds = new Set(result.map(item => item.id))
        for (const row of rows) if (!keptIds.has(row.record.id)) await items.delete(row.key)
        for (const record of result) await items.put({ profileId, key: JSON.stringify([profileId, record.id]), record })
        await lists.delete(sourceKey)
        await markListsChanged(registry, { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await done.catch(() => {})
        throw error
      }
    },
    async completeProfileList(profileId: string, listId: string, archiveId: string, completedAt: number, mode: Exclude<CompletionMode, 'delete_list'> = 'all_purchased', confirmedItemIds?: readonly string[]): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileLists', 'profileItems', 'profileArchives', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const key = JSON.stringify([profileId, listId])
        const list = await tx.objectStore('profileLists').get(key)
        if (!list) throw new Error('Список не найден в профиле')
        const rows = (await tx.objectStore('profileItems').index('byProfile').getAll(profileId))
          .filter(row => row.record.listId === listId)
        if (!rows.length) throw new Error('Cannot archive an empty list')
        const items = rows.map(row => row.record)
        if (mode === 'archive_purchased') checkConfirmedPurchases(items, confirmedItemIds)
        const archivedItems = itemsForCompletion(items, mode)
        const archive: ArchivedListRecord = {
          id: archiveId, sourceListId: listId, name: list.record.name,
          kind: list.record.kind, completedAt, items: archivedItems,
        }
        if (archivedItems.length) await tx.objectStore('profileArchives').add({
          key: JSON.stringify([profileId, archiveId]), profileId, record: archive,
        })
        for (const row of rows) {
          if (mode !== 'archive_purchased' || row.record.purchased) await tx.objectStore('profileItems').delete(row.key)
        }
        if (mode !== 'archive_purchased' && list.record.kind === 'oneoff') await tx.objectStore('profileLists').delete(key)
        await markListsChanged(tx.objectStore('localProfileRegistry'), { profileId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async enqueueProfilePending(profileId: string, operation: PendingItemOperation): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profilePendingOperations', 'guestImports'], 'readwrite')
      if ((await tx.objectStore('guestImports').get(profileId))?.removeSource) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Профиль переносится в аккаунт. Повторите вход для завершения переноса.')
      }
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        const key = JSON.stringify([profileId, operation.operationId])
        const existing = await tx.objectStore('profilePendingOperations').get(key)
        if (existing && JSON.stringify(existing.record) !== JSON.stringify(operation)) {
          throw new Error('Operation ID collision with different payload')
        }
        if (!existing) await tx.objectStore('profilePendingOperations').add({ key, profileId, record: operation })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async readProfileLists(profileId: string): Promise<ShoppingListRecord[]> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      return (await (await database).getAllFromIndex('profileLists', 'byProfile', profileId)).map(row => row.record)
    },
    async readProfileItems(profileId: string): Promise<Item[]> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      return (await (await database).getAllFromIndex('profileItems', 'byProfile', profileId)).map(row => row.record)
    },
    async readProfileArchives(profileId: string): Promise<ArchivedListRecord[]> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      return (await (await database).getAllFromIndex('profileArchives', 'byProfile', profileId)).map(row => row.record)
    },
    async readProfilePending(profileId: string): Promise<PendingItemOperation[]> {
      if (!profileId.trim()) throw new Error('Profile ID required')
      return (await (await database).getAllFromIndex('profilePendingOperations', 'byProfile', profileId)).map(row => row.record)
    },
    async readLists(): Promise<ShoppingListRecord[]> { return (await database).getAll('lists') },
    async saveList(list: ShoppingListRecord): Promise<void> {
      await legacyMutation(['lists'], async tx => {
        const store = tx.objectStore('lists')
        assertFreeListName(await store.getAll(), list.id, list.name)
        await store.put(list)
      })
    },
    async renameList(listId: string, name: string | null, symbol?: string): Promise<void> {
      const trimmed = name?.trim()
      if (name !== null && (!trimmed || trimmed.length > 120)) throw new Error('Введите название списка от 1 до 120 символов.')
      await legacyMutation(['lists'], async tx => {
        const store = tx.objectStore('lists')
        const list = await store.get(listId)
        if (!list) throw new Error('Список не найден')
        if (trimmed !== undefined && listNameKey(list.name) !== listNameKey(trimmed)) assertFreeListName(await store.getAll(), listId, trimmed)
        await store.put({ ...list, name: trimmed ?? list.name, symbol: symbol ?? list.symbol })
      })
    },
    async changeListKind(listId: string, kind: ShoppingListRecord['kind']): Promise<void> {
      if (kind !== 'permanent' && kind !== 'oneoff') throw new Error('Недопустимый тип списка')
      await legacyMutation(['lists'], async tx => {
        const store = tx.objectStore('lists')
        const list = await store.get(listId)
        if (!list) throw new Error('Список не найден')
        await store.put({ ...list, kind })
      })
    },
    async reorderLists(records: ShoppingListRecord[]): Promise<void> {
      await legacyMutation(['lists'], async tx => {
        for (const record of records) await tx.objectStore('lists').put(record)
      })
    },
    async saveItems(items: Item[]): Promise<void> {
      await legacyMutation(['items'], async tx => {
        const store = tx.objectStore('items')
        checkItemNames(await store.getAll(), items)
        for (const item of items) await store.put(item)
      })
    },
    async readArchives(): Promise<ArchivedListRecord[]> { return (await database).getAll('archives') },
    async deleteList(listId: string): Promise<void> {
      await legacyMutation(['lists', 'items'], async tx => {
        const items = await tx.objectStore('items').getAll()
        for (const item of items) if (item.listId === listId) await tx.objectStore('items').delete(item.id)
        await tx.objectStore('lists').delete(listId)
      })
    },
    async completeList(list: ShoppingListRecord, archiveId: string, completedAt: number, mode: Exclude<CompletionMode, 'delete_list'> = 'all_purchased', confirmedItemIds?: readonly string[]): Promise<void> {
      await legacyMutation(['lists', 'items', 'archives'], async tx => {
        const items = (await tx.objectStore('items').getAll()).filter(item => item.listId === list.id)
        if (!items.length) throw new Error('Cannot archive an empty list')
        if (mode === 'archive_purchased') checkConfirmedPurchases(items, confirmedItemIds)
        const archivedItems = itemsForCompletion(items, mode)
        if (archivedItems.length) await tx.objectStore('archives').add({
          id: archiveId, sourceListId: list.id, name: list.name, kind: list.kind, completedAt, items: archivedItems,
        })
        for (const item of items) {
          if (mode !== 'archive_purchased' || item.purchased) await tx.objectStore('items').delete(item.id)
        }
        if (mode !== 'archive_purchased' && list.kind === 'oneoff') await tx.objectStore('lists').delete(list.id)
      })
    },
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item, pair?: { keep: Item; change: Item }): Promise<void> {
      await legacyMutation(['items'], async tx => {
        const store = tx.objectStore('items')
        if (pair) checkNamePair(await store.get(pair.keep.id), await store.get(item.id), pair.keep, pair.change)
        checkItemNames(await store.getAll(), [item])
        await store.put(item)
      })
    },
    async remove(id: string, pair?: { keep: Item; change: Item }): Promise<void> {
      await legacyMutation(['items'], async tx => {
        const store = tx.objectStore('items')
        if (pair) checkNamePair(await store.get(pair.keep.id), await store.get(id), pair.keep, pair.change)
        await store.delete(id)
      })
    },
    // Guest items remain in the original store until explicit migration.
    async cacheAccountArchive(accountId: string, snapshots: CloudArchiveCompletion[]): Promise<CloudArchiveCompletion[] | null> {
      const tx = (await database).transaction(['localProfileRegistry', 'accountArchiveCache'], 'readwrite')
      const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
      let saved: CloudArchiveCompletion[] | null = null
      if (registry?.profiles.some(profile => profile.cloudAccountId === accountId)) {
        const store = tx.objectStore('accountArchiveCache')
        const existing = await store.get(accountId)
        const incoming = new Set(snapshots.map(row => row.id))
        const awaitingRefresh = existing?.awaitingRefresh?.filter(id => !incoming.has(id)) ?? []
        const retained = new Set(awaitingRefresh)
        saved = [...snapshots, ...(existing?.snapshots.filter(row => retained.has(row.id)) ?? [])]
        await store.put({ accountId, awaitingRefresh, snapshots: saved })
      }
      await tx.done
      return saved
    },
    async readAccountArchive(accountId: string): Promise<CloudArchiveCompletion[] | null> {
      return (await (await database).get('accountArchiveCache', accountId))?.snapshots ?? null
    },
    async readAccountItems(accountId: string): Promise<Item[]> {
      accountKey(accountId, 'check')
      const rows = await (await database).getAllFromIndex('accountItems', 'byAccount', accountId)
      return rows.map(row => row.item)
    },
    async saveAccountItem(accountId: string, item: Item): Promise<void> {
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountCompletions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (intents.some(row => row.intent.localListId === item.listId))
          throw new Error('Completion pending; list edits are temporarily locked')
        const store = tx.objectStore('accountItems')
        checkItemNames((await store.index('byAccount').getAll(accountId)).map(row => row.item), [item])
        await store.put({ key: accountKey(accountId, item.id), accountId, item })
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* closed */ }; await tx.done.catch(() => {}); throw error }
    },
    async removeAccountItem(accountId: string, itemId: string): Promise<void> {
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountCompletions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const key = accountKey(accountId, itemId)
        const existing = await tx.objectStore('accountItems').get(key)
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        // Unknown item ownership is ambiguous while completion is pending: fail closed.
        if (intents.some(row => !existing || row.intent.localListId === existing.item.listId))
          throw new Error('Completion pending; list edits are temporarily locked')
        await tx.objectStore('accountItems').delete(key)
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* closed */ }; await tx.done.catch(() => {}); throw error }
    },
    // Unassigned operations remain local until an explicit guest-data migration.
    async readPending(): Promise<PendingItemOperation[]> {
      return (await database).getAll('pendingOperations')
    },
    async enqueuePending(operation: PendingItemOperation): Promise<void> {
      await legacyMutation(['pendingOperations'], async tx => {
      const existing = await tx.objectStore('pendingOperations').get(operation.operationId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(operation)) throw new Error('Operation ID collision with different payload')
      if (!existing) await tx.objectStore('pendingOperations').add(operation)
      })
    },
    async acknowledgePending(operationId: string): Promise<void> {
      await legacyMutation(['pendingOperations'], async tx => { await tx.objectStore('pendingOperations').delete(operationId) })
    },
    async readAccountDraftLists(accountId: string): Promise<AccountDraftList[]> {
      const rows = await (await database).getAllFromIndex('accountDraftLists', 'byAccount', accountId)
      return rows.map(({ key: _key, ...row }) => row).sort((a, b) => a.createdAt - b.createdAt)
    },
    async saveAccountDraftList(accountId: string, list: ShoppingListRecord): Promise<void> {
      const tx = (await database).transaction(['accountDeletions', 'accountDraftLists', 'accountListMappings', 'localProfileRegistry'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = tx.objectStore('localProfileRegistry')
        if (!(await registry.get('device'))?.registry.profiles.some(row => row.cloudAccountId === accountId))
          throw new Error('Локальная копия аккаунта недоступна.')
        const store = tx.objectStore('accountDraftLists')
        const key = accountKey(accountId, list.id)
        const existing = await store.get(key)
        if (existing && !existing.nameConflict) throw new Error('Этот список уже ожидает синхронизации.')
        const name = list.name.trim()
        if (!name || name.length > 120) throw new Error('Введите название списка от 1 до 120 символов.')
        const [drafts, bindings] = await Promise.all([
          store.index('byAccount').getAll(accountId),
          tx.objectStore('accountListMappings').index('byAccount').getAll(accountId),
        ])
        assertFreeListName([...drafts, ...bindings.flatMap(row => row.metadata ? [{ id: row.localListId, name: row.metadata.name }] : [])], list.id, name)
        await store.put({ ...list, name, key, accountId, operationId: crypto.randomUUID(), nameConflict: undefined })
        await markListsChanged(registry, { accountId })
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await done.catch(() => {})
        throw error
      }
    },
    async markAccountDraftNameConflict(draft: AccountDraftList): Promise<boolean> {
      const tx = (await database).transaction('accountDraftLists', 'readwrite')
      const key = accountKey(draft.accountId, draft.id)
      const current = await tx.store.get(key)
      const matched = current?.operationId === draft.operationId
      if (matched) await tx.store.put({ ...current, nameConflict: true })
      await tx.done
      return matched
    },
    async promoteAccountDraft(draft: AccountDraftList, remote: { id: string; ownerId: string; name: string; kind: ShoppingListRecord['kind']; position: number }): Promise<string | undefined> {
      if (remote.ownerId !== draft.accountId || remote.name !== draft.name || remote.kind !== draft.kind)
        throw new Error('Подтверждение создания не совпадает с локальным списком.')
      const tx = (await database).transaction(['accountDeletions', 'accountDraftLists', 'accountListMappings', 'accountItems', 'accountOperations', 'accountCompletionRequests'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(draft.accountId)) throw new Error('Account data was deleted')
      const done = tx.done
      void done.catch(() => {})
      try {
        const { accountId } = draft
        const drafts = tx.objectStore('accountDraftLists')
        const key = accountKey(accountId, draft.id)
        const current = await drafts.get(key)
        const mappings = tx.objectStore('accountListMappings')
        const remoteMapping = (await mappings.index('byAccount').getAll(accountId)).find(row => row.remoteListId === remote.id)
        if (!current || current.operationId !== draft.operationId) {
          await done
          return remoteMapping?.localListId
        }
        const localListId = remoteMapping?.localListId ?? draft.id
        const { name, kind, position } = remote
        await mappings.put({ key: accountKey(accountId, localListId), accountId, localListId, remoteListId: remote.id,
          metadata: remoteMapping?.metadata ?? { name, kind, position }, symbol: draft.symbol })
        const items = tx.objectStore('accountItems')
        const operations = tx.objectStore('accountOperations')
        const rows = (await items.index('byAccount').getAll(accountId)).filter(row => row.item.listId === draft.id)
        for (const row of rows) {
          const item = { ...row.item, listId: localListId }
          await items.put({ ...row, item })
          const operation: CloudPendingOperation = { kind: 'cloud-add', operationId: crypto.randomUUID(),
            localListId, remoteListId: remote.id, itemId: item.id, item, preserveCreatedAt: true }
          await operations.add({ key: accountKey(accountId, operation.operationId), accountId, operation, queuedAt: Date.now(), neverDispatched: true })
        }
        const requests = tx.objectStore('accountCompletionRequests')
        const request = await requests.get(key)
        if (request) {
          await requests.delete(key)
          await requests.add({ ...request, key: accountKey(accountId, remote.id), localListId, remoteListId: remote.id, name })
        }
        await drafts.delete(key)
        await done
        return localListId
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await done.catch(() => {})
        throw error
      }
    },
    async writeDraftItem(accountId: string, item: Item, remove = false): Promise<boolean> {
      const tx = (await database).transaction(['accountDeletions', 'accountDraftLists', 'accountItems', 'accountCompletionRequests'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const key = accountKey(accountId, item.listId)
      if (!await tx.objectStore('accountDraftLists').get(key)) { await tx.done; return false }
      try {
        if (await tx.objectStore('accountCompletionRequests').get(key))
          throw new Error('Завершение ожидает синхронизации. Отмените его, чтобы изменить список.')
        const items = tx.objectStore('accountItems')
        const rowKey = accountKey(accountId, item.id)
        if (remove) await items.delete(rowKey)
        else {
          checkItemNames((await items.index('byAccount').getAll(accountId)).map(row => row.item), [item])
          await items.put({ key: rowKey, accountId, item })
        }
        await tx.done
        return true
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    async readAccountCompletionRequests(accountId: string): Promise<CloudCompletionRequest[]> {
      const rows = await (await database).getAllFromIndex('accountCompletionRequests', 'byAccount', accountId)
      return rows.map(({ key: _key, items: _items, ...request }) => request)
        .sort((left, right) => left.createdAt - right.createdAt)
    },
    async readLocalCompletionView(accountId: string) {
      const tx = (await database).transaction(['accountCompletionRequests', 'accountArchiveCache', 'accountCompletions', 'guestImports'])
      const [requests, archive, intents, imports] = await Promise.all([
        tx.objectStore('accountCompletionRequests').index('byAccount').getAll(accountId),
        tx.objectStore('accountArchiveCache').get(accountId),
        tx.objectStore('accountCompletions').index('byAccount').getAll(accountId),
        tx.objectStore('guestImports').getAll(),
      ])
      await tx.done
      const confirmed = archive?.snapshots ?? []
      const operations = requests.filter(request => request.fromLocalCopy).map(request => ({
        localListId: request.localListId, mode: request.mode,
        hiddenItemIds: (JSON.parse(request.items) as CompletionItems)
          .filter(([, , purchased]) => request.mode !== 'archive_purchased' || purchased).map(([id]) => id),
      }))
      const confirmedOperations = new Set(confirmed.map(row => row.operationId))
      const pending = requests.filter(request => request.fromLocalCopy && !confirmedOperations.has(request.operationId))
        .flatMap(request => {
          const snapshot = completionArchive(request, request.operationId)
          return snapshot ? [{ ...snapshot, pending: true }] : []
        })
      const transfers = imports.filter(batch => batch.archiveOnly && !batch.imported && batch.accountId === accountId)
        .flatMap(batch => batch.archives.map((row, index): CloudArchiveCompletion => ({
          id: `${batch.operationId}:${index}`, pending: true, sourceListId: row.sourceListId,
          sourceListName: row.name, completedAt: new Date(row.completedAt).toISOString(),
          items: row.items.map((item, ordinal) => ({ name: item.name, quantity: item.quantity ?? null, unit: item.unit ?? null, ordinal })),
        })))
      const snapshots = [...pending, ...transfers, ...confirmed]
        .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
      const unsent = requests.filter(request => request.fromLocalCopy &&
        !intents.some(row => row.intent.operationId === request.operationId))
      return { operations, unsent, snapshots: archive || pending.length || transfers.length ? snapshots : null }
    },
    async queueAccountCompletion(request: CloudCompletionRequest, local = false): Promise<void> {
      const { accountId, localListId, remoteListId } = request
      const tx = (await database).transaction(['accountDeletions', 'accountCompletionRequests', 'accountCompletions', 'accountListMappings', 'accountItems', 'accountDraftLists'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, localListId))
        if ((await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
          .some(row => mergeTouches(row.pendingMerge, localListId)))
          throw new Error('Объединение этих списков ожидает синхронизации.')
        const draft = local && !mapping && localListId === remoteListId &&
          await tx.objectStore('accountDraftLists').get(accountKey(accountId, localListId))
        if (!draft && mapping?.remoteListId !== remoteListId) throw new Error('Unverified list mapping')
        const requests = tx.objectStore('accountCompletionRequests')
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (intents.some(row => row.intent.remoteListId === remoteListId)) throw new Error('Completion already pending')
        const items = (await tx.objectStore('accountItems').index('byAccount').getAll(accountId))
          .map(row => row.item).filter(item => item.listId === localListId)
        if (local && !items.length && request.mode !== 'delete_list') throw new Error('Список недоступен для завершения.')
        if (local && request.mode === 'delete_list' && items.some(item => item.purchased) !== request.confirmedMarked)
          throw new Error('Список изменился. Проверьте его и подтвердите удаление заново.')
        if (request.mode === 'archive_purchased') checkConfirmedPurchases(items, request.confirmedItemIds)
        const projected = local && mapping ? projectListMetadata(
          await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId)).get(localListId) : undefined
        await requests.add({ ...request, ...(local ? { fromLocalCopy: true, localKind: projected?.kind ?? (draft || undefined)?.kind } : {}), key: accountKey(accountId, remoteListId), items: completionItemSnapshot(items) })
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* already closed */ }; await tx.done.catch(() => {}); throw error }
    },
    async cancelUnsentAccountCompletion(request: CloudCompletionRequest): Promise<boolean> {
      const tx = (await database).transaction(['accountCompletionRequests', 'accountCompletions'], 'readwrite')
      const requests = tx.objectStore('accountCompletionRequests')
      const key = accountKey(request.accountId, request.remoteListId)
      const saved = await requests.get(key)
      const intent = await tx.objectStore('accountCompletions').get(accountKey(request.accountId, request.operationId))
      const cancelled = !intent && saved?.operationId === request.operationId
      if (cancelled) await requests.delete(key)
      await tx.done
      return cancelled
    },
    async hasAccountSyncWork(accountId: string): Promise<boolean> {
      const db = await database
      const tx = db.transaction(['accountOperations', 'accountCompletions', 'accountCompletionRequests', 'guestImports', 'accountDraftLists', 'accountListMappings'])
      const [items, completions, requests, drafts, imports, mappings] = await Promise.all([
        tx.objectStore('accountOperations').index('byAccount').count(accountId),
        tx.objectStore('accountCompletions').index('byAccount').count(accountId),
        tx.objectStore('accountCompletionRequests').index('byAccount').count(accountId),
        tx.objectStore('accountDraftLists').index('byAccount').count(accountId),
        tx.objectStore('guestImports').getAll(),
        tx.objectStore('accountListMappings').index('byAccount').getAll(accountId),
      ])
      await tx.done
      return !!(items || completions || requests || drafts || mappings.some(row => row.pendingMetadata?.length || row.pendingMerge) || imports.some(batch => batch.accountId === accountId && !batch.imported))
    },
    /** Durable intent is written before RPC; account edits are fenced by the same transaction. */
    async beginAccountCompletion(intent: CloudCompletionIntent, queuedRequest = false): Promise<void> {
      const { accountId, operationId, localListId, remoteListId, itemIds } = intent
      if (!accountId || !operationId || !localListId || !remoteListId ||
          !Number.isSafeInteger(intent.expectedRevision) || intent.expectedRevision < 0 ||
          (intent.mode !== 'delete_list' && !itemIds.length) || new Set(itemIds).size !== itemIds.length) throw new Error('Invalid completion intent')
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountCompletions', 'accountCompletionRequests', 'accountItems', 'accountOperations', 'accountListMappings'], 'readwrite')
      try {
        if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
        if ((await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
          .some(row => mergeTouches(row.pendingMerge, localListId)))
          throw new Error('Объединение этих списков ожидает синхронизации.')
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, localListId))
        if (!mapping || mapping.remoteListId !== remoteListId) throw new Error('Unverified list mapping')
        const request = queuedRequest ? await tx.objectStore('accountCompletionRequests').get(accountKey(accountId, remoteListId)) : undefined
        if (queuedRequest && request?.operationId !== operationId) throw new Error('Completion request changed')
        const existing = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (existing.some(row => row.intent.remoteListId === remoteListId)) throw new Error('Completion already pending')
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
        if (queued.some(row => row.operation.kind === 'delete' ||
            (row.operation.kind === 'upsert' && row.operation.item.listId === localListId) ||
            (row.operation.kind !== 'upsert' && row.operation.remoteListId === remoteListId)))
          throw new Error('Unsent operations block completion')
        const items = (await tx.objectStore('accountItems').index('byAccount').getAll(accountId))
          .filter(row => row.item.listId === localListId)
        if (request && request.items !== completionItemSnapshot(items.map(row => row.item)))
          throw new Error('Список изменился. Проверьте его и подтвердите операцию заново.')
        if (intent.mode === 'archive_purchased') checkConfirmedPurchases(items.map(row => row.item), itemIds)
        else if (items.length !== itemIds.length || items.some(row => !itemIds.includes(row.item.id)))
          throw new Error('Local list changed before completion')
        await tx.objectStore('accountCompletions').add({ key: accountKey(accountId, operationId), accountId, intent })
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* already closed */ }; await tx.done.catch(() => {}); throw error }
    },
    async readAccountCompletions(accountId: string): Promise<CloudCompletionIntent[]> {
      accountKey(accountId, 'check')
      const rows = await (await database).getAllFromIndex('accountCompletions', 'byAccount', accountId)
      return rows.map(row => row.intent)
    },
    async discardRejectedCompletion(intent: CloudCompletionIntent): Promise<void> {
      const tx = (await database).transaction(['accountCompletions', 'accountCompletionRequests'], 'readwrite')
      const intents = tx.objectStore('accountCompletions')
      const key = accountKey(intent.accountId, intent.operationId)
      const stored = await intents.get(key)
      if (stored && JSON.stringify(stored.intent) === JSON.stringify(intent)) {
        await intents.delete(key)
        const requests = tx.objectStore('accountCompletionRequests')
        const requestKey = accountKey(intent.accountId, intent.remoteListId)
        if ((await requests.get(requestKey))?.operationId === intent.operationId) await requests.delete(requestKey)
      }
      await tx.done
    },
    /** Atomically commit a confirmed receipt and remove exactly the intended local items. */
    async commitAccountCompletion(intent: CloudCompletionIntent, revision: number, tombstones: { id: string; version: number }[], result?: { archiveId: string | null; kind: ShoppingListRecord['kind'] }): Promise<void> {
      if (!Number.isSafeInteger(revision) || revision <= intent.expectedRevision ||
          tombstones.length !== intent.itemIds.length || new Set(tombstones.map(row => row.id)).size !== tombstones.length ||
          tombstones.some(row => !intent.itemIds.includes(row.id) || !Number.isSafeInteger(row.version) || row.version < 1))
        throw new Error('Invalid confirmed completion tombstones')
      const db = await database
      const tx = db.transaction(['accountDeletions', 'localProfileRegistry', 'accountCompletions', 'accountCompletionRequests', 'accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings', 'accountArchiveCache', 'accountSyncEvents'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(intent.accountId)) throw new Error('Account data was deleted')
      try {
        const key = accountKey(intent.accountId, intent.operationId)
        const stored = await tx.objectStore('accountCompletions').get(key)
        if (!stored || JSON.stringify(stored.intent) !== JSON.stringify(intent)) throw new Error('Completion intent changed')
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(intent.accountId, intent.localListId))
        if (!mapping || mapping.remoteListId !== intent.remoteListId) throw new Error('List mapping changed')
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(intent.accountId)
        if (queued.some(row => row.operation.kind === 'delete' ||
            (row.operation.kind === 'upsert' && row.operation.item.listId === intent.localListId) ||
            (row.operation.kind !== 'upsert' && row.operation.remoteListId === intent.remoteListId)))
          throw new Error('Local edits must be reconciled before completion')
        const rows = (await tx.objectStore('accountItems').index('byAccount').getAll(intent.accountId))
          .filter(row => row.item.listId === intent.localListId)
        if (intent.mode === 'archive_purchased') checkConfirmedPurchases(rows.map(row => row.item), intent.itemIds)
        else if (rows.length !== intent.itemIds.length || rows.some(row => !intent.itemIds.includes(row.item.id)))
          throw new Error('Local items changed since completion request')
        for (const row of rows) {
          if (intent.itemIds.includes(row.item.id)) await tx.objectStore('accountItems').delete(row.key)
        }
        for (const tombstone of tombstones) {
          const versionKey = accountKey(intent.accountId, tombstone.id)
          const old = await tx.objectStore('accountItemVersions').get(versionKey)
          if (old && (old.remoteListId !== intent.remoteListId || old.version >= tombstone.version))
            throw new Error('Confirmed tombstone version conflict')
          await tx.objectStore('accountItemVersions').put({
            key: versionKey, accountId: intent.accountId, itemId: tombstone.id,
            remoteListId: intent.remoteListId, version: tombstone.version,
          })
        }
        if (intent.mode === 'delete_list') {
          await tx.objectStore('accountListMappings').delete(accountKey(intent.accountId, intent.localListId))
        } else if (result?.kind === 'oneoff' && intent.mode !== 'archive_purchased') {
          const { metadata: _metadata, ...mappingWithoutMetadata } = mapping
          await tx.objectStore('accountListMappings').put(mappingWithoutMetadata)
        }
        await tx.objectStore('accountCompletions').delete(key)
        const requests = tx.objectStore('accountCompletionRequests')
        const requestKey = accountKey(intent.accountId, intent.remoteListId)
        const request = await requests.get(requestKey)
        if (request?.operationId === intent.operationId) {
          if (request.fromLocalCopy && result?.archiveId) {
            const archive = tx.objectStore('accountArchiveCache')
            const cache = await archive.get(intent.accountId)
            const snapshot = completionArchive(request, result.archiveId)
            const snapshots = cache?.snapshots ?? []
            if (snapshot && !snapshots.some(row => row.id === snapshot.id))
              await archive.put({ accountId: intent.accountId, snapshots: [snapshot, ...snapshots],
                awaitingRefresh: [...(cache?.awaitingRefresh ?? []), snapshot.id] })
          }
          await requests.delete(requestKey)
        }
        const semantic = tx.objectStore('accountSyncEvents')
        await semantic.put(rememberOwnOperation(await semantic.get(intent.accountId) ?? newSemanticState(intent.accountId), intent.operationId))
        await markListsChanged(tx.objectStore('localProfileRegistry'), { accountId: intent.accountId })
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* already closed */ }; await tx.done.catch(() => {}); throw error }
    },
    /** Private data-only semantic state. Never expose data after a deletion marker. */
    async readAccountSemanticState(accountId: string): Promise<AccountSemanticState | undefined> {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents'])
      const deleted = await tx.objectStore('accountDeletions').get(accountId)
      const state = deleted ? undefined : await tx.objectStore('accountSyncEvents').get(accountId)
      await tx.done
      return state
    },
    async recordAccountSyncContext(accountId: string, localListId: string, itemId?: string): Promise<void> {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents', 'accountListMappings'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) { await tx.done; return }
      const mapping = (await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
        .find(row => row.metadata && (row.localListId === localListId || row.remoteListId === localListId))
      if (mapping) {
        const states = tx.objectStore('accountSyncEvents')
        const before = await states.get(accountId) ?? newSemanticState(accountId)
        const next = rememberContext(before, { accountId, listId: mapping.remoteListId, ...(itemId ? { itemId } : {}) })
        if (next !== before) await states.put(next)
      }
      await tx.done
    },
    async rememberAccountSyncOperation(accountId: string, operationId: string): Promise<void> {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const states = tx.objectStore('accountSyncEvents')
      await states.put(rememberOwnOperation(await states.get(accountId) ?? newSemanticState(accountId), operationId))
      await tx.done
    },
    async presentAccountSyncNotice(accountId: string, expectedKey: string): Promise<AccountSemanticState | undefined> {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents'], 'readwrite')
      const states = tx.objectStore('accountSyncEvents')
      const previous = await tx.objectStore('accountDeletions').get(accountId) ? undefined : await states.get(accountId)
      const next = previous ? presentSemanticNotice(previous, expectedKey) : undefined
      if (next && next !== previous) await states.put(next)
      await tx.done
      return next
    },
    async acknowledgeAccountSyncNotice(accountId: string, expectedKey: string | null) {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents', 'accountFeed', 'accountListMappings', 'accountItems'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) { await tx.done; return { kind: 'ignored' as const } }
      const states = tx.objectStore('accountSyncEvents')
      const previous = await states.get(accountId)
      if (!previous) { await tx.done; return { kind: 'ignored' as const } }
      const mappings = await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId)
      const remote = new Map(mappings.map(row => [row.localListId, row.remoteListId]))
      const cursor = await tx.objectStore('accountFeed').get(accountId)
      const current: ReconciledSyncContext = {
        accountId, ready: !!cursor && cursor.position === previous.evidence?.position && semanticReady(previous, cursor.deferred),
        lists: mappings.flatMap(row => row.metadata ? [{ id: row.remoteListId, ...row.metadata }] : []),
        items: (await tx.objectStore('accountItems').index('byAccount').getAll(accountId)).map(({ item }) => ({
          id: item.id, listId: remote.get(item.listId) ?? item.listId,
        })), activity: previous.activity,
      }
      const result = expectedKey === null ? consumeSilentRecovery(previous, current)
        : acknowledgeSemanticNotice(previous, expectedKey, current)
      if (result.state !== previous) await states.put(result.state)
      await tx.done
      return result.result
    },
    async readAccountFeedPosition(accountId: string): Promise<string | undefined> {
      return (await (await database).get('accountFeed', accountId))?.position
    },
    async applyAccountFeed(accountId: string, expected: string | undefined, position: string,
      changes: readonly AccountFeedChange[], snapshot: boolean, isActive: () => boolean, semanticBatch?: SemanticBatch): Promise<boolean> {
      const tx = (await database).transaction(['accountDeletions', 'accountFeed', 'accountSyncEvents', 'accountListMappings', 'accountItems',
        'accountItemVersions', 'accountOperations', 'accountCompletions', 'accountCompletionRequests'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const done = tx.done
      void done.catch(() => {})
      try {
        const feeds = tx.objectStore('accountFeed')
        const previous = await feeds.get(accountId)
        if (!isActive()) throw new Error('Account changed during feed synchronization')
        if (previous?.position !== expected) {
          await done
          return false
        }
        if (semanticBatch && (semanticBatch.accountId !== accountId ||
            (semanticBatch.kind === 'delta' ? semanticBatch.from !== expected || semanticBatch.through !== position : semanticBatch.position !== position)))
          throw new Error('Semantic batch does not match feed cursor')
        const states = tx.objectStore('accountSyncEvents')
        const semanticBefore = await states.get(accountId)
        if (!snapshot && !changes.length && !previous?.deferred.length && (!semanticBatch ||
            (semanticBefore?.evidence?.position === position && semanticBefore.evidence.caughtUp && !semanticBefore.pending && !semanticBefore.presented))) {
          await done
          return true
        }
        const mappings = tx.objectStore('accountListMappings')
        const items = tx.objectStore('accountItems')
        const versions = tx.objectStore('accountItemVersions')
        const [accountMappings, operations, completions, requests] = await Promise.all([
          mappings.index('byAccount').getAll(accountId),
          tx.objectStore('accountOperations').index('byAccount').getAll(accountId),
          tx.objectStore('accountCompletions').index('byAccount').getAll(accountId),
          tx.objectStore('accountCompletionRequests').index('byAccount').getAll(accountId),
        ])
        const byRemote = new Map(accountMappings.map(mapping => [mapping.remoteListId, mapping]))
        const busyLists = new Set([
          ...completions.map(({ intent }) => intent.remoteListId),
          ...requests.map(({ remoteListId }) => remoteListId),
          ...accountMappings.flatMap(({ pendingMerge }) => pendingMerge
            ? [pendingMerge.source.remoteListId, pendingMerge.target.remoteListId] : []),
        ])
        const pendingItems = new Set<string>()
        const editedLists = new Set(accountMappings.filter(row => row.pendingMetadata?.length).map(row => row.remoteListId))
        const remoteByLocal = new Map(accountMappings.map(row => [row.localListId, row.remoteListId]))
        for (const { operation } of operations) {
          const itemId = operation.kind === 'upsert' ? operation.item.id : operation.itemId
          pendingItems.add(itemId)
          const remoteId = operation.kind === 'upsert' ? remoteByLocal.get(operation.item.listId)
            : operation.kind === 'delete' ? (await versions.get(accountKey(accountId, itemId)))?.remoteListId
            : operation.remoteListId
          if (remoteId) editedLists.add(remoteId)
        }
        const latest = new Map<string, AccountFeedChange>()
        const add = (change: AccountFeedChange) => latest.set(change.entity === 'list'
          ? 'list:' + change.listId : 'item:' + change.itemId, change)
        for (const change of snapshot ? [] : previous?.deferred ?? []) add(change)
        for (const change of changes) add(change)
        if (snapshot) {
          for (const mapping of accountMappings) {
            if (mapping.metadata && !latest.has('list:' + mapping.remoteListId))
              add({ entity: 'list', listId: mapping.remoteListId, metadata: null })
          }
          for (const version of await versions.index('byAccount').getAll(accountId)) {
            if (!latest.has('item:' + version.itemId))
              add({ entity: 'item', listId: version.remoteListId, itemId: version.itemId, item: null })
          }
        }
        const deferred: AccountFeedChange[] = []
        const retiredLists = new Set<string>()
        for (const change of latest.values()) {
          if (change.entity !== 'list') continue
          const current = byRemote.get(change.listId)
          if (busyLists.has(change.listId) || (!change.metadata && editedLists.has(change.listId))) {
            deferred.push(change)
            continue
          }
          if (change.metadata) {
            const { name, kind, position, revision, updatedAt } = change.metadata
            if (change.metadata.ownerId !== accountId) throw new Error('Foreign feed list')
            if (!snapshot && current?.cloudRevision !== undefined && current.cloudRevision > revision) continue
            const mapping = { ...(current ?? { key: accountKey(accountId, change.listId), accountId,
              localListId: change.listId, remoteListId: change.listId }), metadata: { name, kind, position, ...(updatedAt !== undefined ? { updatedAt } : current?.metadata?.updatedAt !== undefined ? { updatedAt: current.metadata.updatedAt } : {}) }, cloudRevision: revision }
            if (!current) await mappings.add(mapping)
            else await mappings.put(mapping)
            byRemote.set(change.listId, mapping)
          } else if (current) {
            retiredLists.add(change.listId)
            if (current.metadata) {
              const { metadata: _metadata, ...mapping } = current
              await mappings.put(mapping)
              byRemote.set(change.listId, mapping)
            }
          }
        }
        if (retiredLists.size) {
          for (const known of await versions.index('byAccount').getAll(accountId)) {
            if (retiredLists.has(known.remoteListId) && !pendingItems.has(known.itemId)) await items.delete(known.key)
          }
        }
        for (const change of latest.values()) {
          if (change.entity !== 'item') continue
          if (busyLists.has(change.listId) || pendingItems.has(change.itemId)) {
            deferred.push(change)
            continue
          }
          const mapping = byRemote.get(change.listId)
          const key = accountKey(accountId, change.itemId)
          const known = await versions.get(key)
          if (known && known.remoteListId !== change.listId) throw new Error('Account feed item mapping mismatch')
          if (!change.item) {
            if (known) await items.delete(key)
            continue
          }
          if (!mapping?.metadata || (known && known.version > change.item.version)) continue
          const { id, name, purchased, quantity, unit, createdAt, version } = change.item
          await items.put({ key, accountId, item: { id, listId: mapping.localListId, name, purchased, quantity, unit,
            createdAt: Date.parse(createdAt) } })
          await versions.put({ key, accountId, itemId: id, remoteListId: change.listId, version })
        }
        if (!isActive()) throw new Error('Account changed during feed synchronization')
        if (semanticBatch) {
          let state = storeSemanticBatch(semanticBefore ?? newSemanticState(accountId), semanticBatch)
          if (state.context || state.presented) {
            const localTimes = new Map<string, number>()
            for (const { operation, queuedAt } of operations) {
              if (queuedAt !== undefined && 'remoteListId' in operation)
                localTimes.set(operation.remoteListId, Math.max(localTimes.get(operation.remoteListId) ?? -Infinity, queuedAt))
            }
            const ownPending = [...operations.map(row => row.operation.operationId),
              ...completions.map(row => row.intent.operationId), ...requests.map(row => row.operationId),
              ...accountMappings.flatMap(row => row.pendingMerge ? [row.pendingMerge.operationId] : [])]
            const current: ReconciledSyncContext = {
              accountId, ready: semanticReady(state, deferred),
              lists: [...byRemote.values()].flatMap(row => row.metadata ? [{
                id: row.remoteListId, name: row.metadata.name,
                updatedAt: Math.max(row.metadata.updatedAt ?? -Infinity, localTimes.get(row.remoteListId) ?? -Infinity),
              }] : []),
              items: state.context?.itemId || state.presented?.origin.itemId ?
                (await items.index('byAccount').getAll(accountId)).map(({ item }) => ({
                  id: item.id, listId: remoteByLocal.get(item.listId) ?? item.listId,
                })) : [],
              activity: state.activity,
            }
            state = evaluateSemanticState(state, current, ownPending)
            const live = new Set(current.lists.map(row => row.id))
            state = { ...state, activity: state.activity.filter(id => live.has(id)) }
          }
          await states.put(state)
        } else if (semanticBefore?.evidence) {
          // Legacy server fallback has no trustworthy semantic history.
          await states.put({ ...semanticBefore, evidence: undefined })
        }
        if (!isActive()) throw new Error('Account changed during feed synchronization')
        await feeds.put({ accountId, position, deferred })
        await done
        return true
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await done.catch(() => {})
        throw error
      }
    },
    async readAccountFeedLists(accountId: string): Promise<CloudListMetadata[]> {
      const rows = await (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
      return rows.flatMap(row => row.metadata ? [{ ...row.metadata, id: row.remoteListId, ownerId: accountId,
        revision: row.cloudRevision ?? 0 }] : []).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    },
    async readAccountPending(accountId: string): Promise<PendingItemOperation[]> {
      accountKey(accountId, 'check')
      const records = await (await database).getAllFromIndex('accountOperations', 'byAccount', accountId)
      return records.map(record => record.operation)
    },
    async enqueueAccountPending(accountId: string, operation: PendingItemOperation): Promise<void> {
      const key = accountKey(accountId, operation.operationId)
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountOperations', 'accountCompletions', 'accountListMappings', 'accountItems'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const inFlight = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
      const affected = operation.kind === 'upsert'
        ? operation.item.listId
        : operation.kind === 'delete'
          ? (await tx.objectStore('accountItems').get(accountKey(accountId, operation.itemId)))?.item.listId
          : (await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
              .find(row => row.remoteListId === operation.remoteListId)?.localListId
      const merges = await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId)
      if (merges.some(row => row.pendingMerge && (!affected || mergeTouches(row.pendingMerge, affected)))) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Объединение этих списков ожидает синхронизации.')
      }
      if (inFlight.some(row => !affected || row.intent.localListId === affected)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Completion pending; cannot queue list edits')
      }
      const operations = tx.objectStore('accountOperations')
      const existing = await operations.get(key)
      if (existing && JSON.stringify(existing.operation) !== JSON.stringify(operation)) {
        await tx.done
        throw new Error('Operation ID collision with different payload')
      }
      if (!existing) await operations.add({ key, accountId, operation })
      await tx.done
    },
    async readSyncableAccountPending(accountId: string): Promise<PendingItemOperation[]> {
      const rows = await (await database).getAllFromIndex('accountOperations', 'byAccount', accountId)
      return rows.filter(row => !row.conflict && !row.deferred).map(row => row.operation)
    },
    async readItemDeletionConflicts(accountId: string): Promise<ItemDeletionConflict[]> {
      const rows = await (await database).getAllFromIndex('accountOperations', 'byAccount', accountId)
      return rows.flatMap(row => row.conflict ? [row.conflict] : [])
    },
    async reconcileRejectedEdit(
      accountId: string, operation: CloudPendingOperation,
      decision: { conflict: ItemDeletionConflict } | { defer: true } | {
        serverVersion: number; serverItem?: Item; replacement?: CloudPendingOperation
      },
    ): Promise<void> {
      const tx = (await database).transaction(['accountDeletions', 'accountOperations', 'accountItems', 'accountItemVersions', 'accountListMappings'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const queue = tx.objectStore('accountOperations')
        const key = accountKey(accountId, operation.operationId)
        const current = await queue.get(key)
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, operation.localListId))
        if (!current || JSON.stringify(current.operation) !== JSON.stringify(operation) ||
            mapping?.remoteListId !== operation.remoteListId ||
            (current.conflict && 'serverVersion' in decision && current.conflict.remoteVersion !== decision.serverVersion))
          throw new Error('Cloud item changed during reconciliation')
        if ('conflict' in decision) {
          await queue.put({ ...current, conflict: decision.conflict })
        } else if ('defer' in decision) {
          await queue.put({ ...current, deferred: true })
        } else {
          const { serverVersion, serverItem, replacement } = decision
          const itemKey = accountKey(accountId, operation.itemId)
          const versions = tx.objectStore('accountItemVersions')
          const known = await versions.get(itemKey)
          if (known && (known.remoteListId !== operation.remoteListId || known.version > serverVersion))
            throw new Error('Cloud item version changed during reconciliation')
          await versions.put({ key: itemKey, accountId, itemId: operation.itemId, remoteListId: operation.remoteListId, version: serverVersion })
          const items = tx.objectStore('accountItems')
          if (serverItem && !replacement) await items.put({ key: itemKey, accountId, item: serverItem })
          else await items.delete(itemKey)
          if (replacement) {
            await queue.add({ key: accountKey(accountId, replacement.operationId), accountId, operation: replacement, neverDispatched: true })
            if (replacement.kind !== 'cloud-delete') await items.put({
              key: accountKey(accountId, replacement.itemId), accountId, item: replacement.item,
            })
          }
          await queue.delete(key)
        }
        await tx.done
      } catch (error) {
        try { tx.abort() } catch { /* already closed */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    /** Freeze the payload before the first request, including retries after a restart. */
    async claimAccountPending(accountId: string, operationId: string): Promise<PendingItemOperation> {
      const key = accountKey(accountId, operationId)
      const tx = (await database).transaction('accountOperations', 'readwrite')
      const row = await tx.store.get(key)
      if (!row) {
        await tx.done
        throw new Error('Cloud operation no longer pending')
      }
      if (row.neverDispatched) await tx.store.put({ ...row, neverDispatched: false })
      await tx.done
      return row.operation
    },
    async acknowledgeAccountPending(accountId: string, operationId: string): Promise<void> {
      await (await database).delete('accountOperations', accountKey(accountId, operationId))
    },
    async readAccountListMappings(accountId: string): Promise<ScopedListMapping[]> {
      accountKey(accountId, 'check')
      return (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
    },
    async readLocalListMerge(accountId: string, sourceId: string, targetId: string) {
      const tx = (await database).transaction(['accountListMappings', 'accountItems'])
      const [mappings, rows] = await Promise.all([
        tx.objectStore('accountListMappings').index('byAccount').getAll(accountId),
        tx.objectStore('accountItems').index('byAccount').getAll(accountId),
      ])
      await tx.done
      return mergeSnapshot(mappings, rows.map(row => row.item), sourceId, targetId)
    },
    async readQueuedListMerges(accountId: string) {
      const mappings = await (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
      return mappings.flatMap(row => row.pendingMerge ? [row.pendingMerge] : [])
    },
    async queueLocalListMerge(accountId: string, expected: ListMergeSnapshot, choices: ReadonlyMap<string, MergeChoice>, operationId: string) {
      const tx = (await database).transaction(['accountDeletions', 'accountListMappings', 'accountItems', 'accountCompletions', 'accountCompletionRequests'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const store = tx.objectStore('accountListMappings')
        const mappings = await store.index('byAccount').getAll(accountId)
        const sourceId = expected.source.id, targetId = expected.target.id
        const touched = (id: string) => id === sourceId || id === targetId
        const source = mappings.find(row => row.localListId === sourceId)
        const target = mappings.find(row => row.localListId === targetId)
        if (!source || !target) throw new ListMergeConflict()
        const requests = await tx.objectStore('accountCompletionRequests').index('byAccount').getAll(accountId)
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (mappings.some(row => mergeTouches(row.pendingMerge, sourceId) || mergeTouches(row.pendingMerge, targetId)) ||
            [...requests, ...intents.map(row => row.intent)].some(row => touched(row.localListId)))
          throw new Error('Дождитесь завершения операции с одним из списков.')
        const rows = await tx.objectStore('accountItems').index('byAccount').getAll(accountId)
        const current = mergeSnapshot(mappings, rows.map(row => row.item), sourceId, targetId)
        if (!sameMergeSnapshot(expected, current)) throw new ListMergeConflict()
        const bind = ({ localListId, remoteListId }: ScopedListMapping) => ({ localListId, remoteListId })
        await store.put({ ...source, pendingMerge: {
          operationId, expected: current, result: planListMerge(current, choices),
          source: bind(source), target: bind(target), choices: [...choices],
        } })
        await tx.done
      } catch (error) {
        try { tx.abort() } catch { /* closed */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    async prepareQueuedListMerge(accountId: string, merge: QueuedListMerge, revisions: NonNullable<QueuedListMerge['revisions']>) {
      const tx = (await database).transaction('accountListMappings', 'readwrite')
      const source = await tx.store.get(accountKey(accountId, merge.source.localListId))
      const pending = source?.pendingMerge
      if (!source || pending?.operationId !== merge.operationId) { await tx.done; return undefined }
      const prepared = pending.revisions ? pending : { ...pending, revisions }
      if (!pending.revisions) await tx.store.put({ ...source, pendingMerge: prepared })
      await tx.done
      return prepared
    },
    async finishQueuedListMerge(accountId: string, merge: QueuedListMerge, confirmed?: { item: Item; version: number }[]) {
      const tx = (await database).transaction(['accountDeletions', 'accountSyncEvents', 'accountListMappings', 'accountItems', 'accountItemVersions', 'localProfileRegistry'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const mappings = tx.objectStore('accountListMappings')
        const source = await mappings.get(accountKey(accountId, merge.source.localListId))
        if (source?.pendingMerge?.operationId !== merge.operationId) { await tx.done; return }
        if (!confirmed) {
          const { pendingMerge: _pending, ...rest } = source
          await mappings.put(rest)
        } else {
          const target = await mappings.get(accountKey(accountId, merge.target.localListId))
          if (target?.remoteListId !== merge.target.remoteListId) throw new ListMergeConflict()
          const items = tx.objectStore('accountItems')
          const versions = tx.objectStore('accountItemVersions')
          const rows = await items.index('byAccount').getAll(accountId)
          for (const row of rows) {
            if (!mergeTouches(merge, row.item.listId)) continue
            await items.delete(row.key)
            // Keep the last known version for removed target IDs. A pull
            // started before the merge must not import those rows again.
            if (row.item.listId === merge.source.localListId) await versions.delete(row.key)
          }
          for (const { item, version } of confirmed) {
            const key = accountKey(accountId, item.id)
            await items.put({ key, accountId, item })
            await versions.put({ key, accountId, itemId: item.id, remoteListId: target.remoteListId, version })
          }
          await mappings.delete(source.key)
          const semantic = tx.objectStore('accountSyncEvents')
          await semantic.put(rememberOwnOperation(await semantic.get(accountId) ?? newSemanticState(accountId), merge.operationId))
          await markListsChanged(tx.objectStore('localProfileRegistry'), { accountId })
        }
        await tx.done
      } catch (error) {
        try { tx.abort() } catch { /* closed */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    async readLocalListMappings(accountId: string) {
      const mappings = await (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
      const projected = projectListMetadata(mappings)
      return mappings.map(row => ({ ...row, metadata: projected.get(row.localListId) }))
    },
    async readLocalListChanges(accountId: string) {
      return orderedListChanges(await (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId))
    },
    async queueLocalListChange(accountId: string, id: string, action: 'rename' | 'kind' | 'reorder', value: string) {
      const tx = (await database).transaction(['accountDeletions', 'accountListMappings', 'accountCompletionRequests', 'accountCompletions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const store = tx.objectStore('accountListMappings')
        const mappings = await store.index('byAccount').getAll(accountId)
        if (mappings.some(row => mergeTouches(row.pendingMerge, id) || (action === 'reorder' && mergeTouches(row.pendingMerge, value))))
          throw new Error('Объединение этих списков ожидает синхронизации.')
        const mapping = mappings.find(row => row.localListId === id)
        const projected = projectListMetadata(mappings)
        const before = projected.get(id)
        if (!mapping || !before) throw new Error('Локальная копия списка недоступна.')
        const requests = await tx.objectStore('accountCompletionRequests').index('byAccount').getAll(accountId)
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if ([...requests, ...intents.map(row => row.intent)].some(row => row.localListId === id || (action === 'reorder' && row.localListId === value)))
          throw new Error('Сначала дождитесь завершения операции со списком.')
        let change: CloudListChange
        let targetId: string | undefined
        if (action === 'rename') {
          const name = value.trim()
          if (!name || name.length > 120) throw new Error('Введите название списка от 1 до 120 символов.')
          assertFreeListName([...projected].map(([listId, row]) => ({ id: listId, name: row.name })), id, name)
          change = { action, name }
        } else if (action === 'kind') {
          if (value !== 'oneoff' && value !== 'permanent') throw new Error('Неизвестный тип списка.')
          change = { action, kind: value }
        } else {
          const target = projected.get(value)
          if (!target || before.position === target.position) throw new Error('Порядок списков изменился. Попробуйте ещё раз.')
          targetId = mappings.find(row => row.localListId === value)?.remoteListId
          change = { action, position: target.position }
        }
        const sequence = (orderedListChanges(mappings).at(-1)?.sequence ?? 0) + 1
        const operation = { localListId: id, remoteListId: mapping.remoteListId, operationId: crypto.randomUUID(),
          before, change, sequence, targetId }
        await store.put({ ...mapping, pendingMetadata: [...(mapping.pendingMetadata ?? []), operation] })
        await tx.done
      } catch (error) { try { tx.abort() } catch { /* already closed */ }; await tx.done.catch(() => {}); throw error }
    },
    async prepareLocalListChange(accountId: string, change: LocalListChange, before: CloudListMetadata) {
      const tx = (await database).transaction('accountListMappings', 'readwrite')
      const mapping = await tx.store.get(accountKey(accountId, change.localListId))
      const saved = mapping?.pendingMetadata?.find(row => row.operationId === change.operationId)
      if (!mapping || !saved || before.ownerId !== accountId || before.id !== change.remoteListId) {
        await tx.done
        throw new Error('Локальная операция со списком недоступна.')
      }
      if (!saved.prepared) {
        await tx.store.put({ ...mapping, pendingMetadata: mapping.pendingMetadata!.map(row =>
          row.operationId === saved.operationId ? { ...row, prepared: before } : row) })
      }
      await tx.done
      return saved.prepared ?? before
    },
    async finishLocalListChange(accountId: string, change: LocalListChange) {
      const tx = (await database).transaction('accountListMappings', 'readwrite')
      const mapping = await tx.store.get(accountKey(accountId, change.localListId))
      if (mapping?.pendingMetadata) {
        await tx.store.put({ ...mapping, pendingMetadata: mapping.pendingMetadata.filter(row => row.operationId !== change.operationId) })
      }
      await tx.done
    },
    async cacheAccountListMetadata(accountId: string, rows: readonly {
      id: string; ownerId: string; name: string; kind: 'permanent' | 'oneoff'; position: number; revision?: number; updatedAt?: number
    }[], { partial = false } = {}): Promise<void> {
      if (rows.some(row => row.ownerId !== accountId)) throw new Error('Foreign list metadata')
      const byId = new Map(rows.map(row => [row.id, row]))
      const tx = (await database).transaction('accountListMappings', 'readwrite')
      for (const mapping of await tx.store.index('byAccount').getAll(accountId)) {
        const row = byId.get(mapping.remoteListId)
        if (row) {
          const { name, kind, position, updatedAt } = row
          await tx.store.put({ ...mapping, metadata: { name, kind, position, ...(updatedAt !== undefined ? { updatedAt } : mapping.metadata?.updatedAt !== undefined ? { updatedAt: mapping.metadata.updatedAt } : {}) }, cloudRevision: row.revision ?? mapping.cloudRevision })
        } else if (!partial && mapping.metadata) {
          const { metadata: _metadata, ...withoutMetadata } = mapping
          await tx.store.put(withoutMetadata)
        }
      }
      await tx.done
    },
    async setAccountListSymbol(accountId: string, localListId: string, remoteListId: string, symbol: string): Promise<void> {
      const key = accountKey(accountId, localListId)
      const tx = (await database).transaction('accountListMappings', 'readwrite')
      const row = await tx.store.get(key)
      if (!row || row.remoteListId !== remoteListId) {
        await tx.done
        throw new Error('Локальная копия списка ещё не готова.')
      }
      await tx.store.put({ ...row, symbol })
      await tx.done
    },
    async bindAccountList(accountId: string, localListId: string, remoteListId: string): Promise<void> {
      if (!localListId.trim() || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(remoteListId)) {
        throw new Error('Invalid list mapping')
      }
      const key = accountKey(accountId, localListId)
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountListMappings'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const existing = await tx.objectStore('accountListMappings').get(key)
      if (existing && existing.remoteListId !== remoteListId) {
        await tx.done
        throw new Error('List mapping cannot be silently replaced')
      }
      if (!existing && (await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId)).some(row => row.remoteListId === remoteListId)) {
        await tx.done
        throw new Error('Cloud list is already bound to another local ID')
      }
      if (!existing) await tx.objectStore('accountListMappings').add({ key, accountId, localListId, remoteListId })
      await tx.done
    },
    /** Persist an account edit and its cloud operation in one IndexedDB transaction. */
    async saveAccountItemsToSync(accountId: string, items: Item[]): Promise<void> {
      const listId = items[0]?.listId
      if (!listId || items.some(item => item.listId !== listId))
        throw new Error('Batch must belong to one list')
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountOperations', 'accountListMappings', 'accountCompletions', 'accountCompletionRequests', 'accountDraftLists'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, listId))
        if ((await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
          .some(row => mergeTouches(row.pendingMerge, listId)))
          throw new Error('Объединение этих списков ожидает синхронизации.')
        const draft = !mapping && await tx.objectStore('accountDraftLists').get(accountKey(accountId, listId))
        if (!mapping && !draft) throw new Error('Missing verified list mapping')
        const remoteListId = mapping?.remoteListId ?? listId
        const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        const request = await tx.objectStore('accountCompletionRequests').get(accountKey(accountId, remoteListId))
        if (request || intents.some(row => row.intent.remoteListId === remoteListId))
          throw new Error('Completion pending; list edits are temporarily locked')
        const itemStore = tx.objectStore('accountItems')
        checkItemNames((await itemStore.index('byAccount').getAll(accountId)).map(row => row.item), items)
        for (const item of items) {
          await itemStore.add({ key: accountKey(accountId, item.id), accountId, item })
          if (!mapping) continue
          const operation: CloudPendingOperation = {
            kind: 'cloud-add', operationId: crypto.randomUUID(), localListId: listId,
            remoteListId: mapping.remoteListId, itemId: item.id, item, preserveCreatedAt: true,
          }
          await tx.objectStore('accountOperations').add({ key: accountKey(accountId, operation.operationId), accountId, operation, queuedAt: Date.now(), neverDispatched: true })
        }
        await tx.done
      } catch (error) {
        try { tx.abort() } catch { /* closed */ }
        await tx.done.catch(() => {})
        throw error
      }
    },
    async saveAccountEdit(accountId: string, operation: CloudPendingOperation): Promise<void> {
      await writeAccountEdit(accountId, operation)
    },
    async mergeUnsentAccountEdit(accountId: string, item: Item, remoteListId: string): Promise<boolean> {
      return writeAccountEdit(accountId, {
        kind: 'cloud-add', operationId: crypto.randomUUID(), itemId: item.id,
        localListId: item.listId, remoteListId, item,
      }, true)
    },
    /** Atomically record an acknowledged RPC receipt and remove its exact queued operation. */
    async commitAccountReceipt(accountId: string, operationId: string, remoteListId: string, itemId: string, version: number): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId) ||
          !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid server receipt')
      const key = accountKey(accountId, operationId)
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountSyncEvents', 'accountOperations', 'accountItemVersions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const pending = await tx.objectStore('accountOperations').get(key)
      if (!pending || pending.operation.kind === 'upsert' || pending.operation.kind === 'delete' ||
          pending.operation.itemId !== itemId || pending.operation.remoteListId !== remoteListId) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Receipt does not match queued cloud operation')
      }
      const versions = tx.objectStore('accountItemVersions')
      const versionKey = accountKey(accountId, itemId)
      const previous = await versions.get(versionKey)
      if (previous && (previous.remoteListId !== remoteListId || version < previous.version)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Server version regression or list mismatch')
      }
      await versions.put({ key: versionKey, accountId, remoteListId, itemId, version })
      if (pending.operation.kind === 'cloud-delete') {
        const semantic = tx.objectStore('accountSyncEvents')
        await semantic.put(rememberOwnOperation(await semantic.get(accountId) ?? newSemanticState(accountId), operationId))
      }
      await tx.objectStore('accountOperations').delete(key)
      await tx.done
    },
    /** Import a server-only item and its confirmed version atomically; never overwrite local work. */
    async importRemoteOnlyItem(accountId: string, remoteListId: string, item: Item, version: number): Promise<void> {
      if (!Number.isSafeInteger(version) || version < 0 ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote item version or list')
      }
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, item.listId))
      const key = accountKey(accountId, item.id)
      const existing = await tx.objectStore('accountItems').get(key)
      const knownVersion = await tx.objectStore('accountItemVersions').get(key)
      const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
      if (!mapping || mapping.remoteListId !== remoteListId || existing || knownVersion ||
          queued.some(row => row.operation.kind === 'delete' ? row.operation.itemId === item.id :
            row.operation.kind === 'upsert' ? row.operation.item.id === item.id : row.operation.itemId === item.id)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Remote import conflicts with local state')
      }
      await tx.objectStore('accountItems').add({ key, accountId, item })
      await tx.objectStore('accountItemVersions').add({ key, accountId, itemId: item.id, remoteListId, version })
      await tx.done
    },
    /** All-or-nothing import of a reviewed remote-only batch. */
    async importRemoteOnlyBatch(accountId: string, remoteListId: string,
      entries: { item: Item; version: number }[]): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote list ID')
      }
      if (!entries.length) return
      const ids = new Set(entries.map(entry => entry.item.id))
      if (ids.size !== entries.length || entries.some(entry =>
        !Number.isSafeInteger(entry.version) || entry.version < 0)) throw new Error('Invalid import batch')
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings', 'accountCompletions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const inFlight = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (inFlight.some(row => row.intent.remoteListId === remoteListId)) throw new Error('Completion pending; import/review blocked')
        if ((await tx.objectStore('accountListMappings').index('byAccount').getAll(accountId))
          .some(row => mergeTouches(row.pendingMerge, entries[0].item.listId)))
          throw new Error('Объединение этих списков ожидает синхронизации.')
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, entries[0].item.listId))
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
        if (!mapping || mapping.remoteListId !== remoteListId ||
            entries.some(entry => entry.item.listId !== mapping.localListId) ||
            queued.some(row => {
              const op = row.operation
              const id = op.kind === 'upsert' ? op.item.id : op.kind === 'delete' ? op.itemId : op.itemId
              return ids.has(id)
            })) throw new Error('Remote import conflicts with local state')
        for (const entry of entries) {
          const key = accountKey(accountId, entry.item.id)
          if (await tx.objectStore('accountItems').get(key) ||
              await tx.objectStore('accountItemVersions').get(key)) {
            throw new Error('Remote import conflicts with local state')
          }
          await tx.objectStore('accountItems').add({ key, accountId, item: entry.item })
          await tx.objectStore('accountItemVersions').add({
            key, accountId, itemId: entry.item.id, remoteListId, version: entry.version,
          })
        }
        await tx.done
      } catch (error) {
        tx.abort()
        await tx.done.catch(() => {})
        throw error
      }
    },
    /** Apply newer cloud evidence if the local item and version are still current. */
    async applyVersionedItemChanges(accountId: string, localListId: string, remoteListId: string,
      entries: readonly VersionedItemChange[]): Promise<number> {
      if (!entries.length) return 0
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountItemVersions', 'accountOperations',
        'accountListMappings', 'accountCompletions', 'accountCompletionRequests'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      const mappings = tx.objectStore('accountListMappings')
      if ((await mappings.index('byAccount').getAll(accountId)).some(row => mergeTouches(row.pendingMerge, localListId))) {
        await tx.done
        return 0
      }
      const mapping = await mappings.get(accountKey(accountId, localListId))
      const intents = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
      const request = await tx.objectStore('accountCompletionRequests').get(accountKey(accountId, remoteListId))
      if (mapping?.remoteListId !== remoteListId || request || intents.some(row => row.intent.remoteListId === remoteListId)) {
        await tx.done
        return 0
      }
      const operations = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
      const pending = new Set(operations.map(({ operation }) =>
        operation.kind === 'upsert' ? operation.item.id : operation.itemId))
      const items = tx.objectStore('accountItems')
      const versions = tx.objectStore('accountItemVersions')
      let applied = 0
      for (const entry of entries) {
        const itemId = entry.before.id
        if (pending.has(itemId) || entry.before.listId !== localListId ||
            (entry.after && (entry.after.listId !== localListId || entry.after.id !== itemId)) ||
            !Number.isSafeInteger(entry.version) || entry.version <= entry.expectedVersion) continue
        const key = accountKey(accountId, itemId)
        const [current, known] = await Promise.all([items.get(key), versions.get(key)])
        if (!current || !sameItemSnapshot(current.item, entry.before) ||
            known?.remoteListId !== remoteListId || known.version !== entry.expectedVersion) continue
        if (entry.after) await items.put({ key, accountId, item: entry.after })
        else await items.delete(key)
        await versions.put({ ...known, version: entry.version })
        applied++
      }
      await tx.done
      return applied
    },
    /** Explicitly reviewed server deletions, committed atomically only if local evidence is unchanged. */
    async applyReviewedRemoteDeletions(accountId: string, remoteListId: string,
      entries: { item: Item; expectedLocalVersion: number; serverDeletedVersion: number }[]): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId)) {
        throw new Error('Invalid remote list ID')
      }
      if (!entries.length) return
      const ids = new Set(entries.map(row => row.item.id))
      if (ids.size !== entries.length || entries.some(row =>
        !Number.isSafeInteger(row.expectedLocalVersion) || row.expectedLocalVersion < 0 ||
        !Number.isSafeInteger(row.serverDeletedVersion) || row.serverDeletedVersion <= row.expectedLocalVersion)) {
        throw new Error('Invalid reviewed deletion batch')
      }
      const db = await database
      const tx = db.transaction(['accountDeletions', 'accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings', 'accountCompletions'], 'readwrite')
      if (await tx.objectStore('accountDeletions').get(accountId)) throw new Error('Account data was deleted')
      try {
        const inFlight = await tx.objectStore('accountCompletions').index('byAccount').getAll(accountId)
        if (inFlight.some(row => row.intent.remoteListId === remoteListId)) throw new Error('Completion pending; import/review blocked')
        const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, entries[0].item.listId))
        const queued = await tx.objectStore('accountOperations').index('byAccount').getAll(accountId)
        if (!mapping || mapping.remoteListId !== remoteListId ||
            entries.some(row => row.item.listId !== mapping.localListId) ||
            queued.some(row => ids.has(row.operation.kind === 'upsert' ?
              row.operation.item.id : row.operation.itemId))) {
          throw new Error('Reviewed deletion conflicts with local state')
        }
        for (const row of entries) {
          const key = accountKey(accountId, row.item.id)
          const stored = await tx.objectStore('accountItems').get(key)
          const version = await tx.objectStore('accountItemVersions').get(key)
          if (!stored || JSON.stringify(stored.item) !== JSON.stringify(row.item) ||
              !version || version.remoteListId !== remoteListId ||
              version.version !== row.expectedLocalVersion) {
            throw new Error('Reviewed deletion conflicts with local state')
          }
        }
        for (const row of entries) {
          const key = accountKey(accountId, row.item.id)
          await tx.objectStore('accountItems').delete(key)
          await tx.objectStore('accountItemVersions').put({
            key, accountId, itemId: row.item.id, remoteListId, version: row.serverDeletedVersion,
          })
        }
        await tx.done
      } catch (error) {
        tx.abort()
        await tx.done.catch(() => {})
        throw error
      }
    },
    /** Persist only server-confirmed versions; never infer a version from local edits. */
    async recordAccountItemVersion(accountId: string, remoteListId: string, itemId: string, version: number): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId) ||
          !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid server item version')
      const key = accountKey(accountId, itemId)
      const db = await database
      const tx = db.transaction('accountItemVersions', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && (existing.remoteListId !== remoteListId || version < existing.version)) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Server version regression or list mismatch')
      }
      await tx.store.put({ key, accountId, remoteListId, itemId, version })
      await tx.done
    },
    async readAccountItemVersions(accountId: string): Promise<ScopedVersion[]> {
      accountKey(accountId, 'check')
      return (await database).getAllFromIndex('accountItemVersions', 'byAccount', accountId)
    },
    async close() { (await database).close() },
  }
}
export type Storage = ReturnType<typeof createStorage>
