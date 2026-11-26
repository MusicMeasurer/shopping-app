import { beginSync, markSync, traceSync } from './data/sync-diagnostics'
import { pullAccountFeed as pullLegacyAccountFeed } from './data/account-feed'
import { pullSemanticAccountFeed, workspaceSemanticFeedEnabled } from './data/sync-event-runtime'
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
import { AccountDeletionDialog } from './AccountDeletionDialog'
import { useAccountDeletion } from './hooks/useAccountDeletion'
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
import type { SyncWorkKind } from './data/list-sync-ledger'
import { createAuthController } from './data/auth-controller'
import { createSyncRecovery, shouldRecoverSync } from './data/sync-recovery'
import { markAuthStage, exportAuthStages } from './data/auth-flow-diagnostics'
import { createSignOutGuard } from './data/signout-guard'
import { checkVerifiedAccountId, verifiedAccountId, verifySessionIdentity } from './data/verified-account'
import type { AuthView } from './data/auth-view'
import type { SessionCandidate } from './data/auth-scope'

const pullAccountFeed = workspaceSemanticFeedEnabled ? pullSemanticAccountFeed : pullLegacyAccountFeed

type Controller = ReturnType<typeof createAuthController>

const localWorkspaceKey = 'shopping-show-local-workspace'
const accountDeletionEnabled = import.meta.env.VITE_ACCOUNT_DELETION === 'true'
const accountEmailEnabled = import.meta.env.VITE_ACCOUNT_EMAIL_CODES === 'true'
const showLabControls = import.meta.env.VITE_LAB_CONTROLS === 'true'

export function AuthenticatedApp({ storage, client }: { storage: Storage; client: SupabaseClient | null }) {
  const [view, setView] = useState<AuthView>(client ? { status: 'checking' } : { status: 'guest' })
  const deletion = useAccountDeletion(accountDeletionEnabled ? client : null, storage)
  const { check: checkDeletedAccount, watch: watchDeletion, api: deletionApi } = deletion
  const [deleteDialogAccount, setDeleteDialogAccount] = useState<string | null>(null)
  const [deletionNotice, setDeletionNotice] = useState(false)
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
  const [removingLocalCopy, setRemovingLocalCopy] = useState(false)
  const [localCopyRemovalError, setLocalCopyRemovalError] = useState('')
  const deletedSignOutAccount = useRef<string | null>(null)
  const [accountEmailMode, setAccountEmailMode] = useState<AccountEmailMode | null>(null)
  const [accountEmailNotice, setAccountEmailNotice] = useState('')
  const [cloudLists, setCloudLists] = useState<OwnedCloudList[]>([])
  const [cloudMetadata, setCloudMetadata] = useState<CloudListMetadata[] | null>(null)
  const [cloudMetadataError, setCloudMetadataError] = useState('')
  const [cloudMutationBusy, setCloudMutationBusy] = useState(false)
  const [loadedArchive, setLoadedArchive] = useState<{ accountId: string; snapshots: CloudArchiveCompletion[] } | null>(null)
  const [cloudArchiveError, setCloudArchiveError] = useState('')
  const [cloudArchiveBusy, setCloudArchiveBusy] = useState(false)
  const archiveWorkers = useRef(new Map<string, Promise<void>>())
  const archiveRefreshRequested = useRef(new Set<string>())
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
  const requestCloudRefresh = useRef<(() => Promise<void> | undefined) | undefined>(undefined)
  const pullRunningFor = useRef<string | null>(null)
  const deferredCloudRefresh = useRef<string | null>(null)
  const requestRecovery = useRef<((force: boolean) => void) | undefined>(undefined)
  const [recoveryState, setRecoveryState] = useState<{ account: string; status: 'syncing' | 'done' | 'error' }>()
  const lastCloudCheck = useRef<{ accountId: string; at: number } | undefined>(undefined)
  const [cloudRefreshStatus, setCloudRefreshStatus] = useState('')
  const [syncError, setSyncError] = useState('')
  const cardRetries = useRef(new Set<string>())
  const [listOperations, setListOperations] = useState<ListOperationStatus[]>([])
  const [syncOnline, setSyncOnline] = useState(() => navigator.onLine)
  const [pushState, setPushState] = useState<{ account: string; status: 'syncing' | 'done' | 'error' }>()
  const [pullState, setPullState] = useState<{ account: string; status: 'syncing' | 'done' | 'error' }>()
  const [pendingSync, setPendingSync] = useState<{ account: string; pending: boolean }>()
  const [syncQueueRevision, setSyncQueueRevision] = useState(0)
  const [dismissedSyncError, setDismissedSyncError] = useState(false)
  const completionWorkers = useRef(new Map<string, Promise<void>>())
  const completionRequested = useRef(new Set<string>())
  const viewAccount = view.status === 'account' || view.status === 'offline-account' ? view.accountId : null
  const accountWasDeleted = !!viewAccount && deletion.deleted.has(viewAccount)
  const signedInAccount = view.status === 'account' && !accountWasDeleted && !deletion.booting ? view.accountId : null
  const sessionAccount = signedInAccount ?? (view.status === 'offline-account' && !accountWasDeleted ? view.accountId : null)
  const currentAccount = localBrowsing ? null : signedInAccount
  const offlineAccount = !localBrowsing && view.status === 'offline-account' && !accountWasDeleted && !deletion.booting ? view.accountId : null
  const workspaceAccount = currentAccount ?? offlineAccount
  const cloudArchives = loadedArchive?.accountId === workspaceAccount ? loadedArchive.snapshots : null
  useEffect(() => {
    if (sessionAccount) return watchDeletion(sessionAccount)
  }, [sessionAccount, watchDeletion])
  useEffect(() => {
    if (!accountWasDeleted || !controller || !viewAccount ||
        deletedSignOutAccount.current === viewAccount) return
    // Deletion is already confirmed. Do not await another getSession() before
    // hiding the revoked account: that call can stall on the Auth storage lock.
    deletedSignOutAccount.current = viewAccount
    setSignOutError('')
    void controller.signOut('local', () => {
      // Also runs when Supabase finishes AFTER the UI sign-out timeout.
      if (deletedSignOutAccount.current === viewAccount) {
        deletedSignOutAccount.current = null
        setSignOutError('')
      }
    }).catch(() => {
      // Keep the sign-out guard in place but provide a retry without reloading Safari.
      if (deletedSignOutAccount.current === viewAccount)
        setSignOutError('Не удалось завершить выход с устройства. Повторите попытку.')
    })
  }, [accountWasDeleted, controller, viewAccount])
  useEffect(() => {
    const update = () => { markSync(navigator.onLine ? 'online' : 'offline', 'ok'); setSyncOnline(navigator.onLine) }
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
      if (active) { markSync('profile-pending', 'ok', { pending }); setPendingSync({ account, pending }) }
    }).catch(() => {
      if (active) { markSync('profile-pending', 'error'); setPendingSync(undefined) }
    })
    return () => { active = false }
  }, [storage, workspaceAccount, workspaceRevision, pushState, pullState, listOperations, accountDialogOpen, syncQueueRevision])
  useEffect(() => { setSyncError(''); setRecoveryState(undefined) }, [currentAccount])

  useEffect(() => {
    if (currentAccount) { setAccountDialogOpen(false); setPassword('') }
  }, [currentAccount])
  const [offlineLists, setOfflineLists] = useState<{
    accountId: string; bindings: Record<string, string>;
    lists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[]
  } | null>(null)
  const [readyAccount, setReadyAccount] = useState<string | null>(null)
  const [profileError, setProfileError] = useState('')
  const [authDiagnosticsCopied, setAuthDiagnosticsCopied] = useState(false)
  function copyAuthDiagnostics() {
    void navigator.clipboard.writeText(exportAuthStages())
      .then(() => setAuthDiagnosticsCopied(true))
      .catch(() => setAuthDiagnosticsCopied(false))
  }
  const [profileAttempt, setProfileAttempt] = useState(0)
  const installationFailures = useRef(new Map<string, number>())
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
    let installationRetry: ReturnType<typeof setTimeout> | undefined
    markAuthStage('profile_open_start')
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
      if (deletionApi) {
        try {
          const device = await storage.readInstallationIdentity()
          if (cancelled) return
          await deletionApi.register(currentAccount, device)
          installationFailures.current.delete(currentAccount)
        } catch {
          if (cancelled) return
          const failures = installationFailures.current.get(currentAccount) ?? 0
          installationFailures.current.set(currentAccount, Math.min(failures + 1, 4))
          throw new Error('Could not register installation')
        }
        if (cancelled) return
      }
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
        markAuthStage('merge_sync_start')
        await syncGuestImports(storage, client, currentAccount,
          async () => !cancelled && await verifiedAccountId(client) === currentAccount, 'profile')
        markAuthStage('merge_sync_complete')
      } catch (error) {
        markAuthStage('merge_sync_failed', error)
        if (!cancelled) setTransferError((error as { code?: string })?.code === '23505'
          ? 'Перенос остановлен: в аккаунте уже есть список с таким названием. Локальные данные сохранены.'
          : 'Перенос локального профиля не завершён. Данные сохранены. Повторите вход после восстановления связи.')
      }
      const restore = await storage.needsAccountCacheRestore(currentAccount)
      if (workspaceSemanticFeedEnabled) {
        try {
          const selected = localStorage.getItem('shopping-workspace:' + currentAccount + ':list')
          if (selected) await storage.recordAccountSyncContext(currentAccount, selected)
        } catch { /* optional context capture; existing data synchronization remains authoritative */ }
      }
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
        markAuthStage('profile_open_ready')
        setReadyAccount(currentAccount)
      localReturnProfile.current = undefined
      }
    })().catch((cause: unknown) => {
      markAuthStage('profile_open_failed', cause)
      const failures = installationFailures.current.get(currentAccount)
      if (!cancelled && failures) {
        installationRetry = setTimeout(() => {
          if (!cancelled && navigator.onLine) setProfileAttempt(value => value + 1)
        }, Math.min(5000 * 2 ** (failures - 1), 60_000))
      }
      if (!cancelled) setProfileError(cause instanceof LocalProfileLimitError ? cause.message : 'Не удалось безопасно открыть локальный профиль аккаунта. Покупки сохранены; повторите открытие.')
    })
    const retryInstallation = () => {
      if (installationFailures.current.has(currentAccount)) setProfileAttempt(value => value + 1)
    }
    window.addEventListener('online', retryInstallation)
    return () => {
      cancelled = true
      clearTimeout(installationRetry)
      window.removeEventListener('online', retryInstallation)
      transferAnswer.current?.('skip')
      transferAnswer.current = null
      setTransferPrompt(null)
    }
  }, [client, currentAccount, deletionApi, offlineAccount, workspaceAccount, storage, profileAttempt])
  const activeAccount = useRef<string | null>(null)
  // A verified session is not enough: the account workspace must have a
  // durable local profile before any background sync or refresh may run.
  activeAccount.current = readyAccount === currentAccount ? currentAccount : null
  const automaticFlushRunning = useRef(new Map<string, Promise<void>>())
  const flushRequested = useRef(new Set<string>())
  const onQueued = useCallback((): Promise<void> | undefined => {
    storage.listSyncLedger.changed()
    setSyncQueueRevision(revision => revision + 1)
    if (!client || !currentAccount || readyAccount !== currentAccount || !navigator.onLine) return
    const accountId = currentAccount
    const running = automaticFlushRunning.current.get(accountId)
    if (running) {
      flushRequested.current.add(accountId)
      return running
    }
    setPushState({ account: accountId, status: 'syncing' })
    setDismissedSyncError(false)
    const finishPush = beginSync('push')
    let pushOutcome: 'ok' | 'error' | 'cancelled' = 'cancelled'
    const task = (async () => {
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
        const pendingCount = (await storage.readAccountPending(accountId)).length
        markSync('queue', 'ok', { count: pendingCount })
        if (!pendingCount) {
          if (activeAccount.current === accountId) {
            pushOutcome = 'ok'
            setSyncError('')
            setPushState({ account: accountId, status: 'done' })
          }
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
          pushOutcome = 'ok'
          setCloudMappingRevision(value => value + 1)
          setSyncError('')
          setPushState({ account: accountId, status: 'done' })
        }
      } catch {
        pushOutcome = 'error'
        if (activeAccount.current === accountId) {
          setSyncError('Не удалось отправить изменения. Повторите синхронизацию.')
          setPushState({ account: accountId, status: 'error' })
        }
      } finally { finishPush(pushOutcome) }
    })().finally((): void | Promise<void> => {
      automaticFlushRunning.current.delete(accountId)
      const requested = flushRequested.current.delete(accountId)
      if (requested && activeAccount.current === accountId) return onQueued()
    })
    automaticFlushRunning.current.set(accountId, task)
    return task
  }, [client, currentAccount, readyAccount, storage])

  // A browser restart can leave durable operations queued without a new edit.
  // Resume only after the account becomes active; onQueued verifies the server
  // identity before accessing account-scoped mappings and pending operations.
  useEffect(() => {
    if (currentAccount && readyAccount === currentAccount && client) onQueued()
  }, [currentAccount, readyAccount, client, onQueued])

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
    }, guard, async session => {
      const id = session.user?.id?.toLowerCase()
      if (id && await traceSync('deletion-check', () => checkDeletedAccount(id), {}, deleted => !deleted)) return null
      return verifySessionIdentity(client, session)
    }, async session => {
      if (guard.isPending()) return null
      const id = session.user?.id?.toLowerCase()
      if (id && await storage.isDeletedAccount(id)) return null
      const registry = await storage.readLocalProfiles()
      return registry?.profiles.some(profile => profile.cloudAccountId === id) ? id : null
    })
    setController(next)
    void next.initialize()
    return () => {
      next.dispose()
      setController(null)
    }
  }, [client, storage, checkDeletedAccount])

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
    let running: Promise<void> | undefined
    let queued: 'all' | 'changed' | undefined
    const pulledRevisions = new Map<string, number>()
    let pullFailed = false
    function refresh(mode: 'all' | 'changed' = 'all'): Promise<void> | undefined {
      if (!client || disposed || !navigator.onLine) return
      if (document.visibilityState === 'hidden') {
        deferredCloudRefresh.current = accountId
        return
      }
      deferredCloudRefresh.current = null
      if (running) {
        if (mode === 'all' || !queued) queued = mode
        return running
      }
      queued = undefined
      pullRunningFor.current = accountId
      const finishPull = beginSync('pull')
      const task = (async () => {
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
            // Scope a known legacy list read failure, not an account-wide poll.
            if (stillActive()) {
              storage.listSyncLedger.begin(accountId, 'legacy-feed:' + localListId, [localListId], 'feed', false, 'items')
              storage.listSyncLedger.fail(accountId, 'legacy-feed:' + localListId)
            }
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
        finishPull(disposed || activeAccount.current !== accountId ? 'cancelled' : failed ? 'error' : 'ok', { count: requests })
        if (!disposed && activeAccount.current === accountId) {
          if (failed) lastCloudCheck.current = undefined
          else {
            lastCloudCheck.current = { accountId, at: Date.now() }
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
      }
      })().finally((): void | Promise<void> => {
        running = undefined
        if (disposed) return
        if (pullRunningFor.current === accountId) pullRunningFor.current = null
        if (queued) return refresh(queued)
      })
      running = task
      return task
    }
    requestCloudRefresh.current = () => refresh('changed')
    const stopWatching = watchCloudListChanges(client, accountId, () => void refresh('changed'))
    void refresh()
    return () => {
      disposed = true
      requestCloudRefresh.current = undefined
      if (pullRunningFor.current === accountId) pullRunningFor.current = null
      if (deferredCloudRefresh.current === accountId) deferredCloudRefresh.current = null
      stopWatching()
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
        const affected = [source.localListId, target.localListId]
        const ledger = storage.listSyncLedger
        const approved = new Map(choices)
        let running = false
        const run = async (retry = false) => {
          if (running || !stillActive() || !navigator.onLine) return
          running = true
          try {
            if (retry) {
              // Revalidate the actor and local dependencies before replaying
              // the same reviewed, idempotent operation after an uncertain response.
              if (await verifiedAccountId(connection) !== account || !stillActive()) return
              const [pending, requests, intents, conflicts] = await Promise.all([
                storage.readAccountPending(account), storage.readAccountCompletionRequests(account),
                storage.readAccountCompletions(account), storage.readItemDeletionConflicts(account),
              ])
              if (!stillActive()) return
              if (pending.some(row => !('localListId' in row) || affected.includes(row.localListId)) ||
                  [...requests, ...intents, ...conflicts].some(row => affected.includes(row.localListId))) {
                setCompletionError('Дождитесь синхронизации обоих списков и разрешите возможные конфликты.')
                return
              }
            }
            if (workspaceSemanticFeedEnabled) await storage.rememberAccountSyncOperation(account, operationId)
            ledger.begin(account, operationId, affected, 'lists', false)
            try { await applyCloudListMerge(connection, snapshot, source, target, approved, operationId) }
            catch (error) {
              if (stillActive() && !(error instanceof ListMergeConflict)) {
                ledger.registerRetry(account, operationId, () => run(true))
                ledger.fail(account, operationId)
              } else {
                ledger.cancel(account, operationId)
                if (retry && stillActive()) setCompletionError('Списки изменились. Проверьте их и подтвердите объединение заново.')
              }
              throw error
            }
            if (!stillActive()) { ledger.cancel(account, operationId); return }
            // A confirmed receipt may not be resent merely because the cache
            // refresh fails. The feed owns successful local application.
            setCloudMetadata(rows => rows?.filter(row => row.id !== source.remoteListId) ?? null)
            setCloudLists(rows => rows.filter(row => row.id !== source.remoteListId))
            ledger.cancel(account, operationId)
            const feedId = 'merge-feed:' + operationId
            try {
              if (await storage.readAccountFeedPosition(account) !== undefined) {
                if (stillActive()) requestCloudRefresh.current?.()
                return
              }
              ledger.begin(account, feedId, [target.localListId], 'feed', false)
              await createAccountSync(storage, connection, { accountId: account, localListId: target.localListId,
                remoteListId: target.remoteListId, isActive: stillActive }).importRemoteOnly({ reconcileNames: true })
              if (stillActive()) {
                ledger.confirm(account, feedId, [target.localListId])
                setWorkspaceRevision(value => value + 1)
              } else ledger.cancel(account, feedId)
            } catch {
              if (stillActive()) {
                ledger.fail(account, feedId)
                setPullState({ account, status: 'error' })
              } else ledger.cancel(account, feedId)
            }
          } finally { running = false }
        }
        await run()
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
      storage.listSyncLedger.confirm(accountId, 'create:' + created.id, [created.id], Date.now(), 'lists')
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
    const operationId = crypto.randomUUID()
    const localListId = Object.keys(cloudBindings).find(id => cloudBindings[id] === row.id) ?? row.id
    const target = change.action === 'reorder' ? cloudMetadata?.find(value => value.position === change.position) : undefined
    const affected = [localListId, ...(target && target.id !== row.id ? [Object.keys(cloudBindings).find(id => cloudBindings[id] === target.id) ?? target.id] : [])]
    let running = false
    const run = async (): Promise<boolean | undefined> => {
      if (running || activeAccount.current !== accountId || !navigator.onLine) return
      running = true
      setCloudMutationBusy(true)
      setCloudMetadataError('')
    try {
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      storage.listSyncLedger.begin(accountId, operationId, affected, 'lists', false)
      await sendCloudListChange(client, row, operationId, change)
      void storage.markAccountListsChanged(accountId).catch(() => {})
      const refreshed = await fetchCloudListMetadata(client, accountId)
      if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId)
        throw new Error('Account changed')
      await storage.cacheAccountListMetadata(accountId, refreshed, { partial: true })
      if (activeAccount.current !== accountId) return
      setCloudMetadata(refreshed)
      setCloudLists(refreshed.map(value => ({ id: value.id, name: value.name })))
      storage.listSyncLedger.confirm(accountId, operationId, affected)
      return true
    } catch (error) {
      if (activeAccount.current === accountId) {
        const cause = error as { code?: string; message?: string }
        if (cause?.code === '23505' || ['List revision conflict', 'List unavailable'].includes(cause?.message ?? '')) {
          storage.listSyncLedger.cancel(accountId, operationId)
          setCloudMetadataError(cause?.code === '23505' ? 'Список с таким названием уже существует.' :
            'Список изменился. Проверьте его и подтвердите изменение заново.')
        } else {
          // Replay precisely the original verified operation, not a new write.
          storage.listSyncLedger.registerRetry(accountId, operationId, run)
          storage.listSyncLedger.fail(accountId, operationId)
          setCloudMetadataError('Изменение не подтверждено сервером. Проверьте список заново; не повторяйте операцию до проверки состояния.')
        }
      }
    } finally {
      if (activeAccount.current !== accountId) storage.listSyncLedger.cancel(accountId, operationId)
      setCloudMutationBusy(false)
      running = false
    }
    }
    return run()
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
    markAuthStage('local_profile_selected')
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
      if (target && await checkDeletedAccount(target)) {
        setDeletionNotice(true)
        return
      }
      if (!target && deletionApi) {
        const registry = await storage.readLocalProfiles()
        const oldCopy = registry?.profiles.find(row => row.cloudAccountId && row.login?.trim().toLowerCase() === address.toLowerCase())
        if (oldCopy?.cloudAccountId) await checkDeletedAccount(oldCopy.cloudAccountId)
      }
      offerTransfer.current = !target
      submittingCredentials = true
      if (sessionAccount || target) {
        if (!navigator.onLine) throw new Error('Подключитесь к интернету для смены аккаунта.')
        const isolated = createAccountEmailClient()
        if (!isolated) throw new Error('Подключение к аккаунту недоступно.')
        // Validate credentials before replacing the currently authorized session.
        markAuthStage('credentials_requested')
        const { data, error: credentialsError } = await isolated.auth.signInWithPassword({ email: address, password })
        if (credentialsError) throw credentialsError
        markAuthStage('credentials_accepted')
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
        markAuthStage('linked_session_set')
        await controller.confirmSession(data.user.id.toLowerCase())
      } else {
        await controller.signIn(address, password)
        submittingCredentials = false
      }
      setPassword('')
      selectLocalBrowsing(false)
    } catch (cause) {
      markAuthStage('credentials_rejected', cause)
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

  async function syncLocalListChanges(accountId: string, client: SupabaseClient, stillActive: () => boolean, onlyListId?: string) {
    const queue = (await storage.readLocalListChanges(accountId)).filter(row => !onlyListId ||
      row.localListId === onlyListId || row.targetId === (cloudBindings[onlyListId] ?? onlyListId))
    if (!queue.length) return true
    if (await verifiedAccountId(client) !== accountId || !stillActive()) return false
    let metadata = await fetchCloudListMetadata(client, accountId)
    for (const operation of queue) {
      if (!stillActive() || !navigator.onLine) return false
      const current = metadata.find(row => row.id === operation.remoteListId)
      const { change, before, prepared, targetId } = operation
      const affected = [operation.localListId, ...(targetId ? [Object.keys(cloudBindings).find(id => cloudBindings[id] === targetId) ?? targetId] : [])]
      try {
      const unchanged = current && (change.action === 'rename' ? current.name === before.name
        : change.action === 'kind' ? current.kind === before.kind
          : current.position === before.position && metadata.some(row => row.id === targetId && row.position === change.position))
      let conflict = !prepared && !unchanged
      if (!conflict) {
        const base = prepared ?? await storage.prepareLocalListChange(accountId, operation, current!)
        if (!stillActive()) return false
        try {
          storage.listSyncLedger.begin(accountId, operation.operationId, affected, 'lists')
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
      if (conflict) {
        storage.listSyncLedger.cancel(accountId, operation.operationId)
        setCompletionError('Список изменился на другом устройстве или название занято. Проверьте список и повторите изменение.')
      } else storage.listSyncLedger.confirm(accountId, operation.operationId, affected)
      } catch (error) {
        if (stillActive()) storage.listSyncLedger.fail(accountId, operation.operationId)
        throw error
      } finally {
        if (!stillActive()) storage.listSyncLedger.cancel(accountId, operation.operationId)
      }
    }
    return true
  }

  async function syncQueuedListMerges(accountId: string, connection: SupabaseClient, stillActive: () => boolean, onlyListId?: string) {
    for (const merge of (await storage.readQueuedListMerges(accountId)).filter(row =>
      !onlyListId || row.source.localListId === onlyListId || row.target.localListId === onlyListId)) {
      if (!stillActive() || await verifiedAccountId(connection) !== accountId || !stillActive()) return false
      const { source, target, expected, operationId } = merge
      const affected = [source.localListId, target.localListId]
      let prepared = merge
      try {
      try {
        storage.listSyncLedger.begin(accountId, operationId, affected, 'lists')
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
          if (!saved) { storage.listSyncLedger.cancel(accountId, operationId); continue }
          prepared = saved
        }
        if (!stillActive()) return false
        await applyCloudListMerge(connection, { ...expected, ...prepared.revisions }, source, target, new Map(merge.choices), operationId)
      } catch (error) {
        if (!(error instanceof ListMergeConflict)) throw error
        if (!stillActive()) return false
        await storage.finishQueuedListMerge(accountId, prepared)
        storage.listSyncLedger.cancel(accountId, operationId)
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
      storage.listSyncLedger.confirm(accountId, operationId, affected)
      setCloudMetadata(metadata)
      setCloudLists(metadata.map(row => ({ id: row.id, name: row.name })))
      setCloudBindings(rows => Object.fromEntries(Object.entries(rows).filter(([, id]) => id !== source.remoteListId)))
      setWorkspaceRevision(value => value + 1)
      setCloudMappingRevision(value => value + 1)
      } catch (error) {
        if (stillActive()) storage.listSyncLedger.fail(accountId, operationId)
        throw error
      } finally {
        if (!stillActive()) storage.listSyncLedger.cancel(accountId, operationId)
      }
    }
    return true
  }

  function processListOperations(accountId: string, onlyListId?: string): Promise<void> | undefined {
    if (!client || activeAccount.current !== accountId || !navigator.onLine) return
    if (!onlyListId) completionRequested.current.add(accountId)
    const running = completionWorkers.current.get(accountId)
    if (running) return onlyListId ? running.then(() => processListOperations(accountId, onlyListId)) : running
    setCompletionBusy(true)
    const stillActive = () => activeAccount.current === accountId
    let createdDrafts = false
    const task = (async () => {
    try {
      setCompletionError('')
      const coordinator = createCloudCompletionCoordinator(storage, client, accountId, stillActive)
      const attempted = new Set<string>()
      const attemptedDrafts = new Set<string>()
      do {
        if (!onlyListId) completionRequested.current.delete(accountId)
        if ((await storage.readAccountDraftLists(accountId)).some(row => (!onlyListId || row.id === onlyListId) && !row.nameConflict && !attemptedDrafts.has(row.operationId))) {
          if (await verifiedAccountId(client) !== accountId || !stillActive()) return
          const result = await syncAccountDrafts(storage, client, accountId, stillActive, attemptedDrafts, onlyListId)
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
        if (!await syncLocalListChanges(accountId, client, stillActive, onlyListId)) return
        if (!await syncQueuedListMerges(accountId, client, stillActive, onlyListId)) return
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
          if (onlyListId && request.localListId !== onlyListId) continue
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
            storage.listSyncLedger.begin(accountId, operationId, [localListId], 'lists')
            const receipt = intent ? await coordinator.resume(intent) :
              await coordinator.begin(localListId, remoteListId, mode, 'confirmedMarked' in request ? request.confirmedMarked : undefined, operationId, ('localKind' in request && request.localKind) ? { kind: request.localKind, name: request.name } : undefined)
            if (!stillActive()) return
            if (receipt.mode === 'delete_list' || (receipt.kind === 'oneoff' && receipt.mode !== 'archive_purchased')) {
              setCloudMetadata(rows => rows?.filter(row => row.id !== remoteListId) ?? null)
              setCloudLists(rows => rows.filter(row => row.id !== remoteListId))
            }
            if (receipt.mode === 'delete_list')
              setCloudBindings(rows => Object.fromEntries(Object.entries(rows).filter(([, id]) => id !== remoteListId)))
            storage.listSyncLedger.confirm(accountId, operationId, [localListId])
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
            if (retry) storage.listSyncLedger.fail(accountId, operationId)
            else storage.listSyncLedger.cancel(accountId, operationId)
            storage.listSyncLedger.changed()
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
          } finally {
            if (!stillActive()) storage.listSyncLedger.cancel(accountId, operationId)
          }
        }
      } while (!onlyListId && completionRequested.current.has(accountId) && stillActive())
    } catch {
      if (stillActive()) setCompletionError('Не удалось синхронизировать операции со списками. Повторите синхронизацию.')
    }
    })().finally((): void | Promise<void> => {
      completionWorkers.current.delete(accountId)
      const requested = completionRequested.current.delete(accountId)
      if (stillActive()) {
        setCompletionBusy(false)
        if (createdDrafts) void onQueued()
        if (requested && navigator.onLine) return processListOperations(accountId)
      }
    })
    completionWorkers.current.set(accountId, task)
    return task
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
      storage.listSyncLedger.changed()
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
  function loadCloudArchive(refresh = false): Promise<void> | undefined {
    if (!client || !currentAccount || activeAccount.current !== currentAccount) return
    const accountId = currentAccount
    const running = archiveWorkers.current.get(accountId)
    if (running) {
      if (refresh) archiveRefreshRequested.current.add(accountId)
      return running
    }
    setCloudArchiveBusy(true)
    setCloudArchiveError('')
    const finishArchive = beginSync('archive')
    let archiveOutcome: 'ok' | 'error' | 'cancelled' = 'cancelled'
    const task = (async () => {
    try {
      // Verify the active identity; never show snapshots from an old account.
      const { data: { user }, error: identityError } = await client.auth.getUser()
      if (identityError || user?.id !== currentAccount) throw new Error('Аккаунт не подтверждён')
      const snapshots = await fetchCloudArchive(client)
      const { data: { user: stillCurrent }, error: recheckError } = await client.auth.getUser()
      if (recheckError || stillCurrent?.id !== currentAccount) throw new Error('Аккаунт изменился')
      if (activeAccount.current !== currentAccount) return
      const cached = await storage.cacheAccountArchive(currentAccount, snapshots)
      if (cached && activeAccount.current === currentAccount) {
        archiveOutcome = 'ok'
        setLoadedArchive({ accountId: currentAccount, snapshots: cached })
      }
    } catch (err) {
      archiveOutcome = 'error'
      if (activeAccount.current === currentAccount)
        setCloudArchiveError(err instanceof Error ? err.message : 'Не удалось загрузить архив')
    } finally { finishArchive(archiveOutcome) }
    })().finally((): void | Promise<void> => {
      archiveWorkers.current.delete(accountId)
      const requested = archiveRefreshRequested.current.delete(accountId)
      if (activeAccount.current === accountId) {
        setCloudArchiveBusy(false)
        if (requested) return loadCloudArchive()
      }
    })
    archiveWorkers.current.set(accountId, task)
    return task
  }
  useEffect(() => {
    setLoadedArchive(null)
    setCloudArchiveBusy(false)
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

  // One recovery owner for resume, reconnect and explicit retry. Existing
  // workers keep their own account-scoped serialization and durable receipts.
  // Use the latest render's callbacks/state without reinstalling listeners
  // or abandoning an in-flight recovery on every status update.
  const recoveryContext = {
    currentAccount, readyAccount, sessionAccount, workspaceAccount, busy,
    pendingSync, pushState, pullState, recoveryState, cloudArchiveError, cloudArchiveBusy,
    cloudArchives, completionError, listOperations,
    onQueued, processListOperations, loadCloudArchive,
  }
  const latestRecovery = useRef(recoveryContext)
  latestRecovery.current = recoveryContext
  useEffect(() => {
    if (!controller) return
    const account = currentAccount
    let disposed = false
    const stillCurrent = () => !disposed && !!account && activeAccount.current === account &&
      latestRecovery.current.currentAccount === account && latestRecovery.current.readyAccount === account &&
      !latestRecovery.current.busy
    const runner = createSyncRecovery(async (force, isCurrent) => {
      if (!account || !stillCurrent() || !navigator.onLine || document.visibilityState !== 'visible') { markSync('recovery', 'skipped'); return }
      const valid = () => isCurrent() && stillCurrent()
      const finishRecovery = beginSync('recovery')
      let recoveryOutcome: 'ok' | 'error' | 'cancelled' | 'deferred' = 'cancelled'
      setRecoveryState({ account, status: 'syncing' })
      setDismissedSyncError(false)
      try {
        if (!await controller.recheckSession(account, valid)) {
          recoveryOutcome = 'error'
          if (valid()) setRecoveryState({ account, status: 'error' })
          return
        }
        if (!valid()) return
        if (!navigator.onLine || document.visibilityState !== 'visible') {
          deferredCloudRefresh.current = account
          recoveryOutcome = 'deferred'
          setRecoveryState({ account, status: 'done' })
          return
        }
        await latestRecovery.current.onQueued()
        if (!valid()) return
        await traceSync('list-work', async () => latestRecovery.current.processListOperations(account))
        if (!valid()) return
        // A list-operation worker can create additional pending item writes.
        const push = automaticFlushRunning.current.get(account)
        if (push) await push
        if (!valid()) return
        if (!navigator.onLine || document.visibilityState !== 'visible') {
          deferredCloudRefresh.current = account
          recoveryOutcome = 'deferred'
          setRecoveryState({ account, status: 'done' })
          return
        }
        await requestCloudRefresh.current?.()
        if (!valid()) return
        const state = latestRecovery.current
        if (force || state.cloudArchiveError || state.cloudArchiveBusy || state.cloudArchives === null)
          await state.loadCloudArchive(true)
        if (valid()) {
          recoveryOutcome = 'ok'
          setRecoveryState({ account, status: 'done' })
        }
      } catch {
        recoveryOutcome = 'error'
        if (valid()) setRecoveryState({ account, status: 'error' })
      } finally { finishRecovery(recoveryOutcome) }
    })
    const request = (force: boolean) => {
      if (disposed || !navigator.onLine || document.visibilityState !== 'visible') { markSync('request', 'skipped'); return }
      if (latestRecovery.current.busy) { markSync('request', 'skipped'); return }
      if (!account || !stillCurrent()) {
        markSync('request', 'deferred')
        // Restore an offline/locally browsed session through the existing
        // controller; a new ready cloud workspace starts its usual workers.
        if (!account) void controller.initialize()
        return
      }
      const state = latestRecovery.current
      const last = lastCloudCheck.current
      const pending = state.pendingSync?.account !== account || state.pendingSync.pending !== false
      const unhealthy = state.pushState?.account !== account || state.pushState.status !== 'done' ||
        state.pullState?.account !== account || state.pullState.status !== 'done' ||
        (state.recoveryState?.account === account && state.recoveryState.status !== 'done') ||
        !!state.cloudArchiveError || !!state.completionError ||
        state.listOperations.some(row => row.accountId === account && (row.phase !== 'error' || !!row.retry))
      if (shouldRecoverSync({
        force, unhealthy, pending,
        working: runner.running() || automaticFlushRunning.current.has(account) || completionWorkers.current.has(account) ||
          pullRunningFor.current === account || archiveWorkers.current.has(account),
        deferred: deferredCloudRefresh.current === account,
        lastSuccess: last?.accountId === account ? last.at : undefined,
        now: Date.now(),
      })) {
        markSync('request', runner.running() ? 'queued' : 'start', { pending })
        runner.request(force)
      } else markSync('request', 'skipped', { pending })
    }
    requestRecovery.current = request
    const onVisible = () => { markSync(document.visibilityState === 'visible' ? 'visible' : 'hidden', 'ok'); request(false) }
    const onOnline = () => request(true)
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) { markSync('pageshow', 'ok'); request(false) } }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      disposed = true
      runner.dispose()
      if (requestRecovery.current === request) requestRecovery.current = undefined
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [controller, currentAccount, readyAccount, sessionAccount])

  async function signOut() {
    if (!controller || busy) return
    setBusy(true)
    setSignOutError('')
    const deletedAccount = deletedSignOutAccount.current
    try {
      await controller.signOut(deletedAccount ? 'local' : undefined, deletedAccount
        ? () => {
          // Clear the marker on actual SDK completion, not only when await resolves.
          if (deletedSignOutAccount.current === deletedAccount) {
            deletedSignOutAccount.current = null
            setSignOutError('')
          }
        }
        : undefined)
      setAccountDialogOpen(false)
      selectLocalBrowsing(false)
      setVerifiedEmail('')
    } catch {
      setSignOutError(deletedAccount
        ? 'Не удалось завершить выход с устройства. Повторите попытку.'
        : 'Не удалось завершить выход на сервере. Проверьте подключение.')
    } finally {
      setBusy(false)
    }
  }
  // This operation belongs to the auth owner, not App: its cloud workspace
  // unmounts as soon as signOut enters checking. Do not expose a new workspace
  // until the exact confirmed local copy has been removed or safely retained.
  async function removeAuthorizedLocalCopy(profileId: string, accountId: string) {
    if (!controller || busy || removingLocalCopy || accountId !== sessionAccount) return
    setBusy(true)
    setRemovingLocalCopy(true)
    setLocalCopyRemovalError('')
    setSignOutError('')
    let logoutStarted = false
    let signedOut = false
    try {
      const registry = await storage.readLocalProfiles()
      if (!registry?.profiles.some(row => row.id === profileId && row.cloudAccountId === accountId))
        throw new Error('Profile changed')
      if (await storage.hasAccountSyncWork(accountId)) throw new Error('Profile has unsynced operations')
      logoutStarted = true
      // Use the same scope as ordinary sign-out, never account deletion.
      // A timed-out or rejected request cannot authorize purging the copy.
      let confirmed = false
      await controller.signOut(undefined, () => { confirmed = true })
      if (!confirmed) throw new Error('Sign-out not confirmed')
      signedOut = true
      setAccountDialogOpen(false)
      selectLocalBrowsing(false)
      setVerifiedEmail('')
      // The storage transaction rechecks pending work before clearing data.
      await storage.deleteLocalProfile(profileId, profileId)
    } catch (cause) {
      const pending = cause instanceof Error && cause.message.includes('unsynced operations')
      const message = pending
        ? 'Есть неотправленные изменения. Локальная копия сохранена. Сначала завершите синхронизацию.'
        : logoutStarted && !signedOut
          ? 'Не удалось завершить выход. Локальная копия не удалена.'
          : 'Не удалось удалить локальную копию. Данные сохранены.'
      setLocalCopyRemovalError(message)
      if (logoutStarted && !signedOut) setSignOutError(message)
    } finally {
      setRemovingLocalCopy(false)
      setBusy(false)
    }
  }
  if (removingLocalCopy) return <main><p role="status">Выходим из аккаунта и удаляем локальную копию…</p></main>
  if (deletion.booting) return <main><p role="status">Проверяем сохранённые профили…</p></main>
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
      <button type="button" onClick={copyAuthDiagnostics}>Скопировать диагностику входа</button>
      {authDiagnosticsCopied && <p role="status">Диагностика скопирована без личных данных.</p>}
      <button type="button" disabled={busy || !controller} onClick={() => void returnToLocalProfiles()}>Вернуться к локальным профилям</button>
      {signOutError && <p role="alert">{signOutError}</p>}
    </>}
  </main>
  if (view.status === 'checking') return <main>
    <p role="status">{signOutError ? 'Аккаунт заблокирован до завершения выхода.'
      : deletedSignOutAccount.current ? 'Завершаем выход после удаления аккаунта…'
      : busy ? 'Выходим из аккаунта…' : 'Проверяем аккаунт…'}</p>
    {signOutError && <><p role="alert">{signOutError}</p><button disabled={busy || !controller} onClick={() => void signOut()}>Повторить выход</button></>}
  </main>
  const pendingWork = pendingSync && pendingSync.account === workspaceAccount ? pendingSync.pending : undefined
  const ownPush = pushState?.account === currentAccount ? pushState?.status : undefined
  const ownPull = pullState?.account === currentAccount ? pullState?.status : undefined
  const ownRecovery = recoveryState?.account === currentAccount ? recoveryState?.status : undefined
  const syncFailed = ownPush === 'error' || ownPull === 'error' || ownRecovery === 'error' || !!(currentAccount && cloudArchiveError)
  const activeOperations = listOperations.filter(row => row.accountId === workspaceAccount)
  const listSyncFailed = !!completionError || activeOperations.some(row => row.phase === 'error' && row.retry)
  const syncState: ProfileSyncState | undefined = !workspaceAccount ? undefined
    : !syncOnline || !!offlineAccount ? (pendingWork || activeOperations.some(row => row.phase !== 'error' || row.retry) ? 'waiting' : 'offline')
    : ownRecovery === 'syncing' || ownPush === 'syncing' || ownPull === 'syncing' || activeOperations.some(row => row.phase === 'running') ? 'syncing'
    : syncFailed || listSyncFailed ? 'error'
    : pendingWork || activeOperations.some(row => row.phase !== 'error' || row.retry) ? 'waiting'
    : ownPush === 'done' && ownPull === 'done' && pendingWork === false ? 'synced' : 'waiting'
  function retrySync() {
    markSync('manual', requestRecovery.current ? 'start' : 'skipped')
    setDismissedSyncError(false)
    requestRecovery.current?.(true)
  }
  async function retryListSync(listId: string, kinds: readonly SyncWorkKind[]) {
    if (!client || !currentAccount || readyAccount !== currentAccount || !navigator.onLine || cloudMutationBusy) return
    const account = currentAccount
    const key = account + ':' + listId
    if (cardRetries.current.has(key)) return
    cardRetries.current.add(key)
    const stillActive = () => activeAccount.current === account
    try {
      if (!stillActive() || await verifiedAccountId(client) !== account || !stillActive()) return
      if (kinds.includes('lists')) await storage.listSyncLedger.retryDirect(account, listId, stillActive)
      if (!stillActive()) return
      if (kinds.includes('items')) {
        if (await storage.readAccountFeedPosition(account) !== undefined) {
          await flushAccountBatch(storage, client, account, stillActive, () => setWorkspaceRevision(value => value + 1), listId)
        } else {
          const remoteListId = cloudBindings[listId]
          if (remoteListId) await createAccountSync(storage, client, { accountId: account, localListId: listId, remoteListId, isActive: stillActive }).flush()
        }
      }
      if (stillActive() && kinds.includes('items') && !(await storage.readAccountPending(account)).length) {
        setSyncError('')
        setPushState({ account, status: 'done' })
      }
      if (stillActive() && kinds.includes('lists')) await processListOperations(account, listId)
      // v2 has a single account cursor. The safe retry of a feed read is
      // the existing shared feed, never a new per-card background request.
      if (stillActive() && kinds.includes('feed')) {
        const started = Date.now()
        await requestCloudRefresh.current?.()
        if (stillActive() && lastCloudCheck.current?.accountId === account && lastCloudCheck.current.at >= started)
          storage.listSyncLedger.clearFeedErrors(account, listId)
      }
    } catch {
      // Operation-level error remains in the ledger and durable queue.
      if (stillActive()) setSyncError('Не удалось отправить изменения. Повторите синхронизацию.')
    } finally {
      cardRetries.current.delete(key)
      if (stillActive()) { storage.listSyncLedger.changed(); setWorkspaceRevision(value => value + 1) }
    }
  }
  return <>
    {localCopyRemovalError && <p role="alert">{localCopyRemovalError}
      <button type="button" onClick={() => setLocalCopyRemovalError('')}>Закрыть сообщение</button>
    </p>}
    {deletionApi && deleteDialogAccount === currentAccount && currentAccount && <AccountDeletionDialog
      api={deletionApi} email={verifiedEmail} account={currentAccount}
      checkDeleted={async account => await deletionApi.status(account, await storage.readInstallationIdentity()) === 'deleted'}
      onClose={() => setDeleteDialogAccount(null)}
      onDeleted={account => {
        activeAccount.current = null
        setDeleteDialogAccount(null)
        setDeletionNotice(true)
        void deletion.remove(account)
      }} />}
    {(deletionNotice || accountWasDeleted || deletion.activeRemoved) && <p role="status">Облачный аккаунт удалён.
      <button type="button" onClick={() => { setAccountDialogOpen(true); setDeletionNotice(false); deletion.clearActiveRemoved() }}>Выбрать другой профиль</button>
    </p>}
    {deletion.cleanupError && <p role="alert">Очистка устройства прервана.
      <button type="button" onClick={() => void deletion.sweep().catch(() => {})}>Повторить</button>
    </p>}
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
    <App key={workspaceAccount ?? 'local:' + deletion.revision} storage={storage} accountId={workspaceAccount} cloudOffline={!!offlineAccount} onQueued={workspaceAccount ? onQueued : undefined} refreshRevision={workspaceRevision}
      onRetryListSync={currentAccount && readyAccount === currentAccount ? (id, kinds) => void retryListSync(id, kinds) : undefined}
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
        onSelectLocal: enterLocalWorkspace, onOpenLinked: openLinkedWorkspace, sessionAccount, removeAuthorizedLocalCopy,
        hiddenAccountIds: deletion.deleted,
        checkLocalProfile: deletionApi ? async account => {
          const removed = await checkDeletedAccount(account)
          if (removed) setDeletionNotice(true)
          return removed
        } : undefined,
        content: profile => <>
        {workspaceAccount ? (view.status === 'account' ? <>
          {(syncFailed || listSyncFailed) && <button type="button" onClick={retrySync}>Повторить синхронизацию</button>}
          <div className="account-exit-actions">
            <button type="button" disabled={busy} onClick={() => void signOut()}>Выйти</button>
            {deletionApi && currentAccount && <button type="button" className="danger" disabled={busy || !syncOnline}
              onClick={() => setDeleteDialogAccount(currentAccount)}>Удалить аккаунт</button>}
          </div>
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
            {error && <><p className="profile-login-error" id="auth-login-error" role="alert">{error}</p>
              <button type="button" onClick={copyAuthDiagnostics}>Скопировать диагностику входа</button>
              {authDiagnosticsCopied && <p role="status">Диагностика скопирована без личных данных.</p>}</>}
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
      <p role="alert">{ownRecovery === 'error' ? 'Не удалось проверить подключение к аккаунту. Повторите синхронизацию.'
        : syncError || cloudRefreshStatus || cloudArchiveError || 'Не удалось синхронизировать данные.'}</p>
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
