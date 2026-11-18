import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceDialog } from './WorkspaceDialog'
import { LocalProfileLimitError, profileName } from './data/local-profiles'
import { App } from './App'
import { syncGuestImports } from './data/guest-import'
import { SiriSetup } from './SiriSetup'
import { lists, type ListId } from './domain/shopping'
import { fetchOwnedCloudLists, type OwnedCloudList } from './data/owned-cloud-lists'
import { fetchCloudListMetadata, type CloudListMetadata } from './data/e4-cloud-list-metadata'
import { sendCloudListChange, type CloudListChange } from './data/e4-cloud-list-operations'
import { createCloudList } from './data/e4-cloud-list-create'
import { fetchCloudArchive, type CloudArchiveCompletion } from './data/cloud-archive'
import { inspectCloudCompletion } from './data/cloud-completion-preflight'
import { createCloudCompletionCoordinator } from './data/cloud-completion-coordinator'
import type { CompletionMode } from './data/cloud-completion-rpc'
import { bindVerifiedOwnedList } from './data/verified-list-binding'
import { createAccountSync } from './data/account-sync'
import type { CloudCompletionRequest, Storage } from './data/storage'
import type { ProfileSyncState } from './ProfileMenu'
import type { ListOperationStatus } from './App'
import { createAuthController } from './data/auth-controller'
import { createSignOutGuard } from './data/signout-guard'
import { verifiedAccountId, verifySessionIdentity } from './data/verified-account'
import type { AuthView } from './data/auth-view'
import type { SessionCandidate } from './data/auth-scope'

type Controller = ReturnType<typeof createAuthController>

const showLabControls = import.meta.env.VITE_LAB_CONTROLS === 'true'

export function AuthenticatedApp({ storage, client }: { storage: Storage; client: SupabaseClient | null }) {
  const [view, setView] = useState<AuthView>(client ? { status: 'checking' } : { status: 'guest' })
  const [controller, setController] = useState<Controller | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cloudLists, setCloudLists] = useState<OwnedCloudList[]>([])
  const [cloudMetadata, setCloudMetadata] = useState<CloudListMetadata[] | null>(null)
  const [cloudMetadataError, setCloudMetadataError] = useState('')
  const [cloudMutationBusy, setCloudMutationBusy] = useState(false)
  const [cloudArchives, setCloudArchives] = useState<CloudArchiveCompletion[] | null>(null)
  const [cloudArchiveError, setCloudArchiveError] = useState('')
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false)
  const loadingArchiveFor = useRef<string | null>(null)
  const archiveRefreshRequested = useRef<string | null>(null)
  const [completionPreflight, setCompletionPreflight] = useState('')
  const [completionBusy, setCompletionBusy] = useState(false)
  const [cloudBindings, setCloudBindings] = useState<Record<string, string>>({})
  const [cloudLoading, setCloudLoading] = useState(false)
  const [selectedLocal, setSelectedLocal] = useState<ListId>('groceries')
  const [selectedRemote, setSelectedRemote] = useState('')
  const [cloudPreview, setCloudPreview] = useState<string | null>(null)
  const [deletionReview, setDeletionReview] = useState<{ accountId: string; localListId: ListId; remoteListId: string; items: { id: string; name: string }[] } | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [cloudMappingRevision, setCloudMappingRevision] = useState(0)
  const [cloudRefreshStatus, setCloudRefreshStatus] = useState('')
  const [syncError, setSyncError] = useState('')
  const [listOperations, setListOperations] = useState<ListOperationStatus[]>([])
  const [syncOnline, setSyncOnline] = useState(() => navigator.onLine)
  const [pushState, setPushState] = useState<{ account: string; status: 'syncing' | 'done' | 'error' }>()
  const [pullState, setPullState] = useState<{ account: string; status: 'syncing' | 'done' | 'error' }>()
  const [pendingSync, setPendingSync] = useState<{ account: string; pending: boolean }>()
  const [syncQueueRevision, setSyncQueueRevision] = useState(0)
  const [dismissedSyncError, setDismissedSyncError] = useState(false)
  const completionWorkers = useRef(new Set<string>())
  const completionRequested = useRef(new Set<string>())
  const currentAccount = view.status === 'account' ? view.accountId : null
  const offlineAccount = view.status === 'offline-account' ? view.accountId : null
  const workspaceAccount = currentAccount ?? offlineAccount
  useEffect(() => {
    const update = () => setSyncOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  useEffect(() => {
    if (!workspaceAccount) return
    const account = workspaceAccount
    let active = true
    void storage.hasAccountSyncWork(account).then(pending => {
      if (active) setPendingSync({ account, pending })
    }).catch(() => {
      if (active) setPendingSync(undefined)
    })
    return () => { active = false }
  }, [storage, workspaceAccount, workspaceRevision, pushState, pullState, listOperations, accountDialogOpen, syncQueueRevision])
  useEffect(() => { setSyncError('') }, [currentAccount])

  useEffect(() => {
    if (!currentAccount || !client) { setVerifiedEmail(''); return }
    let cancelled = false
    void client.auth.getUser().then(({ data, error }) => {
      if (!cancelled && !error && data.user?.id === currentAccount) setVerifiedEmail(data.user.email ?? '')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentAccount, client])
  useEffect(() => {
    if (view.status === 'account') { setAccountDialogOpen(false); setPassword('') }
  }, [view.status])
  const [offlineLists, setOfflineLists] = useState<{
    accountId: string; bindings: Record<string, string>;
    lists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[]
  } | null>(null)
  const [readyAccount, setReadyAccount] = useState<string | null>(null)
  const [profileError, setProfileError] = useState('')
  const [transferError, setTransferError] = useState('')
  const [transferPrompt, setTransferPrompt] = useState<{ phase: 'consent' | 'collision'; name: string; existing: boolean; collisions: string[] } | null>(null)
  const transferAnswer = useRef<((answer: 'skip' | 'separate' | 'merge' | 'yes') => void) | null>(null)
  function answerTransfer(answer: 'skip' | 'separate' | 'merge' | 'yes') {
    transferAnswer.current?.(answer)
    transferAnswer.current = null
    setTransferPrompt(null)
  }
  // The account ID is only trusted after a fresh server verification. Keep
  // account-scoped UI unmounted until its local profile exists durably.
  useEffect(() => {
    setTransferError('')
    if (!workspaceAccount || !client) { setReadyAccount(null); setProfileError(''); return }
    if (offlineAccount) {
      let cancelled = false
      setReadyAccount(null)
      setProfileError('')
      void Promise.all([storage.readLocalProfiles(), storage.readAccountListMappings(offlineAccount)]).then(([registry, mappings]) => {
        if (cancelled) return
        if (!registry?.profiles.some(p => p.cloudAccountId === offlineAccount)) throw new Error('No verified local binding')
        setOfflineLists({
          accountId: offlineAccount,
          bindings: Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId])),
          lists: mappings.filter(row => row.metadata)
            .sort((a, b) => a.metadata!.position - b.metadata!.position)
            .map(row => ({ id: row.localListId, name: row.metadata!.name, kind: row.metadata!.kind })),
        })
        setReadyAccount(offlineAccount)
      }).catch(() => { if (!cancelled) setProfileError('Локальный профиль не подтверждён. Доступ заблокирован.') })
      return () => { cancelled = true }
    }
    if (!currentAccount) return
    let cancelled = false
    setReadyAccount(null)
    setProfileError('')
    void (async () => {
      if (await verifiedAccountId(client) !== currentAccount) throw new Error('Account verification changed')
      if (!await storage.readGuestCutoverOwner()) {
        await storage.migrateLegacyGuestToProfile()
        await storage.markGuestCutoverReady()
      }
      if (await verifiedAccountId(client) !== currentAccount) throw new Error('Account verification changed')
      const identity = await client.auth.getUser()
      if (identity.error || identity.data.user?.id !== currentAccount || cancelled) return
      const registry = await storage.readLocalProfiles()
      const source = registry?.profiles.find(p => p.id === registry.activeProfileId && !p.cloudAccountId)
      const pending = await storage.readGuestImports(currentAccount)
      let collisionMode: 'separate' | 'merge' | undefined
      if (source && !pending.length) {
        const prompt = { name: profileName(source, registry!.profiles.indexOf(source)),
          existing: registry!.profiles.some(p => p.cloudAccountId === currentAccount), collisions: [] as string[] }
        const ask = (phase: 'consent' | 'collision', collisions: string[] = []) => new Promise<'skip' | 'separate' | 'merge' | 'yes'>(resolve => {
          if (cancelled) { resolve('skip'); return }
          transferAnswer.current = resolve
          setTransferPrompt({ ...prompt, phase, collisions })
        })
        const answer = await ask('consent')
        if (cancelled) return
        if (answer === 'yes') {
          const [local, remote] = await Promise.all([storage.readProfileLists(source.id), fetchCloudListMetadata(client, currentAccount)])
          if (cancelled) return
          const collisions = local.filter(list => remote.some(row => row.name.trim().toLowerCase() === list.name.trim().toLowerCase())).map(list => list.name)
          const choice = collisions.length ? await ask('collision', collisions) : 'separate'
          if (cancelled) return
          if (choice === 'separate' || choice === 'merge') collisionMode = choice
        }
      }
      if (cancelled || await verifiedAccountId(client) !== currentAccount) return
      await storage.ensureVerifiedAccountProfile(currentAccount, { login: identity.data.user.email,
        ...(source && collisionMode ? { sourceProfileId: source.id, collisionMode } : {}) })
      try {
        await syncGuestImports(storage, client, currentAccount,
          async () => !cancelled && await verifiedAccountId(client) === currentAccount)
      } catch (error) {
        if (!cancelled) setTransferError((error as { code?: string })?.code === '23505'
          ? 'Перенос остановлен: в аккаунте уже есть список с таким названием. Локальные данные сохранены.'
          : 'Перенос локального профиля не завершён. Данные сохранены. Повторите вход после восстановления связи.')
      }
      const rows = await fetchCloudListMetadata(client, currentAccount)
      if (cancelled || await verifiedAccountId(client) !== currentAccount) return
      const mappings = await storage.readAccountListMappings(currentAccount)
      const restore = await storage.needsAccountCacheRestore(currentAccount)
      const existing = new Set(mappings.filter(row => row.metadata).map(row => row.remoteListId))
      const missing = rows.filter(row => !existing.has(row.id))
      const hydrate = restore ? rows : missing
      for (let offset = 0; offset < hydrate.length; offset += 8) {
        if (cancelled || await verifiedAccountId(client) !== currentAccount) return
        await Promise.all(hydrate.slice(offset, offset + 8).map(async row => {
          const localListId = mappings.find(mapping => mapping.remoteListId === row.id)?.localListId ?? row.id
          await storage.bindAccountList(currentAccount, localListId, row.id)
          await createAccountSync(storage, client, {
            accountId: currentAccount, localListId, remoteListId: row.id,
            isActive: () => !cancelled,
          }).importRemoteOnly()
        }))
      }
      if (cancelled || await verifiedAccountId(client) !== currentAccount) return
      await storage.cacheAccountListMetadata(currentAccount, rows)
      if (restore) await storage.confirmAccountCacheRestore(currentAccount)
      const confirmedMappings = await storage.readAccountListMappings(currentAccount)
      if (!cancelled) {
        setCloudMetadata(rows)
        setCloudLists(rows.map(row => ({ id: row.id, name: row.name })))
        setCloudBindings(Object.fromEntries(confirmedMappings.map(row => [row.localListId, row.remoteListId])))
      }
      if (!cancelled && await verifiedAccountId(client) === currentAccount) setReadyAccount(currentAccount)
    })().catch((cause: unknown) => {
      if (!cancelled) setProfileError(cause instanceof LocalProfileLimitError ? cause.message : 'Не удалось безопасно открыть локальный профиль аккаунта. Покупки сохранены; повторите открытие.')
    })
    return () => { cancelled = true; transferAnswer.current?.('skip'); transferAnswer.current = null; setTransferPrompt(null) }
  }, [client, currentAccount, offlineAccount, workspaceAccount, storage])
  const activeAccount = useRef<string | null>(null)
  // A verified session is not enough: the account workspace must have a
  // durable local profile before any background sync or refresh may run.
  activeAccount.current = readyAccount === currentAccount ? currentAccount : null
  const automaticFlushRunning = useRef(false)
  const flushRequested = useRef(false)
  const onQueued = useCallback(() => {
    setSyncQueueRevision(revision => revision + 1)
    if (!client || !currentAccount || readyAccount !== currentAccount || !navigator.onLine) return
    flushRequested.current = true
    if (automaticFlushRunning.current) return
    const accountId = currentAccount
    automaticFlushRunning.current = true
    setPushState({ account: accountId, status: 'syncing' })
    setDismissedSyncError(false)
    void (async () => {
      try {
        if (activeAccount.current !== accountId) return
        if (await verifiedAccountId(client) !== accountId) throw new Error('Account could not be verified')
        do {
          flushRequested.current = false
          const [mappings, owned] = await Promise.all([
            storage.readAccountListMappings(accountId),
            fetchOwnedCloudLists(client, accountId),
          ])
          if (activeAccount.current !== accountId) return
          const ownedIds = new Set(owned.map(row => row.id))
          for (const mapping of mappings) {
          if (activeAccount.current !== accountId) return
          if (!ownedIds.has(mapping.remoteListId)) continue
          await createAccountSync(storage, client, {
            accountId, localListId: mapping.localListId as ListId,
            remoteListId: mapping.remoteListId,
            isActive: () => activeAccount.current === accountId,
            onReconciled: () => setWorkspaceRevision(value => value + 1),
          }).flush()
          }
        } while (flushRequested.current && activeAccount.current === accountId)
        if (activeAccount.current === accountId) {
          setSyncError('')
          setPushState({ account: accountId, status: 'done' })
        }
      } catch {
        if (activeAccount.current === accountId) {
          setSyncError('Не удалось отправить изменения. Повторите синхронизацию.')
          setPushState({ account: accountId, status: 'error' })
        }
      } finally {
        automaticFlushRunning.current = false
        if (activeAccount.current !== accountId) flushRequested.current = false
      }
    })()
  }, [client, currentAccount, readyAccount, storage])

  // A browser restart can leave durable operations queued without a new edit.
  // Resume only after the account becomes active; onQueued verifies the server
  // identity before accessing account-scoped mappings and pending operations.
  useEffect(() => {
    if (currentAccount && readyAccount === currentAccount && client) onQueued()
  }, [currentAccount, readyAccount, client, onQueued])

  // Retry durable account edits when connectivity returns; never sync guest data.
  useEffect(() => {
    if (!currentAccount || readyAccount !== currentAccount || !client) return
    const retry = () => onQueued()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [client, currentAccount, readyAccount, onQueued])

  // Subscriptions are effects, not render-time side effects. React StrictMode
  // may mount, dispose and mount again during development.
  useEffect(() => {
    if (!client) {
      setView({ status: 'guest' })
      setController(null)
      return
    }
    setView({ status: 'checking' })
    const guard = createSignOutGuard(window.localStorage)
    if (guard.isPending()) setError('Предыдущий выход не завершён. Повторите выход из аккаунта.')
    const next = createAuthController({
      getSession: async () => {
        const result = await client.auth.getSession()
        return { data: { session: result.data.session as SessionCandidate | null }, error: result.error }
      },
      onAuthStateChange: callback => client.auth.onAuthStateChange((event, session) => callback(event, session as SessionCandidate | null)),
      signInWithPassword: credentials => client.auth.signInWithPassword(credentials),
      signOut: () => client.auth.signOut(),
    }, setView, guard, session => verifySessionIdentity(client, session), async session => {
      if (navigator.onLine || guard.isPending()) return null
      const id = session.user?.id?.toLowerCase()
      const registry = await storage.readLocalProfiles()
      return registry?.profiles.some(profile => profile.cloudAccountId === id) ? id : null
    })
    setController(next)
    void next.initialize()
    return () => {
      next.dispose()
      setController(null)
    }
  }, [client, storage])

  // On reconnect, revalidate the server identity before allowing cloud access.
  useEffect(() => {
    if (!offlineAccount || !controller) return
    const recheck = () => {
      if (navigator.onLine) {
        void controller.initialize()
      }
    }
    window.addEventListener('online', recheck)
    return () => window.removeEventListener('online', recheck)
  }, [offlineAccount, controller])

  // Clear transient controls on identity change; startup publishes verified
  // metadata and bindings together after the snapshot has been restored.
  useEffect(() => {
    setCloudLists([])
    setCloudMetadata(null)
    setCloudMetadataError('')
    setCloudRefreshStatus('')
    setCloudBindings({})
    setSelectedRemote('')
    setCloudPreview(null)
    setDeletionReview(null)
  }, [workspaceAccount])

  useEffect(() => {
    if (!currentAccount || readyAccount !== currentAccount || !cloudMetadata ||
        cloudMetadata.some(row => row.ownerId !== currentAccount)) return
    void storage.cacheAccountListMetadata(currentAccount, cloudMetadata).catch(() => {
      if (activeAccount.current === currentAccount)
        setCloudRefreshStatus('Не удалось сохранить списки для офлайн-доступа.')
    })
  }, [currentAccount, readyAccount, cloudMetadata, cloudBindings, storage])

  // Read-only cloud refresh for verified, bound lists. Never apply remote
  // deletions or overwrite local edits without explicit user review.
  useEffect(() => {
    if (!client || !currentAccount || readyAccount !== currentAccount) return
    const accountId = currentAccount
    let disposed = false
    let running = false
    let refreshRequested = false
    async function refresh() {
      if (!client || disposed || document.visibilityState === 'hidden' || !navigator.onLine) return
      if (running) {
        refreshRequested = true
        return
      }
      running = true
      setPullState({ account: accountId, status: 'syncing' })
      setDismissedSyncError(false)
      refreshRequested = false
      let imported = 0
      let failed = false
      try {
        if (activeAccount.current !== accountId) return
        if (await verifiedAccountId(client) !== accountId) throw new Error('Account could not be verified')
        const [mappings, owned, completions] = await Promise.all([
          storage.readAccountListMappings(accountId),
          fetchCloudListMetadata(client, accountId),
          storage.readAccountCompletions(accountId),
        ])
        const stillActive = () => !disposed && activeAccount.current === accountId
        const mappingsByRemoteId = new Map(mappings.map(mapping => [mapping.remoteListId, mapping]))
        const completing = new Set(completions.map(row => row.remoteListId))
        for (const row of owned) {
          if (!stillActive()) return
          if (completing.has(row.id)) continue
          const mapping = mappingsByRemoteId.get(row.id)
          const localListId = mapping?.localListId ?? row.id
          try {
            if (!mapping) await storage.bindAccountList(accountId, localListId, row.id)
            imported += await createAccountSync(storage, client, {
              accountId,
              localListId,
              remoteListId: row.id,
              isActive: stillActive,
            }).importRemoteOnly()
            if (!stillActive()) return
            if (!mapping?.metadata) {
              await storage.cacheAccountListMetadata(accountId, [row], { partial: true })
              if (!stillActive()) return
              setCloudBindings(current => ({ ...current, [localListId]: row.id }))
              setCloudMetadata(current => current?.some(list => list.id === row.id) ? current
                : [...(current ?? []), row].sort((a, b) => a.position - b.position))
              setCloudLists(current => current.some(list => list.id === row.id) ? current
                : [...current, { id: row.id, name: row.name }])
            }
          } catch {
            // Keep processing other bound lists, but never import conflicting
            // items from this list or hide the error from the account owner.
            if (disposed || activeAccount.current !== accountId) return
            failed = true
          }
        }
      } catch {
        // Identity, mapping, or network errors outside a single list.
        failed = true
      } finally {
        if (!disposed && activeAccount.current === accountId) {
          setPullState({ account: accountId, status: failed ? 'error' : 'done' })
          if (imported > 0) setWorkspaceRevision(value => value + 1)
          if (failed) setCloudRefreshStatus(imported > 0
            ? 'Получено новых покупок: ' + imported + '. Некоторые списки не удалось обновить.'
            : 'Не удалось обновить некоторые списки. Повторите синхронизацию.')
          else setCloudRefreshStatus(imported > 0 ? 'Получено новых покупок из облака: ' + imported : '')
        }
        running = false
        if (refreshRequested) void refresh()
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const onOnline = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    void refresh()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [client, currentAccount, readyAccount, storage, cloudMappingRevision])

  async function loadCloudMetadata() {
    if (!client || !currentAccount || readyAccount !== currentAccount || cloudLoading) return
    const accountId = currentAccount
    setCloudLoading(true)
    setCloudMetadataError('')
    setCloudMetadata(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const records = await fetchCloudListMetadata(client, accountId)
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      setCloudMetadata(records)
    } catch {
      if (activeAccount.current === accountId)
        setCloudMetadataError('Не удалось проверить метаданные облачных списков. Данные не изменены.')
    } finally { setCloudLoading(false) }
  }

  async function addCloudList(newCloudListName: string, newCloudListKind: 'permanent' | 'oneoff', symbol?: string) {
    if (!client || !currentAccount || readyAccount !== currentAccount ||
        cloudMutationBusy || cloudLoading || !newCloudListName.trim()) return
    const accountId = currentAccount
    setCloudMutationBusy(true)
    setCloudMetadataError('')
    try {
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      const created = await createCloudList(client, accountId, crypto.randomUUID(), newCloudListName, newCloudListKind)
      void storage.markAccountListsChanged(accountId).catch(() => {})
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      const refreshed = await fetchCloudListMetadata(client, accountId)
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      // A newly created cloud list has no legacy local ID. Bind its verified
      // server UUID to the same account-scoped local ID before enabling edits.
      // Never infer ownership from the displayed name or fall back to guest data.
      await bindVerifiedOwnedList(storage, client, accountId, created.id, created.id,
        () => activeAccount.current === accountId)
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      if (symbol && symbol !== '🛒') {
        try {
          await storage.setAccountListSymbol(accountId, created.id, created.id, symbol)
        } catch {
          if (activeAccount.current === accountId)
            setCloudMetadataError('Список создан. Не удалось сохранить пиктограмму на устройстве.')
        }
      }
      if (activeAccount.current !== accountId) return
      setCloudBindings(previous => ({ ...previous, [created.id]: created.id }))
      setCloudMappingRevision(value => value + 1)
      setCloudMetadata(refreshed)
      setCloudLists(refreshed.map(row => ({ id: row.id, name: row.name })))
      return true
    } catch (error) {
      if (activeAccount.current === accountId)
        setCloudMetadataError((error as { code?: string })?.code === '23505' ? 'Список с таким названием уже существует.' : 'Создание не подтверждено. Проверьте состояние облака перед повторной попыткой.')
    } finally { setCloudMutationBusy(false) }
  }

  async function changeCloudMetadata(row: CloudListMetadata, change: CloudListChange) {
    if (!client || !currentAccount || readyAccount !== currentAccount ||
        cloudMutationBusy || cloudLoading || row.ownerId !== currentAccount ||
        !cloudMetadata?.some(value => value.id === row.id && value.revision === row.revision)) return
    const accountId = currentAccount
    setCloudMutationBusy(true)
    setCloudMetadataError('')
    try {
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      await sendCloudListChange(client, row, crypto.randomUUID(), change)
      void storage.markAccountListsChanged(accountId).catch(() => {})
      const refreshed = await fetchCloudListMetadata(client, accountId)
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      setCloudMetadata(refreshed)
      setCloudLists(refreshed.map(value => ({ id: value.id, name: value.name })))
      return true
    } catch (error) {
      if (activeAccount.current === accountId) {
        if ((error as { code?: string })?.code === '23505') setCloudMetadataError('Список с таким названием уже существует.')
        else setCloudMetadataError('Изменение не подтверждено сервером. Проверьте список заново; не повторяйте операцию до проверки состояния.')
      }
    } finally { setCloudMutationBusy(false) }
  }

  async function loadCloudLists() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    setCloudLoading(true)
    setError('')
    try {
      const [remote, mappings] = await Promise.all([
        fetchOwnedCloudLists(client, accountId),
        storage.readAccountListMappings(accountId),
      ])
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setCloudLists(remote)
      setCloudBindings(Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId])))
      setCloudMappingRevision(value => value + 1)
      setSelectedRemote('')
    } catch {
      setError('Не удалось проверить облачные списки. Повторите загрузку.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function bindCloudList(event: FormEvent) {
    event.preventDefault()
    if (!client || view.status !== 'account' || !selectedRemote || cloudLoading) return
    const accountId = view.accountId
    setCloudLoading(true)
    setError('')
    try {
      await bindVerifiedOwnedList(storage, client, accountId, selectedLocal, selectedRemote,
        () => view.status === 'account' && view.accountId === accountId)
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setCloudBindings(current => ({ ...current, [selectedLocal]: selectedRemote }))
      setCloudMappingRevision(value => value + 1)
      setSelectedRemote('')
    } catch {
      setError('Не удалось привязать список. Проверьте аккаунт и выбранный список.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function flushCloudQueue() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const remoteListId = cloudBindings[selectedLocal]
    if (!remoteListId) return
    setCloudLoading(true)
    setError('')
    try {
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      const sync = createAccountSync(storage, client, {
        accountId, remoteListId, localListId: selectedLocal,
        isActive: () => activeAccount.current === accountId,
        onReconciled: () => setWorkspaceRevision(value => value + 1),
      })
      const count = await sync.flush()
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setError(count === 0 ? 'Нет подготовленных изменений.' : 'Отправлено изменений: ' + count)
    } catch {
      setError('Отправка не завершена. Неподтверждённые изменения остаются в очереди.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function compareCloudList() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const result = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).preview()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setCloudPreview('Только просмотр: новых в облаке — ' + result.remoteOnly.length +
        ', расхождений — ' + result.conflicts.length +
        ', ожидают отправки — ' + result.pendingCount + '. Локальные покупки не изменены.')
    } catch {
      setCloudPreview('Сравнение не удалось. Локальные покупки не изменены.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function compareCloudDeletions() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    setDeletionReview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const result = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).previewDeletions()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setDeletionReview({ accountId, localListId, remoteListId, items: result.reviewItems })
      setCloudPreview('Удаления в облаке: подтверждённые версии — ' +
        result.confirmedDeletions.length + ', конфликты — ' + result.conflicts.length +
        ', без известной версии — ' + result.unknownVersions.length +
        '. Ничего не удалено.')
    } catch {
      setCloudPreview('Проверка удалений не удалась. Локальные покупки не изменены.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function confirmCloudDeletions() {
    const review = deletionReview
    if (!client || !review || view.status !== 'account' || cloudLoading ||
        review.accountId !== view.accountId || review.localListId !== selectedLocal ||
        review.remoteListId !== cloudBindings[selectedLocal] || !review.items.length) return
    const names = review.items.map(item => item.name).join(', ')
    if (!window.confirm('Удалить с этого устройства ' + review.items.length +
      ' товаров, уже удалённых в облаке? ' + names)) return
    setCloudLoading(true)
    setDeletionReview(null)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== review.accountId) throw new Error('Account changed')
      const count = await createAccountSync(storage, client, {
        accountId: review.accountId, localListId: review.localListId, remoteListId: review.remoteListId,
        isActive: () => activeAccount.current === review.accountId,
      }).applyConfirmedDeletions(review.items.map(item => item.id))
      if (activeAccount.current !== review.accountId) throw new Error('Account changed')
      setWorkspaceRevision(value => value + 1)
      setCloudPreview('Подтверждённых удалений применено: ' + count + '.')
    } catch {
      setCloudPreview('Удаления не применены: состояние изменилось или проверка не пройдена. Повторите сравнение.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function importCloudItems() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const count = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).importRemoteOnly()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setWorkspaceRevision(value => value + 1)
      setCloudPreview('Импортировано новых покупок: ' + count + '.')
    } catch {
      setCloudPreview('Импорт остановлен: есть конфликт или ошибка проверки. Существующие покупки не перезаписаны.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!controller || busy) return
    setBusy(true)
    setError('')
    try {
      await controller.signIn(email.trim(), password)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }
  async function previewCloudCompletion() {
    if (!client || !currentAccount || cloudLoading) return
    const remoteListId = cloudBindings[selectedLocal]
    if (!remoteListId) {
      setCompletionPreflight('Сначала привяжите локальный список к облачному.')
      return
    }
    setCloudLoading(true)
    setCompletionPreflight('')
    const accountId = currentAccount
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Аккаунт изменился')
      const result = await inspectCloudCompletion(
        storage, client, accountId, selectedLocal, remoteListId,
        () => activeAccount.current === accountId,
      )
      if (await verifiedAccountId(client) !== accountId) throw new Error('Аккаунт изменился')
      setCompletionPreflight(result.ready
        ? 'Список согласован с облаком (ревизия ' + result.revision + '). Завершение доступно в панели выбранного списка.'
        : 'Завершение пока небезопасно: ' + result.reason)
    } catch {
      setCompletionPreflight('Проверка завершения не удалась. Изменения не выполнялись.')
    } finally { setCloudLoading(false) }
  }

  function setListOperation(operation: ListOperationStatus) {
    setListOperations(rows => [...rows.filter(row => row.accountId !== operation.accountId || row.localListId !== operation.localListId), operation])
  }
  function clearListOperation(accountId: string, localListId: string) {
    setListOperations(rows => rows.filter(row => row.accountId !== accountId || row.localListId !== localListId))
  }

  async function processListOperations(accountId: string) {
    if (!client || activeAccount.current !== accountId || !navigator.onLine) return
    completionRequested.current.add(accountId)
    if (completionWorkers.current.has(accountId)) return
    completionWorkers.current.add(accountId)
    setCompletionBusy(true)
    const stillActive = () => activeAccount.current === accountId
    try {
      const coordinator = createCloudCompletionCoordinator(storage, client, accountId, stillActive)
      const attempted = new Set<string>()
      do {
        completionRequested.current.delete(accountId)
        const [requests, intents] = await Promise.all([
          storage.readAccountCompletionRequests(accountId),
          storage.readAccountCompletions(accountId),
        ])
        const queue = [
          ...requests,
          ...intents.filter(intent => !requests.some(request => request.operationId === intent.operationId))
            .map(intent => ({ ...intent, name: cloudMetadata?.find(row => row.id === intent.remoteListId)?.name ?? 'Облачный список' })),
        ]
        for (const request of queue) {
          if (!stillActive() || !navigator.onLine) return
          if (attempted.has(request.operationId)) continue
          attempted.add(request.operationId)
          const { localListId, remoteListId, mode, operationId } = request
          const status = { accountId, localListId, name: request.name, mode }
          setListOperation({ ...status, phase: 'running' })
          try {
            if (await verifiedAccountId(client) !== accountId || !stillActive()) throw new Error('Account changed')
            const intent = (await storage.readAccountCompletions(accountId)).find(row => row.operationId === operationId)
            if (!intent) {
              if (!requests.some(row => row.operationId === operationId)) {
                clearListOperation(accountId, localListId)
                continue
              }
              await createAccountSync(storage, client, { accountId, localListId, remoteListId, isActive: stillActive }).flush()
            }
            const receipt = intent ? await coordinator.resume(intent) :
              await coordinator.begin(localListId, remoteListId, mode, 'confirmedMarked' in request ? request.confirmedMarked : undefined, operationId)
            if (!stillActive()) return
            if (receipt.mode === 'delete_list' || (receipt.kind === 'oneoff' && receipt.mode !== 'archive_purchased')) {
              setCloudMetadata(rows => rows?.filter(row => row.id !== remoteListId) ?? null)
              setCloudLists(rows => rows.filter(row => row.id !== remoteListId))
            }
            if (receipt.mode === 'delete_list')
              setCloudBindings(rows => Object.fromEntries(Object.entries(rows).filter(([, id]) => id !== remoteListId)))
            clearListOperation(accountId, localListId)
            setCompletionPreflight(receipt.mode === 'delete_list' ? '' : receipt.mode === 'archive_purchased'
              ? 'Отмеченные покупки перемещены в архив.' : 'Список завершён.')
            setCloudArchives(null)
            setWorkspaceRevision(value => value + 1)
            void loadCloudArchive(true)
            try {
              const refreshed = await fetchCloudListMetadata(client, accountId)
              if (stillActive()) {
                setCloudMetadata(refreshed)
                setCloudLists(refreshed.map(row => ({ id: row.id, name: row.name })))
              }
            } catch {
              if (stillActive()) setPullState({ account: accountId, status: 'error' })
            }
          } catch (cause) {
            if (!stillActive()) return
            const [saved, prepared] = await Promise.all([
              storage.readAccountCompletionRequests(accountId),
              storage.readAccountCompletions(accountId),
            ])
            if (!stillActive()) return
            const uncertain = prepared.some(row => row.operationId === operationId)
            const unsent = saved.find(row => row.operationId === operationId)
            const retry = uncertain || !!unsent
            setListOperation({
              ...status, phase: 'error', retry: retry ? () => void processListOperations(accountId) : undefined,
              message: retry ? (cause instanceof Error && cause.message.startsWith('Список изменился.') ? cause.message
                : mode === 'delete_list' ? 'Не удалось подтвердить удаление' : 'Не удалось подтвердить завершение')
                : (mode === 'delete_list' ? 'Список изменился. Проверьте его и подтвердите удаление заново.'
                  : 'Список изменился. Проверьте его и подтвердите завершение заново.'),
              dismiss: unsent && !uncertain ? async () => {
                if (await storage.cancelUnsentAccountCompletion(unsent)) clearListOperation(accountId, localListId)
              } : retry ? undefined : () => clearListOperation(accountId, localListId),
            })
            if (showLabControls && cause instanceof Error) setCompletionPreflight(cause.message)
          }
        }
      } while (completionRequested.current.has(accountId) && stillActive())
    } catch {
      if (stillActive()) setCompletionPreflight('Не удалось прочитать очередь операций со списками.')
    } finally {
      completionWorkers.current.delete(accountId)
      completionRequested.current.delete(accountId)
      if (stillActive()) setCompletionBusy(false)
    }
  }
  useEffect(() => {
    if (!workspaceAccount || workspaceAccount !== readyAccount) return
    const account = workspaceAccount
    let cancelled = false
    void storage.readAccountCompletionRequests(account).then(requests => {
      if (cancelled) return
      for (const request of requests) setListOperation({ ...request, phase: 'queued' })
      if (currentAccount === account) void processListOperations(account)
    }).catch(() => { if (!cancelled) setCompletionPreflight('Не удалось прочитать очередь операций со списками.') })
    return () => { cancelled = true }
    // A stored operation is resumed only for the verified account after reconnection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceAccount, readyAccount, currentAccount, syncOnline])

  async function completeCloudList(localListId: ListId, mode: CompletionMode, confirmedMarked?: boolean, confirmedItemIds?: readonly string[]) {
    if (!client || !currentAccount || activeAccount.current !== currentAccount) return
    const accountId = currentAccount
    const remoteListId = cloudBindings[localListId]
    const row = cloudMetadata?.find(list => list.id === remoteListId)
    if (!remoteListId || !row) return
    if (mode !== 'delete_list' && mode !== 'archive_purchased' && !window.confirm(mode === 'none_purchased'
      ? 'Завершить список без покупок? Товары будут очищены, архив покупок не пополнится.'
      : 'Завершить облачный список? Купленные товары попадут в архив, активные товары будут очищены.')) return
    const request: CloudCompletionRequest = {
      accountId, localListId, remoteListId, name: row.name, mode, confirmedMarked, confirmedItemIds,
      operationId: crypto.randomUUID(), createdAt: Date.now(),
    }
    setCompletionPreflight('')
    try {
      await storage.queueAccountCompletion(request)
      if (activeAccount.current !== accountId) return
      setListOperation({ ...request, phase: 'queued' })
      void processListOperations(accountId)
    } catch (error) {
      if (activeAccount.current === accountId) setCompletionPreflight(error instanceof Error && error.message.startsWith('Список изменился.')
        ? error.message : 'Не удалось поставить операцию со списком в очередь.')
    }
  }

  async function recoverCloudCompletions() {
    if (currentAccount) await processListOperations(currentAccount)
  }
  async function loadCloudArchive(refresh = false) {
    if (!client || !currentAccount) return
    if (loadingArchiveFor.current === currentAccount) {
      if (refresh) archiveRefreshRequested.current = currentAccount
      return
    }
    loadingArchiveFor.current = currentAccount
    setCloudArchiveBusy(true)
    setCloudArchiveError('')
    try {
      // Verify the active identity; never show snapshots from an old account.
      const { data: { user }, error: identityError } = await client.auth.getUser()
      if (identityError || user?.id !== currentAccount) throw new Error('Аккаунт не подтверждён')
      const snapshots = await fetchCloudArchive(client)
      const { data: { user: stillCurrent }, error: recheckError } = await client.auth.getUser()
      if (recheckError || stillCurrent?.id !== currentAccount) throw new Error('Аккаунт изменился')
      if (activeAccount.current !== currentAccount) return
      await storage.cacheAccountArchive(currentAccount, snapshots)
      if (activeAccount.current === currentAccount) setCloudArchives(snapshots)
    } catch (err) {
      if (activeAccount.current === currentAccount)
        setCloudArchiveError(err instanceof Error ? err.message : 'Не удалось загрузить архив')
    } finally {
      if (loadingArchiveFor.current === currentAccount) {
        loadingArchiveFor.current = null
        setCloudArchiveBusy(false)
        if (archiveRefreshRequested.current === currentAccount && activeAccount.current === currentAccount) {
          archiveRefreshRequested.current = null
          void loadCloudArchive()
        }
      }
    }
  }
  useEffect(() => {
    setCloudArchives(null)
    setCloudArchiveError('')
    setCompletionPreflight('')
  }, [workspaceAccount])

  useEffect(() => {
    if (currentAccount && readyAccount === currentAccount) void loadCloudArchive()
    // Refresh once when this account's workspace is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccount, readyAccount])

  async function signOut() {
    if (!controller || busy) return
    setBusy(true)
    setError('')
    try {
      await controller.signOut()
      setAccountDialogOpen(false)
      setVerifiedEmail('')
    } catch {
      setError('Не удалось завершить выход на сервере. Проверьте подключение.')
    } finally {
      setBusy(false)
    }
  }
  if (workspaceAccount && (readyAccount !== workspaceAccount || profileError)) return <main>
    {transferPrompt && <WorkspaceDialog label={transferPrompt.phase === 'consent' ? 'Синхронизация локального профиля' : 'Совпадают названия списков'} className="e4-create profile-transfer-dialog" onDismiss={() => answerTransfer('skip')}>
      {transferPrompt.phase === 'consent' ? <>
        <h2>Синхронизировать профиль «{transferPrompt.name}» с аккаунтом?</h2>
        <p>Списки, товары и архив будут перенесены в аккаунт. Профиль будет называться логином аккаунта.</p>
        {transferPrompt.existing && <p>На устройстве уже есть профиль этого аккаунта. Данные будут объединены с ним, а исходный локальный профиль удалён после успешного переноса.</p>}
        <p>Если отказаться, локальный профиль останется отдельным.</p>
        <button type="button" onClick={() => answerTransfer('yes')}>Синхронизировать профиль</button>
        <button type="button" onClick={() => answerTransfer('skip')}>Не синхронизировать</button>
      </> : <>
        <h2>Совпадают названия списков</h2>
        <p>Выберите действие для всех совпадений ({transferPrompt.collisions.length}).</p>
        <ul>{transferPrompt.collisions.map(name => <li key={name}>{name}</li>)}</ul>
        <button type="button" onClick={() => answerTransfer('separate')}>Создать отдельные списки с постфиксом (2)</button>
        <button type="button" onClick={() => answerTransfer('merge')}>Объединить товары</button>
        <p>При объединении сохранятся все товары, включая одноимённые. Тип существующего облачного списка не изменится.</p>
        <button type="button" onClick={() => answerTransfer('skip')}>Отменить перенос</button>
      </>}
    </WorkspaceDialog>}
    {profileError ? <p role="alert">{profileError}</p> : <p role="status">Подготавливаем локальный профиль аккаунта…</p>}
    {profileError && <>
      <button type="button" onClick={() => window.location.reload()}>Повторить открытие</button>
      <button type="button" disabled={busy || !controller} onClick={() => void signOut()}>Вернуться к локальным профилям</button>
      {error && <p role="alert">{error}</p>}
    </>}
  </main>
  if (view.status === 'checking') return <main>
    <p role="status">{error ? 'Аккаунт заблокирован до завершения выхода.' : busy ? 'Выходим из аккаунта…' : 'Проверяем аккаунт…'}</p>
    {error && <><p role="alert">{error}</p><button disabled={busy || !controller} onClick={() => void signOut()}>Повторить выход</button></>}
  </main>
  const pendingWork = pendingSync && pendingSync.account === workspaceAccount ? pendingSync.pending : undefined
  const ownPush = pushState?.account === currentAccount ? pushState?.status : undefined
  const ownPull = pullState?.account === currentAccount ? pullState?.status : undefined
  const syncFailed = ownPush === 'error' || ownPull === 'error'
  const activeOperations = listOperations.filter(row => row.accountId === workspaceAccount)
  const listSyncFailed = activeOperations.some(row => row.phase === 'error' && row.retry)
  const syncState: ProfileSyncState | undefined = !workspaceAccount ? undefined
    : !syncOnline || !!offlineAccount ? (pendingWork || activeOperations.some(row => row.phase !== 'error' || row.retry) ? 'waiting' : 'offline')
    : ownPush === 'syncing' || ownPull === 'syncing' || activeOperations.some(row => row.phase === 'running') ? 'syncing'
    : syncFailed || listSyncFailed ? 'error'
    : pendingWork || activeOperations.some(row => row.phase !== 'error' || row.retry) ? 'waiting'
    : ownPush === 'done' && ownPull === 'done' && pendingWork === false ? 'synced' : 'waiting'
  function retrySync() {
    setDismissedSyncError(false)
    if (currentAccount && listSyncFailed) void processListOperations(currentAccount)
    onQueued()
    setCloudMappingRevision(value => value + 1)
  }
  return <>
    {client && view.status === 'offline-account' && <p role="status">Локальный профиль: нет сети. Облако недоступно до повторной проверки аккаунта.</p>}
    <App storage={storage} accountId={workspaceAccount} cloudOffline={!!offlineAccount} onQueued={workspaceAccount ? onQueued : undefined} refreshRevision={workspaceRevision}
      onResolveItemDeletion={client && currentAccount && readyAccount === currentAccount ? async (conflict, keepItem) => {
        if (activeAccount.current !== currentAccount || await verifiedAccountId(client) !== currentAccount) throw new Error('Account changed')
        try {
          await createAccountSync(storage, client, {
            accountId: currentAccount, localListId: conflict.localListId, remoteListId: conflict.remoteListId,
            isActive: () => activeAccount.current === currentAccount,
          }).resolveItemDeletion(conflict, keepItem)
          onQueued()
        } finally {
          setWorkspaceRevision(value => value + 1)
        }
      } : undefined}
      cloudBoundLists={currentAccount ? cloudBindings : offlineLists?.accountId === offlineAccount ? offlineLists?.bindings : {}}
      onCreateCloudList={currentAccount && readyAccount === currentAccount ? async (name, kind, symbol) => !!await addCloudList(name, kind, symbol) : undefined}
      onChangeCloudList={currentAccount && readyAccount === currentAccount && cloudMetadata ? async (id, action, value) => {
        const row = cloudMetadata.find(list => list.id === (cloudBindings[id] ?? id))
        if (!row) return false
        if (action === 'reorder') {
          const target = cloudMetadata.find(list => list.id === (cloudBindings[value] ?? value))
          return target ? !!await changeCloudMetadata(row, { action, position: target.position }) : false
        }
        return !!await changeCloudMetadata(row, action === 'rename' ? { action, name: value.trim() } : { action, kind: value === 'oneoff' ? 'oneoff' : 'permanent' })
      } : undefined}
      cloudListBusy={cloudMutationBusy || cloudLoading}
      cloudListError={cloudMetadataError}
      cloudArchiveCount={cloudArchives?.length}
      onOpenCloudArchive={() => void loadCloudArchive()}
      cloudArchive={currentAccount ? (<section aria-label="Архив покупок">
        <h2>Завершённые списки</h2>
        <button type="button" aria-label="Показать завершённые покупки" aria-busy={cloudArchiveBusy}
          disabled={cloudArchiveBusy} onClick={() => void loadCloudArchive()}>
          {cloudArchiveBusy ? 'Загружаем…' : 'Показать завершённые покупки'}
        </button>
        {cloudArchiveError && <p role="alert">{cloudArchiveError}</p>}
        {cloudArchives && <div role="status">
          {cloudArchives.length === 0 ? <p>В облачном архиве пока нет покупок.</p> :
            cloudArchives.map(snapshot => <article className="archive-entry" key={snapshot.id}>
              <h3>{snapshot.sourceListName}</h3><p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {snapshot.items.length} товаров</p>
              <ul>{snapshot.items.map(item => <li key={item.ordinal}>
                {item.name}{item.quantity != null || item.unit ? ` — ${[item.quantity, item.unit].filter(value => value != null).join(' ')}` : ''}
              </li>)}</ul>
            </article>)}
        </div>}
      </section>) : undefined}
      accountCloudLists={currentAccount ? (cloudMetadata ?? []).map(row => ({ ...row, id: Object.keys(cloudBindings).find(localId => cloudBindings[localId] === row.id) ?? row.id })) : offlineLists?.accountId === offlineAccount ? (offlineLists?.lists ?? []) : []} listOperations={activeOperations} completionStatus={completionPreflight} onCompleteCloudList={currentAccount ? (listId, mode, confirmedMarked, confirmedItemIds) => { void completeCloudList(listId, mode, confirmedMarked, confirmedItemIds) } : undefined}
      accountMenu={client ? {
        open: accountDialogOpen,
        setOpen: open => { setAccountDialogOpen(open); setError(''); if (!open) setPassword('') },
        busy, name: verifiedEmail || undefined, syncState,
        content: <>
        {view.status === 'account' ? <>
          {(syncFailed || listSyncFailed) && <button type="button" onClick={retrySync}>Повторить синхронизацию</button>}
          <button type="button" disabled={busy} onClick={() => void signOut()}>Выйти</button></> :
          view.status === 'offline-account' ? <p role="status">Локальный профиль доступен без сети. Для проверки аккаунта и выхода подключитесь к интернету.</p> :
          <form onSubmit={signIn}>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
            <label htmlFor="auth-password">Пароль</label>
            <input id="auth-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
            <button disabled={busy || !controller}>Войти</button>
            <p>Без входа покупки сохраняются только на этом устройстве.</p>
          </form>}
        {error && <p role="alert">{error}</p>}
        </>,
      } : undefined} />
    {currentAccount && transferError && <p role="status">{transferError}</p>}
    {currentAccount && syncOnline && syncFailed && !dismissedSyncError && <section className="sync-error" aria-label="Ошибка синхронизации">
      <p role="alert">{syncError || cloudRefreshStatus || 'Не удалось синхронизировать данные.'}</p>
      <button type="button" onClick={retrySync}>Повторить</button>
      <button type="button" onClick={() => setDismissedSyncError(true)}>Продолжить без синхронизации</button>
    </section>}
    {showLabControls && client && view.status === 'account' && <section aria-label="Облачные списки">
      <details><summary>Служебные операции облака</summary>
      <button type="button" disabled={cloudLoading || !currentAccount} onClick={() => void loadCloudMetadata()}>
        Проверить типы и порядок облачных списков
      </button>
      {cloudMetadataError && <p role="alert">{cloudMetadataError}</p>}
      {cloudMetadata && <section aria-label="Проверенные метаданные облачных списков">
        <h3>Списки аккаунта</h3>
        <p>Изменения доступны только при установленном серверном контракте E4. При ошибке данные не перезаписываются; сначала проверьте состояние облака.</p>
        {cloudMetadata.length === 0 ? <p>Облачных списков пока нет.</p> :
          <ul>{cloudMetadata.map((row, index) => <li key={row.id}>
            {row.name} — {row.kind === 'oneoff' ? 'разовый' : 'постоянный'} · позиция {row.position} · версия {row.revision}
            <button type="button" disabled={cloudMutationBusy || cloudLoading} onClick={() => {
              const name = window.prompt('Новое название списка', row.name)
              if (name !== null && name.trim() && name.trim() !== row.name)
                void changeCloudMetadata(row, { action: 'rename', name: name.trim() })
            }}>Переименовать облачный список</button>
            <button type="button" disabled={cloudMutationBusy || cloudLoading}
              onClick={() => void changeCloudMetadata(row, { action: 'kind', kind: row.kind === 'oneoff' ? 'permanent' : 'oneoff' })}>
              Сделать {row.kind === 'oneoff' ? 'постоянным' : 'разовым'}
            </button>
            <button type="button" disabled={cloudMutationBusy || cloudLoading || index === 0}
              onClick={() => void changeCloudMetadata(row, { action: 'reorder', position: cloudMetadata[index - 1].position })}>Выше</button>
            <button type="button" disabled={cloudMutationBusy || cloudLoading || index === cloudMetadata.length - 1}
              onClick={() => void changeCloudMetadata(row, { action: 'reorder', position: cloudMetadata[index + 1].position })}>Ниже</button>
          </li>)}</ul>}
      </section>}
      </details>
      <section aria-label="Облачный архив">
        <h3>Облачный архив покупок</h3>
        <button type="button" disabled={cloudLoading || !currentAccount} onClick={() => void previewCloudCompletion()}>
          Проверить готовность облачного списка к завершению
        </button>
        {completionPreflight && <p role="status">{completionPreflight}</p>}
        <button type="button" disabled={completionBusy} onClick={() => void recoverCloudCompletions()}>
          {completionBusy ? 'Проверяем завершение…' : 'Восстановить незавершённое завершение'}
        </button>
        <button type="button" aria-label="Показать завершённые покупки" aria-busy={cloudArchiveBusy}
          disabled={cloudArchiveBusy} onClick={() => void loadCloudArchive()}>
          {cloudArchiveBusy ? 'Загружаем…' : 'Показать завершённые покупки'}
        </button>
        {cloudArchiveError && <p role="alert">{cloudArchiveError}</p>}
        {cloudArchives && <div role="status">
          {cloudArchives.length === 0 ? <p>В облачном архиве пока нет покупок.</p> :
            <ul>{cloudArchives.map(snapshot => <li key={snapshot.id}>
              <strong>{snapshot.sourceListName}</strong> — {new Date(snapshot.completedAt).toLocaleDateString('ru-RU')}
              <ul>{snapshot.items.map(item => <li key={item.ordinal}>
                {item.name}{item.quantity != null || item.unit ? ` — ${[item.quantity, item.unit].filter(value => value != null).join(' ')}` : ''}
              </li>)}</ul>
            </li>)}</ul>}
        </div>}
      </section>
      <details><summary>Привязка и синхронизация</summary>
      <p>Привязка не переносит существующие покупки. Новые изменения в привязанном списке отправляются автоматически при доступной сети.</p>
      <button type="button" disabled={cloudLoading} onClick={() => void loadCloudLists()}>
        {cloudLoading ? 'Проверяем…' : 'Загрузить мои облачные списки'}
      </button>
      {cloudLists.length > 0 && <form onSubmit={event => void bindCloudList(event)}>
        <label htmlFor="local-cloud-list">Локальный список</label>
        <select id="local-cloud-list" value={selectedLocal} disabled={cloudLoading}
          onChange={event => { setSelectedLocal(event.target.value as ListId); setSelectedRemote(''); setCloudPreview(null); setDeletionReview(null) }}>
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <label htmlFor="remote-cloud-list">Облачный список</label>
        <select id="remote-cloud-list" value={selectedRemote} disabled={cloudLoading || !!cloudBindings[selectedLocal]}
          onChange={event => setSelectedRemote(event.target.value)}>
          <option value="">Выберите список</option>
          {cloudLists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <button disabled={cloudLoading || !selectedRemote || !!cloudBindings[selectedLocal]}>Привязать</button>
      </form>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void compareCloudList()}>Сравнить с облаком</button>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void compareCloudDeletions()}>Проверить удаления в облаке</button>}
      {cloudPreview && <p role="status">{cloudPreview}</p>}
      {deletionReview && deletionReview.accountId === currentAccount && deletionReview.localListId === selectedLocal && deletionReview.remoteListId === cloudBindings[selectedLocal] && deletionReview.items.length > 0 && <div>
        <p>Найдены удалённые в облаке товары. Проверьте названия перед применением:</p>
        <ul>{deletionReview.items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
        <button type="button" disabled={cloudLoading} onClick={() => void confirmCloudDeletions()}>Подтвердить удаление с устройства</button>
        <button type="button" disabled={cloudLoading} onClick={() => setDeletionReview(null)}>Отмена</button>
      </div>}
      {cloudPreview?.startsWith('Только просмотр:') && <button type="button" disabled={cloudLoading}
        onClick={() => void importCloudItems()}>Импортировать только новые покупки</button>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void flushCloudQueue()}>Отправить подготовленные изменения</button>}
      {cloudBindings[selectedLocal] && <SiriSetup key={currentAccount + ':' + cloudBindings[selectedLocal]} cloudUrl={import.meta.env.VITE_SUPABASE_URL} client={client} accountId={currentAccount!} listId={cloudBindings[selectedLocal]} listName={cloudMetadata?.find(list => list.id === selectedLocal)?.name ?? lists.find(list => list.id === selectedLocal)?.name ?? 'Список покупок'} />}
      {lists.map(list => cloudBindings[list.id] &&
        <p key={list.id}>{list.name}: облачный список привязан (новые изменения отправляются автоматически).</p>)}
      </details>
    </section>}
  </>
}
