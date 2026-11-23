import { pullAccountFeed } from './data/account-feed'
import { flushAccountBatch } from './data/account-batch'
import { syncAccountDrafts } from './data/sync-account-drafts'
import { applyCloudListMerge, previewCloudListMerge } from './data/cloud-list-merge'
import { ListMergeConflict, sameMergeSnapshot, type ListMergeActions } from './domain/list-merge'
import { fetchRemoteItems } from './data/remote-snapshot'
import { PurchaseHistory } from './PurchaseHistory'
import type { ListActionMessage } from './ListActionNotice'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isAuthApiError, isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceDialog } from './WorkspaceDialog'
import { AccountEmailDialog, type AccountEmailMode } from './AccountEmailDialog'
import { createAccountEmailClient } from './data/cloud-client'
import { LocalProfileLimitError, profileName, type LocalProfile } from './data/local-profiles'
import { App } from './App'
import { syncGuestImports } from './data/guest-import'
import { SiriSetup } from './SiriSetup'
import { lists, type Item, type ListId } from './domain/shopping'
import { fetchOwnedCloudLists, type OwnedCloudList } from './data/owned-cloud-lists'
import { fetchCloudListMetadata, type CloudListMetadata } from './data/e4-cloud-list-metadata'
import { watchCloudListChanges } from './data/cloud-list-watch'
import { sendCloudListChange, type CloudListChange } from './data/e4-cloud-list-operations'
import { createCloudList } from './data/e4-cloud-list-create'
import { fetchCloudArchive, type CloudArchiveCompletion } from './data/cloud-archive'
import { inspectCloudCompletion } from './data/cloud-completion-preflight'
import { createCloudCompletionCoordinator } from './data/cloud-completion-coordinator'
import type { CompletionMode } from './data/cloud-completion-rpc'
import { bindVerifiedOwnedList } from './data/verified-list-binding'
import { createAccountSync } from './data/account-sync'
import type { CloudCompletionRequest, Storage } from './data/storage'
import { ProfileTransferPreference, type ProfileSyncState } from './ProfileMenu'
import type { ListOperationStatus } from './App'
import { createAuthController } from './data/auth-controller'
import { createSignOutGuard } from './data/signout-guard'
import { checkVerifiedAccountId, verifiedAccountId, verifySessionIdentity } from './data/verified-account'
import type { AuthView } from './data/auth-view'
import type { SessionCandidate } from './data/auth-scope'

type Controller = ReturnType<typeof createAuthController>

const localWorkspaceKey = 'shopping-show-local-workspace'
const accountEmailEnabled = import.meta.env.VITE_ACCOUNT_EMAIL_CODES === 'true'
const showLabControls = import.meta.env.VITE_LAB_CONTROLS === 'true'

export function AuthenticatedApp({ storage, client }: { storage: Storage; client: SupabaseClient | null }) {
  const [view, setView] = useState<AuthView>(client ? { status: 'checking' } : { status: 'guest' })
  const [controller, setController] = useState<Controller | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [localBrowsing, setLocalBrowsing] = useState(() => {
    try { return sessionStorage.getItem(localWorkspaceKey) === 'yes' } catch { return false }
  })
  const localReturnProfile = useRef<string | undefined>(undefined)
  const offerTransfer = useRef(false)
  function selectLocalBrowsing(value: boolean) {
    setLocalBrowsing(value)
    try { sessionStorage.setItem(localWorkspaceKey, value ? 'yes' : 'no') } catch { /* storage unavailable */ }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  const [accountEmailMode, setAccountEmailMode] = useState<AccountEmailMode | null>(null)
  const [accountEmailNotice, setAccountEmailNotice] = useState('')
  const [cloudLists, setCloudLists] = useState<OwnedCloudList[]>([])
  const [cloudMetadata, setCloudMetadata] = useState<CloudListMetadata[] | null>(null)
  const [cloudMetadataError, setCloudMetadataError] = useState('')
  const [cloudMutationBusy, setCloudMutationBusy] = useState(false)
  const [loadedArchive, setLoadedArchive] = useState<{ accountId: string; snapshots: CloudArchiveCompletion[] } | null>(null)
  const [cloudArchiveError, setCloudArchiveError] = useState('')
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false)
  const loadingArchiveFor = useRef<string | null>(null)
  const archiveRefreshRequested = useRef<string | null>(null)
  const [completionNotice, setCompletionNotice] = useState<(ListActionMessage & { accountId: string })>()
  const [completionError, setCompletionError] = useState('')
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
  const requestCloudRefresh = useRef<(() => void) | undefined>(undefined)
  const lastCloudCheck = useRef<{ accountId: string; at: number } | undefined>(undefined)
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
  const signedInAccount = view.status === 'account' ? view.accountId : null
  const sessionAccount = signedInAccount ?? (view.status === 'offline-account' ? view.accountId : null)
  const currentAccount = localBrowsing ? null : signedInAccount
  const offlineAccount = !localBrowsing && view.status === 'offline-account' ? view.accountId : null
  const workspaceAccount = currentAccount ?? offlineAccount
  const cloudArchives = loadedArchive?.accountId === workspaceAccount ? loadedArchive.snapshots : null
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
    if (currentAccount) { setAccountDialogOpen(false); setPassword('') }
  }, [currentAccount])
  const [offlineLists, setOfflineLists] = useState<{
    accountId: string; bindings: Record<string, string>;
    lists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[]
  } | null>(null)
  const [readyAccount, setReadyAccount] = useState<string | null>(null)
  const [profileError, setProfileError] = useState('')
  const [profileAttempt, setProfileAttempt] = useState(0)
  const [transferError, setTransferError] = useState('')
  const [transferPrompt, setTransferPrompt] = useState<{ phase: 'consent' | 'collision'; name: string; existing: boolean; collisions: string[] } | null>(null)
  const [rememberDecline, setRememberDecline] = useState(false)
  type TransferAnswer = 'skip' | 'skip-saved' | 'separate' | 'merge' | 'yes'
  const declineTransferButton = useRef<HTMLButtonElement>(null)
  const transferAnswer = useRef<((answer: TransferAnswer) => void) | null>(null)
  function answerTransfer(answer: TransferAnswer) {
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
    const verifyAccount = async () => {
      if (await checkVerifiedAccountId(client) !== currentAccount) throw new Error('Account verification changed')
    }
    void (async () => {
      await verifyAccount()
      if (cancelled) return
      if (!await storage.readGuestCutoverOwner()) {
        await storage.migrateLegacyGuestToProfile()
        await storage.markGuestCutoverReady()
      }
      if (cancelled) return
      const identity = await client.auth.getUser()
      if (cancelled) return
      if (identity.error || identity.data.user?.id.toLowerCase() !== currentAccount) throw new Error('Account verification changed')
      setVerifiedEmail(identity.data.user.email ?? '')
      const registry = await storage.readLocalProfiles()
      const source = registry?.profiles.find(p => p.id === registry.activeProfileId && !p.cloudAccountId)
      const pending = await storage.readGuestImports(currentAccount)
      let collisionMode: 'separate' | 'merge' | undefined
      if (source && offerTransfer.current && !source.skipTransferPrompt && !pending.some(batch => !batch.archiveOnly)) {
        const prompt = { name: profileName(source, registry!.profiles.indexOf(source)),
          existing: registry!.profiles.some(p => p.cloudAccountId === currentAccount), collisions: [] as string[] }
        const ask = (phase: 'consent' | 'collision', collisions: string[] = []) => new Promise<TransferAnswer>(resolve => {
          if (cancelled) { resolve('skip'); return }
          transferAnswer.current = resolve
          setRememberDecline(false)
          setTransferPrompt({ ...prompt, phase, collisions })
        })
        const answer = await ask('consent')
        if (cancelled) return
        if (answer === 'skip-saved') await storage.setProfileTransferPromptSkipped(source.id, true)
        if (answer === 'yes') {
          const [local, remote] = await Promise.all([storage.readProfileLists(source.id), fetchCloudListMetadata(client, currentAccount)])
          if (cancelled) return
          const collisions = local.filter(list => remote.some(row => row.name.trim().toLowerCase() === list.name.trim().toLowerCase())).map(list => list.name)
          const choice = collisions.length ? await ask('collision', collisions) : 'separate'
          if (cancelled) return
          if (choice === 'separate' || choice === 'merge') collisionMode = choice
        }
      }
      if (cancelled) return
      await verifyAccount()
      if (cancelled) return
      await storage.ensureVerifiedAccountProfile(currentAccount, { login: identity.data.user.email,
        ...(source && collisionMode ? { sourceProfileId: source.id, collisionMode } : {}) })
      try {
        await syncGuestImports(storage, client, currentAccount,
          async () => !cancelled && await verifiedAccountId(client) === currentAccount, 'profile')
      } catch (error) {
        if (!cancelled) setTransferError((error as { code?: string })?.code === '23505'
          ? 'Перенос остановлен: в аккаунте уже есть список с таким названием. Локальные данные сохранены.'
          : 'Перенос локального профиля не завершён. Данные сохранены. Повторите вход после восстановления связи.')
      }
      const restore = await storage.needsAccountCacheRestore(currentAccount)
      const feed = await pullAccountFeed(client, storage, currentAccount, () => !cancelled)
      if (cancelled) return
      const rows = feed ? await storage.readAccountFeedLists(currentAccount)
        : await fetchCloudListMetadata(client, currentAccount)
      if (!feed) {
        const mappings = await storage.readAccountListMappings(currentAccount)
        const byRemote = new Map(mappings.map(row => [row.remoteListId, row]))
        const hydrate = restore ? rows : rows.filter(row => !byRemote.get(row.id)?.metadata)
        for (let offset = 0; offset < hydrate.length; offset += 8) {
          if (cancelled) return
          await verifyAccount()
          await Promise.all(hydrate.slice(offset, offset + 8).map(async row => {
            const localListId = byRemote.get(row.id)?.localListId ?? row.id
            await storage.bindAccountList(currentAccount, localListId, row.id)
            await createAccountSync(storage, client, {
              accountId: currentAccount, localListId, remoteListId: row.id,
              isActive: () => !cancelled,
            }).importRemoteOnly()
          }))
        }
        if (cancelled) return
        await verifyAccount()
        await storage.cacheAccountListMetadata(currentAccount, rows)
      }
      if (cancelled) return
      if (restore) await storage.confirmAccountCacheRestore(currentAccount)
      const confirmedMappings = await storage.readAccountListMappings(currentAccount)
      if (!cancelled) {
        setCloudMetadata(rows)
        setCloudLists(rows.map(row => ({ id: row.id, name: row.name })))
        setCloudBindings(Object.fromEntries(confirmedMappings.map(row => [row.localListId, row.remoteListId])))
      }
      if (!cancelled) await verifyAccount()
      if (!cancelled) {
        offerTransfer.current = false
        setReadyAccount(currentAccount)
      localReturnProfile.current = undefined
      }
    })().catch((cause: unknown) => {
      if (!cancelled) setProfileError(cause instanceof LocalProfileLimitError ? cause.message : 'Не удалось безопасно открыть локальный профиль аккаунта. Покупки сохранены; повторите открытие.')
    })
    return () => { cancelled = true; transferAnswer.current?.('skip'); transferAnswer.current = null; setTransferPrompt(null) }
  }, [client, currentAccount, offlineAccount, workspaceAccount, storage, profileAttempt])
  const activeAccount = useRef<string | null>(null)
  // A verified session is not enough: the account workspace must have a
  // durable local profile before any background sync or refresh may run.
  activeAccount.current = readyAccount === currentAccount ? currentAccount : null
  const automaticFlushRunning = useRef(new Set<string>())
  const flushRequested = useRef(new Set<string>())
  const onQueued = useCallback(() => {
    setSyncQueueRevision(revision => revision + 1)
    if (!client || !currentAccount || readyAccount !== currentAccount || !navigator.onLine) return
    const accountId = currentAccount
    if (automaticFlushRunning.current.has(accountId)) {
      flushRequested.current.add(accountId)
      return
    }
    automaticFlushRunning.current.add(accountId)
    setPushState({ account: accountId, status: 'syncing' })
    setDismissedSyncError(false)
    void (async () => {
      try {
        if (activeAccount.current !== accountId) return
        if ((await storage.readGuestImports(accountId)).some(batch => batch.archiveOnly)) {
          await syncGuestImports(storage, client, accountId, async () => {
            if (activeAccount.current !== accountId) return false
            if (await verifiedAccountId(client) !== accountId) throw new Error('Account could not be verified')
            return activeAccount.current === accountId
          }, 'archive')
          const snapshots = await storage.readAccountArchive(accountId)
          if (activeAccount.current !== accountId) return
          if (snapshots) setLoadedArchive({ accountId, snapshots })
          setSyncQueueRevision(revision => revision + 1)
          setSyncError('')
        }
        if (!(await storage.readAccountPending(accountId)).length) {
          if (activeAccount.current === accountId) setPushState({ account: accountId, status: 'done' })
          return
        }
        if (await verifiedAccountId(client) !== accountId) throw new Error('Account could not be verified')
        do {
          flushRequested.current.delete(accountId)
          if (await storage.readAccountFeedPosition(accountId) !== undefined) {
            await flushAccountBatch(storage, client, accountId, () => activeAccount.current === accountId,
              () => setWorkspaceRevision(value => value + 1))
            continue
          }
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
        } while (flushRequested.current.has(accountId) && activeAccount.current === accountId)
        if (activeAccount.current === accountId) {
          setCloudMappingRevision(value => value + 1)
          setSyncError('')
          setPushState({ account: accountId, status: 'done' })
        }
      } catch {
        if (activeAccount.current === accountId) {
          setSyncError('Не удалось отправить изменения. Повторите синхронизацию.')
          setPushState({ account: accountId, status: 'error' })
        }
      } finally {
        automaticFlushRunning.current.delete(accountId)
        const requested = flushRequested.current.delete(accountId)
        if (requested && activeAccount.current === accountId) onQueued()
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
    if (guard.isPending()) setSignOutError('Предыдущий выход не завершён. Повторите выход из аккаунта.')
    const next = createAuthController({
      getSession: async () => {
        const result = await client.auth.getSession()
        return { data: { session: result.data.session as SessionCandidate | null }, error: result.error }
      },
      onAuthStateChange: callback => client.auth.onAuthStateChange((event, session) => callback(event, session as SessionCandidate | null)),
      signInWithPassword: credentials => client.auth.signInWithPassword(credentials),
      signOut: scope => scope ? client.auth.signOut({ scope }) : client.auth.signOut(),
    }, nextView => {
      setView(nextView)
      if (nextView.status === 'guest') setSignOutError('')
    }, guard, session => verifySessionIdentity(client, session), async session => {
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

  useEffect(() => {
    if (!controller) return
    const recheck = () => { if (navigator.onLine) void controller.initialize() }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const last = lastCloudCheck.current
      if (last && last.accountId === signedInAccount && performance.now() - last.at < 30_000) return
      recheck()
    }
    window.addEventListener('online', recheck)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', recheck)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [controller, signedInAccount])

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
    void storage.readAccountFeedPosition(currentAccount).then(position => {
      if (position === undefined && activeAccount.current === currentAccount)
        return storage.cacheAccountListMetadata(currentAccount, cloudMetadata)
    }).catch(() => {
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
    let queued: 'all' | 'changed' | undefined
    const pulledRevisions = new Map<string, number>()
    const resumeIntervalMs = 30_000
    let lastSuccess: number | undefined
    let pullFailed = false
    let refreshOnReturn = false
    async function refresh(mode: 'all' | 'changed' = 'all') {
      if (!client || disposed || !navigator.onLine) return
      if (document.visibilityState === 'hidden') {
        refreshOnReturn = true
        return
      }
      refreshOnReturn = false
      if (running) {
        if (mode === 'all' || !queued) queued = mode
        return
      }
      running = true
      queued = undefined
      let imported = 0
      let failed = false
      let pulling = false
      const started = performance.now()
      let stage = 'session'
      let requests = 0
      const reportFailure = (cause: unknown) => {
        const code = (cause as { code?: unknown } | null)?.code
        console.warn('Cloud list refresh failed', {
          stage, requests, elapsedMs: Math.round(performance.now() - started),
          code: typeof code === 'string' && /^[A-Z0-9]{5,10}$/.test(code) ? code : undefined,
        })
      }
      try {
        if (activeAccount.current !== accountId) return
        const stillActive = () => !disposed && activeAccount.current === accountId
        stage = 'account-feed'
        if (await storage.readAccountFeedPosition(accountId) !== undefined) {
          await pullAccountFeed(client, storage, accountId, stillActive, () => requests++)
          if (!stillActive()) return
          const [rows, mappings] = await Promise.all([
            storage.readAccountFeedLists(accountId), storage.readAccountListMappings(accountId),
          ])
          if (!stillActive()) return
          setCloudMetadata(rows)
          setCloudLists(rows.map(({ id, name }) => ({ id, name })))
          setCloudBindings(Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId])))
          setWorkspaceRevision(value => value + 1)
          pulling = true
          return
        }
        stage = 'session'
        if (await verifiedAccountId(client) !== accountId) throw new Error('Account could not be verified')
        stage = 'local-index'
        const [mappings, completions, merges] = await Promise.all([
          storage.readAccountListMappings(accountId), storage.readAccountCompletions(accountId), storage.readQueuedListMerges(accountId),
        ])
        stage = 'list-index'
        const owned = await fetchCloudListMetadata(client, accountId)
        const mappingsByRemoteId = new Map(mappings.map(mapping => [mapping.remoteListId, mapping]))
        const completing = new Set([...completions.map(row => row.remoteListId), ...merges.flatMap(row => [row.source.remoteListId, row.target.remoteListId])])
        const activeIds = new Set(owned.map(row => row.id))
        const retired = new Set(mappings.filter(row => row.metadata && !activeIds.has(row.remoteListId) &&
          !completing.has(row.remoteListId)).map(row => row.remoteListId))
        if (retired.size && stillActive()) {
          setCloudMetadata(rows => rows?.filter(row => !retired.has(row.id)) ?? null)
          setCloudLists(rows => rows.filter(row => !retired.has(row.id)))
        }
        const toPull = owned.filter(row => !completing.has(row.id) &&
          (mode === 'all' || pulledRevisions.get(row.id) !== row.revision))
        if (!stillActive() || !toPull.length) return
        stage = 'list-items'
        pulling = true
        setPullState({ account: accountId, status: 'syncing' })
        setDismissedSyncError(false)
        for (const row of toPull) {
          if (!stillActive()) return
          const mapping = mappingsByRemoteId.get(row.id)
          const localListId = mapping?.localListId ?? row.id
          try {
            if (!mapping) await storage.bindAccountList(accountId, localListId, row.id)
            imported += await createAccountSync(storage, client, {
              accountId,
              localListId,
              remoteListId: row.id,
              isActive: stillActive,
            }).importRemoteOnly({ reconcileNames: true })
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
            pulledRevisions.set(row.id, row.revision)
          } catch (cause) {
            // Keep processing other bound lists, but never import conflicting
            // items from this list or hide the error from the account owner.
            if (disposed || activeAccount.current !== accountId) return
            pulledRevisions.delete(row.id)
            reportFailure(cause)
            failed = true
          }
        }
      } catch (cause) {
        if (!disposed && activeAccount.current === accountId) reportFailure(cause)
        failed = true
      } finally {
        if (!disposed && activeAccount.current === accountId) {
          if (failed) lastCloudCheck.current = undefined
          else {
            lastSuccess = performance.now()
            lastCloudCheck.current = { accountId, at: lastSuccess }
          }
        }
        if (!disposed && activeAccount.current === accountId && (pulling || failed || pullFailed || mode === 'all')) {
          pullFailed = failed
          setPullState({ account: accountId, status: failed ? 'error' : 'done' })
          if (imported > 0) setWorkspaceRevision(value => value + 1)
          if (failed) setCloudRefreshStatus(imported > 0
            ? 'Обновлено покупок: ' + imported + '. Некоторые списки не удалось обновить.'
            : 'Не удалось обновить некоторые списки. Повторите синхронизацию.')
          else setCloudRefreshStatus(imported > 0 ? 'Обновлено покупок из облака: ' + imported : '')
        }
        running = false
        if (queued) void refresh(queued)
      }
    }
    const onVisible = () => {
      if (!running && document.visibilityState === 'visible' &&
          (refreshOnReturn || pullFailed || lastSuccess === undefined || performance.now() - lastSuccess >= resumeIntervalMs)) void refresh('changed')
    }
    const onOnline = () => void refresh('changed')
    requestCloudRefresh.current = onOnline
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    const stopWatching = watchCloudListChanges(client, accountId, () => void refresh('changed'))
    void refresh()
    return () => {
      disposed = true
      requestCloudRefresh.current = undefined
      stopWatching()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [client, currentAccount, readyAccount, storage])

  useEffect(() => {
    if (cloudMappingRevision > 0) requestCloudRefresh.current?.()
  }, [cloudMappingRevision])

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

  function cloudListMergeActions(account: string, connection: SupabaseClient): ListMergeActions {
    const stillActive = () => activeAccount.current === account
    async function bindings(sourceId: string, targetId: string) {
      if (!navigator.onLine) throw new Error('Подключитесь к интернету для объединения облачных списков.')
      if (!stillActive()) throw new Error('Текущий аккаунт изменился.')
      const verifiedId = await checkVerifiedAccountId(connection).catch(async () => {
        if (!stillActive()) return null
        return checkVerifiedAccountId(connection).catch(() => {
          throw new Error('Не удалось проверить подключение к аккаунту. Повторите попытку.')
        })
      })
      if (verifiedId !== account || !stillActive()) throw new Error('Войдите в аккаунт, чтобы продолжить.')
      const [mappings, pending, requests, intents, conflicts] = await Promise.all([
        storage.readAccountListMappings(account), storage.readAccountPending(account),
        storage.readAccountCompletionRequests(account), storage.readAccountCompletions(account),
        storage.readItemDeletionConflicts(account),
      ])
      const relevant = (row: { localListId: string }) => row.localListId === sourceId || row.localListId === targetId
      if ([...pending, ...requests, ...intents, ...conflicts].some(row => 'localListId' in row && relevant(row)))
        throw new Error('Дождитесь синхронизации обоих списков и разрешите возможные конфликты.')
      const source = mappings.find(row => row.localListId === sourceId)
      const target = mappings.find(row => row.localListId === targetId)
      if (!source || !target || !stillActive()) throw new Error('Один из списков недоступен.')
      return [source, target] as const
    }
    return {
      read: async (sourceId, targetId) => {
        const [source, target] = await bindings(sourceId, targetId)
        return previewCloudListMerge(connection, source, target)
      },
      apply: async (snapshot, choices, operationId) => {
        const [source, target] = await bindings(snapshot.source.id, snapshot.target.id)
        await applyCloudListMerge(connection, snapshot, source, target, choices, operationId)
        if (!stillActive()) return
        // The RPC receipt comes before the cache refresh. A failed refresh must
        // never turn an acknowledged mutation into an unconfirmed mutation.
        setCloudMetadata(rows => rows?.filter(row => row.id !== source.remoteListId) ?? null)
        setCloudLists(rows => rows.filter(row => row.id !== source.remoteListId))
        try {
          if (await storage.readAccountFeedPosition(account) !== undefined) {
            if (stillActive()) requestCloudRefresh.current?.()
            return
          }
          await createAccountSync(storage, connection, { accountId: account, localListId: target.localListId,
            remoteListId: target.remoteListId, isActive: stillActive }).importRemoteOnly({ reconcileNames: true })
          if (stillActive()) setWorkspaceRevision(value => value + 1)
        } catch {
          if (stillActive()) setPullState({ account, status: 'error' })
        }
      },
    }
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
      await storage.cacheAccountListMetadata(accountId, refreshed, { partial: true })
      if (activeAccount.current !== accountId) return
      setCloudBindings(previous => ({ ...previous, [created.id]: created.id }))
      setCloudMappingRevision(value => value + 1)
      setCloudMetadata(refreshed)
      setCloudLists(refreshed.map(row => ({ id: row.id, name: row.name })))
      return created.id
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
      await storage.cacheAccountListMetadata(accountId, refreshed, { partial: true })
      if (activeAccount.current !== accountId) return
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

  function enterLocalWorkspace() {
    offerTransfer.current = false
    setPassword('')
    setError('')
    selectLocalBrowsing(true)
    setAccountDialogOpen(false)
  }
  function openLinkedWorkspace(profile: LocalProfile, previousProfileId?: string) {
    if (!profile.cloudAccountId) return
    enterLocalWorkspace()
    if (profile.cloudAccountId === sessionAccount) {
      localReturnProfile.current = previousProfileId
      selectLocalBrowsing(false)
    } else {
      setEmail(profile.login ?? '')
      setAccountDialogOpen(true)
    }
  }
  async function returnToLocalProfiles() {
    if (busy) return
    setBusy(true)
    try {
      const previous = localReturnProfile.current
      if (previous) await storage.switchLocalProfile(previous)
      localReturnProfile.current = undefined
      enterLocalWorkspace()
    } catch {
      setProfileError('Не удалось вернуться к локальному профилю. Повторите попытку.')
    } finally {
      setBusy(false)
    }
  }
  function openAccountEmail(mode: AccountEmailMode, address = email) {
    setEmail(address)
    setError('')
    setPassword('')
    setAccountEmailNotice('')
    setAccountDialogOpen(false)
    setAccountEmailMode(mode)
  }
  async function signIn(event: FormEvent, profile?: LocalProfile) {
    event.preventDefault()
    if (!controller || !client || busy) return
    const target = profile?.cloudAccountId
    const address = (target ? profile.login ?? '' : email).trim()
    if (!address) { setError('Не удалось определить email этого профиля.'); return }
    localReturnProfile.current = profile?.id
    setBusy(true)
    setError('')
    setAccountEmailNotice('')
    let submittingCredentials = false
    try {
      offerTransfer.current = !target
      submittingCredentials = true
      if (sessionAccount || target) {
        if (!navigator.onLine) throw new Error('Подключитесь к интернету для смены аккаунта.')
        const isolated = createAccountEmailClient()
        if (!isolated) throw new Error('Подключение к аккаунту недоступно.')
        // Validate credentials before replacing the currently authorized session.
        const { data, error: credentialsError } = await isolated.auth.signInWithPassword({ email: address, password })
        if (credentialsError) throw credentialsError
        submittingCredentials = false
        if (!data.session || !data.user || (target && data.user.id.toLowerCase() !== target))
          throw new Error('Вход выполнен в другой аккаунт. Проверьте адрес выбранного профиля.')
        selectLocalBrowsing(true)
        if (sessionAccount && sessionAccount !== data.user.id.toLowerCase()) {
          setSignOutError('')
          try {
            await controller.signOut('local')
          } catch (cause) {
            setSignOutError('Не удалось завершить прежнюю сессию. Повторите выход после восстановления связи.')
            throw cause
          }
        }
        const result = await client.auth.setSession({
          access_token: data.session.access_token, refresh_token: data.session.refresh_token,
        })
        if (result.error) throw result.error
        if (result.data.user?.id !== data.user.id) throw new Error('Не удалось подтвердить сессию. Повторите вход.')
      } else {
        await controller.signIn(address, password)
        submittingCredentials = false
      }
      setPassword('')
      selectLocalBrowsing(false)
    } catch (cause) {
      offerTransfer.current = false
      if (isAuthApiError(cause) && cause.code === 'invalid_credentials') {
        setError('Неверный email или пароль.')
      } else if (!navigator.onLine || isAuthRetryableFetchError(cause)) {
        setError('Не удалось подключиться. Проверьте интернет и повторите вход.')
      } else {
        setError(submittingCredentials ? 'Не удалось войти. Повторите попытку.'
          : cause instanceof Error ? cause.message : 'Не удалось войти.')
      }
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

  async function syncLocalListChanges(accountId: string, client: SupabaseClient, stillActive: () => boolean) {
    const queue = await storage.readLocalListChanges(accountId)
    if (!queue.length) return true
    if (await verifiedAccountId(client) !== accountId || !stillActive()) return false
    let metadata = await fetchCloudListMetadata(client, accountId)
    for (const operation of queue) {
      if (!stillActive() || !navigator.onLine) return false
      const current = metadata.find(row => row.id === operation.remoteListId)
      const { change, before, prepared, targetId } = operation
      const unchanged = current && (change.action === 'rename' ? current.name === before.name
        : change.action === 'kind' ? current.kind === before.kind
          : current.position === before.position && metadata.some(row => row.id === targetId && row.position === change.position))
      let conflict = !prepared && !unchanged
      if (!conflict) {
        const base = prepared ?? await storage.prepareLocalListChange(accountId, operation, current!)
        if (!stillActive()) return false
        try {
          await sendCloudListChange(client, base, operation.operationId, change)
        } catch (error) {
          const failure = error as { code?: string; message?: string }
          conflict = failure.code === '23505' || (failure.code === 'P0001' &&
            ['List revision conflict', 'List unavailable'].includes(failure.message ?? ''))
          if (!conflict) throw error
        }
      }
      if (!stillActive()) return false
      metadata = await fetchCloudListMetadata(client, accountId)
      if (!stillActive()) return false
      await storage.cacheAccountListMetadata(accountId, metadata)
      await storage.finishLocalListChange(accountId, operation)
      if (!conflict) await storage.markAccountListsChanged(accountId)
      if (!stillActive()) return false
      setCloudMetadata(metadata)
      setCloudLists(metadata.map(row => ({ id: row.id, name: row.name })))
      setWorkspaceRevision(value => value + 1)
      if (conflict) setCompletionError('Список изменился на другом устройстве или название занято. Проверьте список и повторите изменение.')
    }
    return true
  }

  async function syncQueuedListMerges(accountId: string, connection: SupabaseClient, stillActive: () => boolean) {
    for (const merge of await storage.readQueuedListMerges(accountId)) {
      if (!stillActive() || await verifiedAccountId(connection) !== accountId || !stillActive()) return false
      const { source, target, expected, operationId } = merge
      let prepared = merge
      try {
        if (!prepared.revisions) {
          for (const binding of [source, target]) {
            await createAccountSync(storage, connection, { accountId, ...binding, isActive: stillActive }).flush()
          }
          const pending = await storage.readAccountPending(accountId)
          if (pending.some(row => !('remoteListId' in row) ||
              row.remoteListId === source.remoteListId || row.remoteListId === target.remoteListId))
            throw new ListMergeConflict()
          const preview = await previewCloudListMerge(connection, source, target)
          if (!sameMergeSnapshot(expected, preview)) throw new ListMergeConflict()
          if (!stillActive()) return false
          const saved = await storage.prepareQueuedListMerge(accountId, merge, {
            sourceRevision: preview.sourceRevision, targetRevision: preview.targetRevision,
          })
          if (!saved) continue
          prepared = saved
        }
        if (!stillActive()) return false
        await applyCloudListMerge(connection, { ...expected, ...prepared.revisions }, source, target, new Map(merge.choices), operationId)
      } catch (error) {
        if (!(error instanceof ListMergeConflict)) throw error
        if (!stillActive()) return false
        await storage.finishQueuedListMerge(accountId, prepared)
        setCompletionError('Не удалось объединить «' + expected.source.name + '» и «' + expected.target.name +
          '»: списки изменились. Проверьте их и подтвердите объединение заново.')
        setWorkspaceRevision(value => value + 1)
        setCloudMappingRevision(value => value + 1)
        continue
      }
      const before = await fetchCloudListMetadata(connection, accountId)
      const entries: { item: Item; version: number }[] = []
      for (let offset = 0; ; offset += 500) {
        const page = await fetchRemoteItems(connection, target.remoteListId, false, { from: offset, to: offset + 499 })
        entries.push(...page.map(({ id, name, quantity, unit, purchased, createdAt, version }) => ({
          item: { id, name, quantity, unit, purchased, listId: target.localListId, createdAt: Date.parse(createdAt) }, version,
        })))
        if (page.length < 500) break
      }
      const metadata = await fetchCloudListMetadata(connection, accountId)
      const revision = metadata.find(row => row.id === target.remoteListId)?.revision
      if (revision === undefined || revision !== before.find(row => row.id === target.remoteListId)?.revision)
        throw new Error('Список-получатель изменился во время обновления. Повторите синхронизацию.')
      if (!stillActive()) return false
      await storage.finishQueuedListMerge(accountId, prepared, entries)
      if (!stillActive()) return false
      setCloudMetadata(metadata)
      setCloudLists(metadata.map(row => ({ id: row.id, name: row.name })))
      setCloudBindings(rows => Object.fromEntries(Object.entries(rows).filter(([, id]) => id !== source.remoteListId)))
      setWorkspaceRevision(value => value + 1)
      setCloudMappingRevision(value => value + 1)
    }
    return true
  }

  async function processListOperations(accountId: string) {
    if (!client || activeAccount.current !== accountId || !navigator.onLine) return
    completionRequested.current.add(accountId)
    if (completionWorkers.current.has(accountId)) return
    completionWorkers.current.add(accountId)
    setCompletionBusy(true)
    const stillActive = () => activeAccount.current === accountId
    let createdDrafts = false
    try {
      setCompletionError('')
      const coordinator = createCloudCompletionCoordinator(storage, client, accountId, stillActive)
      const attempted = new Set<string>()
      const attemptedDrafts = new Set<string>()
      do {
        completionRequested.current.delete(accountId)
        if ((await storage.readAccountDraftLists(accountId)).some(row => !row.nameConflict && !attemptedDrafts.has(row.operationId))) {
          if (await verifiedAccountId(client) !== accountId || !stillActive()) return
          const result = await syncAccountDrafts(storage, client, accountId, stillActive, attemptedDrafts)
          if (!stillActive()) return
          if (result.failed) setCompletionError('Не удалось подтвердить создание локальных списков. Повторите синхронизацию.')
          if (result.nameConflict || result.promoted.length) setWorkspaceRevision(value => value + 1)
          for (const { draftId, localListId, remote } of result.promoted) {
            createdDrafts = true
            if (draftId !== localListId) clearListOperation(accountId, draftId)
            setCloudBindings(rows => ({ ...rows, [localListId]: remote.id }))
            setCloudMetadata(rows => rows?.some(row => row.id === remote.id) ? rows
              : [...(rows ?? []), remote].sort((a, b) => a.position - b.position))
            setCloudLists(rows => rows.some(row => row.id === remote.id) ? rows : [...rows, { id: remote.id, name: remote.name }])
          }
        }
        if (!await syncLocalListChanges(accountId, client, stillActive)) return
        if (!await syncQueuedListMerges(accountId, client, stillActive)) return
        const draftIds = new Set((await storage.readAccountDraftLists(accountId)).map(draft => draft.id))
        const [requests, intents] = await Promise.all([
          storage.readAccountCompletionRequests(accountId),
          storage.readAccountCompletions(accountId),
        ])
        const queue = [
          ...requests.filter(row => !draftIds.has(row.localListId)),
          ...intents.filter(intent => !requests.some(request => request.operationId === intent.operationId))
            .map(intent => ({ ...intent, name: cloudMetadata?.find(row => row.id === intent.remoteListId)?.name ?? 'Облачный список' })),
        ]
        for (const request of queue) {
          if (!stillActive() || !navigator.onLine) return
          if (attempted.has(request.operationId)) continue
          attempted.add(request.operationId)
          const { localListId, remoteListId, mode, operationId } = request
          const status = { accountId, localListId, name: request.name, mode, fromLocalCopy: 'fromLocalCopy' in request && request.fromLocalCopy }
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
              await coordinator.begin(localListId, remoteListId, mode, 'confirmedMarked' in request ? request.confirmedMarked : undefined, operationId, ('localKind' in request && request.localKind) ? { kind: request.localKind, name: request.name } : undefined)
            if (!stillActive()) return
            if (receipt.mode === 'delete_list' || (receipt.kind === 'oneoff' && receipt.mode !== 'archive_purchased')) {
              setCloudMetadata(rows => rows?.filter(row => row.id !== remoteListId) ?? null)
              setCloudLists(rows => rows.filter(row => row.id !== remoteListId))
            }
            if (receipt.mode === 'delete_list')
              setCloudBindings(rows => Object.fromEntries(Object.entries(rows).filter(([, id]) => id !== remoteListId)))
            clearListOperation(accountId, localListId)
            setCompletionNotice({
              accountId, at: Date.now(),
              text: receipt.mode === 'delete_list' ? 'Список удалён.' : receipt.mode === 'archive_purchased'
                ? 'Отмеченные покупки перемещены в архив.' : 'Список завершён.',
            })
            setLoadedArchive(null)
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
            let unsent = saved.find(row => row.operationId === operationId)
            const stale = !!cause && typeof cause === 'object' && 'message' in cause &&
              typeof cause.message === 'string' && (cause.message.startsWith('Список изменился.') ||
                ['Локальный и облачный списки расходятся', 'Пустой облачный список',
                  'Облачный список изменился во время проверки', 'List revision conflict', 'List unavailable'].includes(cause.message))
            if (unsent?.fromLocalCopy && stale && !uncertain && await storage.cancelUnsentAccountCompletion(unsent)) {
              unsent = undefined
              try {
                await createAccountSync(storage, client, { accountId, localListId, remoteListId,
                  isActive: stillActive }).importRemoteOnly({ reconcileNames: true })
              } catch { if (stillActive()) setPullState({ account: accountId, status: 'error' }) }
              if (stillActive()) setWorkspaceRevision(value => value + 1)
            }
            if (!stillActive()) return
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
      if (stillActive()) setCompletionError('Не удалось синхронизировать операции со списками. Повторите синхронизацию.')
    } finally {
      completionWorkers.current.delete(accountId)
      completionRequested.current.delete(accountId)
      if (stillActive()) {
        setCompletionBusy(false)
        if (createdDrafts) onQueued()
      }
    }
  }
  useEffect(() => {
    if (!workspaceAccount || workspaceAccount !== readyAccount) return
    const account = workspaceAccount
    let cancelled = false
    void storage.readAccountCompletionRequests(account).then(requests => {
      if (cancelled) return
      for (const request of requests) setListOperations(rows => rows.some(row =>
        row.accountId === account && row.localListId === request.localListId) ? rows : [...rows, { ...request, phase: 'queued',
          dismiss: async () => { if (await storage.cancelUnsentAccountCompletion(request)) clearListOperation(account, request.localListId) },
        }])
      if (currentAccount === account) void processListOperations(account)
    }).catch(() => { if (!cancelled) setCompletionError('Не удалось прочитать очередь операций со списками.') })
    return () => { cancelled = true }
    // A stored operation is resumed only for the verified account after reconnection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceAccount, readyAccount, currentAccount, syncOnline, syncQueueRevision])

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
    setCompletionError('')
    try {
      await storage.queueAccountCompletion(request)
      if (activeAccount.current !== accountId) return
      setListOperation({ ...request, phase: 'queued' })
      void processListOperations(accountId)
    } catch (error) {
      if (activeAccount.current === accountId) setCompletionError(error instanceof Error && error.message.startsWith('Список изменился.')
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
      if (activeAccount.current === currentAccount) setLoadedArchive({ accountId: currentAccount, snapshots })
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
    setLoadedArchive(null)
    setCloudArchiveError('')
    setCompletionPreflight('')
    setCompletionError('')
    setCompletionNotice(undefined)
  }, [workspaceAccount])

  useEffect(() => {
    if (!offlineAccount || offlineAccount !== readyAccount) return
    let cancelled = false
    void storage.readLocalCompletionView(offlineAccount).then(({ snapshots }) => {
      if (!cancelled && snapshots) setLoadedArchive({ accountId: offlineAccount, snapshots })
    }).catch(() => {
      if (!cancelled) setCloudArchiveError('Не удалось прочитать сохранённый архив.')
    })
    return () => { cancelled = true }
  }, [offlineAccount, readyAccount, storage])

  useEffect(() => {
    if (currentAccount && readyAccount === currentAccount) void loadCloudArchive()
    // Refresh once when this account's workspace is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentAccount, readyAccount])

  async function signOut() {
    if (!controller || busy) return
    setBusy(true)
    setSignOutError('')
    try {
      await controller.signOut()
      setAccountDialogOpen(false)
      selectLocalBrowsing(false)
      setVerifiedEmail('')
    } catch {
      setSignOutError('Не удалось завершить выход на сервере. Проверьте подключение.')
    } finally {
      setBusy(false)
    }
  }
  if (workspaceAccount && (readyAccount !== workspaceAccount || profileError)) return <main>
    {transferPrompt && <WorkspaceDialog label={transferPrompt.phase === 'consent' ? 'Синхронизация локального профиля' : 'Совпадают названия списков'} className="e4-create profile-transfer-dialog"
      initialFocusRef={declineTransferButton} onDismiss={() => answerTransfer('skip')}>
      {transferPrompt.phase === 'consent' ? <>
        <h2>Синхронизировать профиль «{transferPrompt.name}» с аккаунтом?</h2>
        <p>Списки, товары и архив будут перенесены в аккаунт. Профиль будет называться логином аккаунта.</p>
        {transferPrompt.existing && <p>На устройстве уже есть профиль этого аккаунта. Данные будут объединены с ним, а исходный локальный профиль удалён после успешного переноса.</p>}
        <p>Если отказаться, локальный профиль останется отдельным.</p>
        <ProfileTransferPreference checked={rememberDecline} onChange={setRememberDecline}>
          Больше не спрашивать для этого профиля
        </ProfileTransferPreference>
        <button type="button" onClick={() => answerTransfer('yes')}>Синхронизировать профиль</button>
        <button type="button" ref={declineTransferButton} onClick={() => answerTransfer(rememberDecline ? 'skip-saved' : 'skip')}>Не синхронизировать</button>
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
      <button type="button" onClick={() => setProfileAttempt(value => value + 1)}>Повторить открытие</button>
      <button type="button" disabled={busy || !controller} onClick={() => void returnToLocalProfiles()}>Вернуться к локальным профилям</button>
      {signOutError && <p role="alert">{signOutError}</p>}
    </>}
  </main>
  if (view.status === 'checking') return <main>
    <p role="status">{signOutError ? 'Аккаунт заблокирован до завершения выхода.' : busy ? 'Выходим из аккаунта…' : 'Проверяем аккаунт…'}</p>
    {signOutError && <><p role="alert">{signOutError}</p><button disabled={busy || !controller} onClick={() => void signOut()}>Повторить выход</button></>}
  </main>
  const pendingWork = pendingSync && pendingSync.account === workspaceAccount ? pendingSync.pending : undefined
  const ownPush = pushState?.account === currentAccount ? pushState?.status : undefined
  const ownPull = pullState?.account === currentAccount ? pullState?.status : undefined
  const syncFailed = ownPush === 'error' || ownPull === 'error'
  const activeOperations = listOperations.filter(row => row.accountId === workspaceAccount)
  const listSyncFailed = !!completionError || activeOperations.some(row => row.phase === 'error' && row.retry)
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
    {client && !workspaceAccount && accountEmailMode && <AccountEmailDialog
      mode={accountEmailMode} initialEmail={email} createClient={createAccountEmailClient}
      onDismiss={() => { setAccountEmailMode(null); setAccountDialogOpen(true) }}
      onCompleted={(address, message) => {
        setEmail(address)
        setAccountEmailMode(null)
        setAccountEmailNotice(message)
        setAccountDialogOpen(true)
      }} />}
    {client && offlineAccount && <p role="status">Локальный профиль: нет сети. Облако недоступно до повторной проверки аккаунта.</p>}
    <App key={workspaceAccount ?? 'local'} storage={storage} accountId={workspaceAccount} cloudOffline={!!offlineAccount} onQueued={workspaceAccount ? onQueued : undefined} refreshRevision={workspaceRevision}
      onResolveItemName={client && currentAccount && readyAccount === currentAccount && syncOnline ? async decision => {
        const listId = decision.change.listId
        const remoteListId = cloudBindings[listId]
        if (!remoteListId || activeAccount.current !== currentAccount || await verifiedAccountId(client) !== currentAccount)
          throw new Error('Account changed')
        try {
          await createAccountSync(storage, client, {
            accountId: currentAccount, localListId: listId, remoteListId,
            isActive: () => activeAccount.current === currentAccount,
          }).resolveItemName(decision)
        } finally {
          setCloudMappingRevision(value => value + 1)
          setWorkspaceRevision(value => value + 1)
        }
      } : undefined}
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
      cloudMerge={currentAccount && client ? cloudListMergeActions(currentAccount, client) : undefined}
      onCreateCloudList={currentAccount && readyAccount === currentAccount ? addCloudList : undefined}
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
      onOpenCloudArchive={currentAccount ? () => void loadCloudArchive() : undefined}
      cloudArchive={currentAccount ? <PurchaseHistory snapshots={cloudArchives} emptyMessage="В облачном архиве пока нет покупок.">
        <button type="button" aria-label="Показать завершённые покупки" aria-busy={cloudArchiveBusy}
          disabled={cloudArchiveBusy} onClick={() => void loadCloudArchive()}>
          {cloudArchiveBusy ? 'Загружаем…' : 'Показать завершённые покупки'}
        </button>
        {cloudArchiveError && <p role="alert">{cloudArchiveError}</p>}
      </PurchaseHistory> : offlineAccount ? <PurchaseHistory snapshots={cloudArchives}>
        {cloudArchiveError ? <p role="alert">{cloudArchiveError}</p>
          : cloudArchives === null && <p>Сохранённый архив недоступен. Подключитесь к интернету, чтобы загрузить его.</p>}
      </PurchaseHistory> : undefined}
      accountCloudLists={currentAccount ? (cloudMetadata ?? []).map(row => ({ ...row, id: Object.keys(cloudBindings).find(localId => cloudBindings[localId] === row.id) ?? row.id })) : offlineLists?.accountId === offlineAccount ? (offlineLists?.lists ?? []) : []} listOperations={activeOperations} completionNotice={completionNotice?.accountId === workspaceAccount ? completionNotice : undefined} completionError={completionError} onCompleteCloudList={currentAccount ? (listId, mode, confirmedMarked, confirmedItemIds) => { void completeCloudList(listId, mode, confirmedMarked, confirmedItemIds) } : undefined}
      accountMenu={client ? {
        open: accountDialogOpen,
        setOpen: open => { setAccountDialogOpen(open); setError(''); if (!open) setPassword('') },
        busy, name: verifiedEmail || undefined, syncState,
        onSelectLocal: enterLocalWorkspace, onOpenLinked: openLinkedWorkspace, sessionAccount,
        content: profile => <>
        {workspaceAccount ? (view.status === 'account' ? <>
          {(syncFailed || listSyncFailed) && <button type="button" onClick={retrySync}>Повторить синхронизацию</button>}
          <button type="button" disabled={busy} onClick={() => void signOut()}>Выйти</button>
        </> : <p role="status">Локальный профиль доступен без сети. Для проверки аккаунта и выхода подключитесь к интернету.</p>) : <>
          {(!profile?.cloudAccountId || profile.cloudAccountId !== sessionAccount) &&
          <form className="profile-login" onSubmit={event => void signIn(event, profile)}>
            {profile?.cloudAccountId ?
              <input type="hidden" name="username" autoComplete="username" value={profile.login ?? ''} /> : <>
              <label htmlFor="auth-email">Email</label>
              <input id="auth-email" name="username" type="email" autoComplete="username" required value={email}
                onChange={event => setEmail(event.target.value)} />
            </>}
            <label htmlFor="auth-password">Пароль</label>
            <input id="auth-password" type="password" autoComplete="current-password" required value={password}
              aria-describedby={error ? 'auth-login-error' : undefined} onChange={event => setPassword(event.target.value)} />
            {error && <p className="profile-login-error" id="auth-login-error" role="alert">{error}</p>}
            <div className="profile-login-actions">
              <button className="profile-login-submit" disabled={busy || !controller}>Войти</button>
              {accountEmailEnabled && <button type="button" disabled={busy}
                onClick={() => openAccountEmail('recover', profile?.cloudAccountId ? profile.login ?? '' : email)}>
                Забыли пароль?
              </button>}
            </div>
            {accountEmailEnabled && !profile?.cloudAccountId && <button className="profile-register" type="button"
              disabled={busy} onClick={() => openAccountEmail('register')}>Зарегистрироваться</button>}
            {accountEmailNotice && <p role="status">{accountEmailNotice}</p>}
          </form>}
        </>}
        </>,
      } : undefined} />
    {currentAccount && transferError && <p role="status">{transferError}</p>}
    {currentAccount && syncOnline && syncFailed && !dismissedSyncError && <section className="sync-error" aria-label="Ошибка синхронизации">
      <p role="alert">{syncError || cloudRefreshStatus || 'Не удалось синхронизировать данные.'}</p>
      <button type="button" onClick={retrySync}>Повторить</button>
      <button type="button" onClick={() => setDismissedSyncError(true)}>Продолжить без синхронизации</button>
    </section>}
    {showLabControls && client && currentAccount && <section aria-label="Облачные списки">
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
