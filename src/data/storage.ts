import { openDB, type DBSchema } from 'idb'
import { addProfile, bindProfile, initializeProfiles, switchProfile, removeProfileMetadata, type LocalProfileRegistry } from './local-profiles'
import { lists as defaultLists, type Item } from '../domain/shopping'
import type { PendingItemOperation, CloudPendingOperation } from './pending-operations'

interface ScopedListMapping { key: string; accountId: string; localListId: string; remoteListId: string }
interface ScopedOperation {
  key: string
  accountId: string
  operation: PendingItemOperation
}
interface ScopedVersion { key: string; accountId: string; itemId: string; remoteListId: string; version: number }
interface ScopedItem { key: string; accountId: string; item: Item }
export interface ShoppingListRecord {
  id: string; name: string; symbol: string; kind: 'permanent' | 'oneoff'; createdAt: number; position?: number
}
export interface ArchivedListRecord {
  id: string; sourceListId: string; name: string; kind: 'permanent' | 'oneoff'; completedAt: number; items: Item[]
}
interface ProfileOwnedRecord<T> { key: string; profileId: string; record: T }
interface ShoppingDB extends DBSchema {
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
  accountListMappings: { key: string; value: ScopedListMapping; indexes: { byAccount: string } }
  accountItemVersions: { key: string; value: ScopedVersion; indexes: { byAccount: string } }
}
function accountKey(accountId: string, operationId: string): string {
  if (!accountId.trim() || !operationId.trim()) throw new Error('Account and operation IDs are required')
  return JSON.stringify([accountId, operationId])
}
export function createStorage(name = 'shopping-app') {
  const blockedListeners = new Set<() => void>()
  let upgradeBlocked = false
  const database = openDB<ShoppingDB>(name, 10, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('pendingOperations')) db.createObjectStore('pendingOperations', { keyPath: 'operationId' })
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
    // A v10 versionchange forces cooperative v9 clients to close; v9 clients
    // cannot reopen after the upgrade. Uncooperative older connections block
    // the upgrade, so cutover cannot start while they still hold the database.
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
      const tx = db.transaction(['profileLists', 'profileItems'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const key = JSON.stringify([profileId, listId])
        if (!await tx.objectStore('profileLists').get(key)) throw new Error('Список не найден в профиле')
        const items = await tx.objectStore('profileItems').index('byProfile').getAll(profileId)
        for (const row of items) if (row.record.listId === listId) await tx.objectStore('profileItems').delete(row.key)
        await tx.objectStore('profileLists').delete(key)
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
        const registry = addProfile(current.registry, { id, cloudAccountId: null, createdAt })
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
        const registry = switchProfile(current.registry, profileId)
        // A cloud-bound profile cannot be activated as an unauthenticated guest.
        if (registry.profiles.find(profile => profile.id === profileId)?.cloudAccountId !== null) {
          throw new Error('Cloud-bound profile requires verified account')
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
    /** Irreversible LOCAL-only purge, requiring a fresh exact confirmation.
     * Never removes the original migrated guest, the last profile, or cloud data.
     */
    async deleteLocalProfile(profileId: string, confirmationId: string): Promise<LocalProfileRegistry> {
      if (!profileId.trim() || confirmationId !== profileId) throw new Error('Profile deletion confirmation mismatch')
      const db = await database
      const tx = db.transaction([
        'localProfileRegistry', 'profileCutover', 'profileLists', 'profileItems',
        'profileArchives', 'profilePendingOperations',
      ], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const current = await tx.objectStore('localProfileRegistry').get('device')
        if (!current) throw new Error('Local profiles not initialized')
        const cutover = await tx.objectStore('profileCutover').get('legacy-guest-v1')
        if (!cutover) throw new Error('Profile cutover is not active')
        if (cutover.profileId === profileId) throw new Error('Original guest profile cannot be deleted')
        const registry = removeProfileMetadata(current.registry, profileId)
        const pending = await tx.objectStore('profilePendingOperations').index('byProfile').getAll(profileId)
        if (pending.length) throw new Error('Profile has unsynced operations; deletion blocked')
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
    /** All profile writes require an existing profile and completed legacy cutover.
     * This guard prevents accidental cross-profile writes before migration.
     */
    async saveProfileItem(profileId: string, item: Item): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        const key = JSON.stringify([profileId, item.id])
        await tx.objectStore('profileItems').put({ key, profileId, record: item })
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
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        for (const item of items) {
          const key = JSON.stringify([profileId, item.id])
          await tx.objectStore('profileItems').put({ key, profileId, record: item })
        }
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already finished */ }
        await done.catch(() => {})
        throw error
      }
    },
    async removeProfileItem(profileId: string, itemId: string): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profileMigrations', 'profileItems'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
        if (!registry?.profiles.some(profile => profile.id === profileId)) throw new Error('Unknown local profile')
        if (!await tx.objectStore('profileMigrations').get('legacy-guest-v1')) throw new Error('Profile migration is incomplete')
        await tx.objectStore('profileItems').delete(JSON.stringify([profileId, itemId]))
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
      const tx = db.transaction(['localProfileRegistry', 'profileLists'], 'readwrite')
      const registry = (await tx.objectStore('localProfileRegistry').get('device'))?.registry
      if (!registry?.profiles.some(profile => profile.id === profileId)) {
        tx.abort(); await tx.done.catch(() => {})
        throw new Error('Unknown local profile')
      }
      await tx.objectStore('profileLists').put({
        key: JSON.stringify([profileId, list.id]), profileId, record: list,
      })
      await tx.done
    },
    async renameProfileList(profileId: string, listId: string, name: string): Promise<void> {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 120) throw new Error('Введите название списка от 1 до 120 символов.')
      const db = await database
      const tx = db.transaction('profileLists', 'readwrite')
      const key = JSON.stringify([profileId, listId])
      const existing = await tx.store.get(key)
      if (!existing) { await tx.done; throw new Error('Список не найден в профиле') }
      await tx.store.put({ ...existing, record: { ...existing.record, name: trimmed } })
      await tx.done
    },
    async changeProfileListKind(profileId: string, listId: string, kind: ShoppingListRecord['kind']): Promise<void> {
      if (kind !== 'permanent' && kind !== 'oneoff') throw new Error('Недопустимый тип списка')
      const db = await database
      const tx = db.transaction('profileLists', 'readwrite')
      const key = JSON.stringify([profileId, listId])
      const existing = await tx.store.get(key)
      if (!existing) { await tx.done; throw new Error('Список не найден в профиле') }
      await tx.store.put({ ...existing, record: { ...existing.record, kind } })
      await tx.done
    },
    async completeProfileList(profileId: string, listId: string, archiveId: string, completedAt: number): Promise<void> {
      const db = await database
      const tx = db.transaction(['profileLists', 'profileItems', 'profileArchives'], 'readwrite')
      const done = tx.done
      void done.catch(() => {})
      try {
        const key = JSON.stringify([profileId, listId])
        const list = await tx.objectStore('profileLists').get(key)
        if (!list) throw new Error('Список не найден в профиле')
        const rows = (await tx.objectStore('profileItems').index('byProfile').getAll(profileId))
          .filter(row => row.record.listId === listId)
        if (!rows.length) throw new Error('Cannot archive an empty list')
        const archive: ArchivedListRecord = {
          id: archiveId, sourceListId: listId, name: list.record.name,
          kind: list.record.kind, completedAt, items: rows.map(row => row.record),
        }
        await tx.objectStore('profileArchives').add({
          key: JSON.stringify([profileId, archiveId]), profileId, record: archive,
        })
        for (const row of rows) await tx.objectStore('profileItems').delete(row.key)
        if (list.record.kind === 'oneoff') await tx.objectStore('profileLists').delete(key)
        await done
      } catch (error) {
        try { tx.abort() } catch { /* already aborted */ }
        await done.catch(() => {})
        throw error
      }
    },
    async enqueueProfilePending(profileId: string, operation: PendingItemOperation): Promise<void> {
      const db = await database
      const tx = db.transaction(['localProfileRegistry', 'profilePendingOperations'], 'readwrite')
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
      await legacyMutation(['lists'], async tx => { await tx.objectStore('lists').put(list) })
    },
    async renameList(listId: string, name: string): Promise<void> {
      const trimmed = name.trim()
      if (!trimmed || trimmed.length > 120) throw new Error('Введите название списка от 1 до 120 символов.')
      await legacyMutation(['lists'], async tx => {
        const store = tx.objectStore('lists')
        const list = await store.get(listId)
        if (!list) throw new Error('Список не найден')
        await store.put({ ...list, name: trimmed })
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
        for (const item of items) await tx.objectStore('items').put(item)
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
    async completeList(list: ShoppingListRecord, archiveId: string, completedAt: number): Promise<void> {
      await legacyMutation(['lists', 'items', 'archives'], async tx => {
        const items = (await tx.objectStore('items').getAll()).filter(item => item.listId === list.id)
        if (!items.length) throw new Error('Cannot archive an empty list')
        await tx.objectStore('archives').add({
          id: archiveId, sourceListId: list.id, name: list.name, kind: list.kind, completedAt, items,
        })
        for (const item of items) await tx.objectStore('items').delete(item.id)
        if (list.kind === 'oneoff') await tx.objectStore('lists').delete(list.id)
      })
    },
    async read(): Promise<Item[]> { return (await database).getAll('items') },
    async save(item: Item): Promise<void> {
      await legacyMutation(['items'], async tx => { await tx.objectStore('items').put(item) })
    },
    async remove(id: string): Promise<void> {
      await legacyMutation(['items'], async tx => { await tx.objectStore('items').delete(id) })
    },
    // Guest items remain in the original store until explicit migration.
    async readAccountItems(accountId: string): Promise<Item[]> {
      accountKey(accountId, 'check')
      const rows = await (await database).getAllFromIndex('accountItems', 'byAccount', accountId)
      return rows.map(row => row.item)
    },
    async saveAccountItem(accountId: string, item: Item): Promise<void> {
      const key = accountKey(accountId, item.id)
      await (await database).put('accountItems', { key, accountId, item })
    },
    async removeAccountItem(accountId: string, itemId: string): Promise<void> {
      await (await database).delete('accountItems', accountKey(accountId, itemId))
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
    async readAccountPending(accountId: string): Promise<PendingItemOperation[]> {
      accountKey(accountId, 'check')
      const records = await (await database).getAllFromIndex('accountOperations', 'byAccount', accountId)
      return records.map(record => record.operation)
    },
    async enqueueAccountPending(accountId: string, operation: PendingItemOperation): Promise<void> {
      const key = accountKey(accountId, operation.operationId)
      const db = await database
      const tx = db.transaction('accountOperations', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && JSON.stringify(existing.operation) !== JSON.stringify(operation)) {
        await tx.done
        throw new Error('Operation ID collision with different payload')
      }
      if (!existing) await tx.store.add({ key, accountId, operation })
      await tx.done
    },
    async acknowledgeAccountPending(accountId: string, operationId: string): Promise<void> {
      await (await database).delete('accountOperations', accountKey(accountId, operationId))
    },
    async readAccountListMappings(accountId: string): Promise<ScopedListMapping[]> {
      accountKey(accountId, 'check')
      return (await database).getAllFromIndex('accountListMappings', 'byAccount', accountId)
    },
    async bindAccountList(accountId: string, localListId: string, remoteListId: string): Promise<void> {
      if (!localListId.trim() || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(remoteListId)) {
        throw new Error('Invalid list mapping')
      }
      const key = accountKey(accountId, localListId)
      const db = await database
      const tx = db.transaction('accountListMappings', 'readwrite')
      const existing = await tx.store.get(key)
      if (existing && existing.remoteListId !== remoteListId) {
        await tx.done
        throw new Error('List mapping cannot be silently replaced')
      }
      if (!existing) await tx.store.add({ key, accountId, localListId, remoteListId })
      await tx.done
    },
    /** Persist an account edit and its cloud operation in one IndexedDB transaction. */
    async saveAccountEdit(accountId: string, operation: CloudPendingOperation): Promise<void> {
      if (!operation.itemId.trim() || !operation.localListId.trim() ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operation.remoteListId) ||
          (operation.kind !== 'cloud-add' && (!Number.isSafeInteger(operation.expectedVersion) || operation.expectedVersion < 0)) ||
          (operation.kind !== 'cloud-delete' && (operation.item.id !== operation.itemId || operation.item.listId !== operation.localListId))) {
        throw new Error('Invalid account edit operation')
      }
      const key = accountKey(accountId, operation.operationId)
      const db = await database
      const tx = db.transaction(['accountItems', 'accountOperations', 'accountListMappings'], 'readwrite')
      const mapping = await tx.objectStore('accountListMappings').get(accountKey(accountId, operation.localListId))
      if (!mapping || mapping.remoteListId !== operation.remoteListId) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Missing verified list mapping')
      }
      const operations = tx.objectStore('accountOperations')
      const existing = await operations.get(key)
      if (existing) {
        if (JSON.stringify(existing.operation) !== JSON.stringify(operation)) {
          tx.abort()
          await tx.done.catch(() => {})
          throw new Error('Operation ID collision with different payload')
        }
        await tx.done
        return
      }
      // Until sequential edits can be rebased from confirmed receipts, a
      // second pending mutation for the same item would reuse a stale version.
      // Reject it atomically rather than silently overwrite or lose an edit.
      const queued = await operations.index('byAccount').getAll(accountId)
      if (queued.some(row => {
        const pending = row.operation
        return pending.kind !== 'delete' &&
          (pending.kind === 'upsert' ? pending.item.id : pending.itemId) === operation.itemId
      })) {
        tx.abort()
        await tx.done.catch(() => {})
        throw new Error('Item has an unconfirmed cloud change')
      }
      const itemKey = accountKey(accountId, operation.itemId)
      const items = tx.objectStore('accountItems')
      if (operation.kind === 'cloud-delete') {
        await items.delete(itemKey)
      } else {
        await items.put({ key: itemKey, accountId, item: operation.item })
      }
      await operations.add({ key, accountId, operation })
      await tx.done
    },
    /** Atomically record an acknowledged RPC receipt and remove its exact queued operation. */
    async commitAccountReceipt(accountId: string, operationId: string, remoteListId: string, itemId: string, version: number): Promise<void> {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(remoteListId) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(itemId) ||
          !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid server receipt')
      const key = accountKey(accountId, operationId)
      const db = await database
      const tx = db.transaction(['accountOperations', 'accountItemVersions'], 'readwrite')
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
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
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
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      try {
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
      const tx = db.transaction(['accountItems', 'accountItemVersions', 'accountOperations', 'accountListMappings'], 'readwrite')
      try {
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
