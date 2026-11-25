import { ListMergeDialog } from './ListMergeDialog'
import type { ListMergeActions } from './domain/list-merge'
import { PurchaseHistory } from './PurchaseHistory'
import { ListActionNotice, type ListActionMessage } from './ListActionNotice'
import { duplicatedItems, itemNameKey, type ItemNameDecision } from './domain/item-names'
import { ItemNameConflictDialog } from './ItemNameConflictDialog'
import type { ItemDeletionConflict } from './data/item-conflict'
import { defaultListSymbol, ListSymbolPicker } from './ListSymbolPicker'
import { ListIndicators, listKindLabels, type ListKind, type CloudStatus } from './ListIndicators'
import { version } from '../package.json'
import { ListHeading } from './ListHeading'
import { WorkspaceDialog } from './WorkspaceDialog'
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef, type FormEvent, type ReactNode, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { placeList, orderLists, orderArchives } from './domain/ordering'
import { lists, itemsForList, sortShoppingItems, type ItemSort, type ListId } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { AccountDraftList, ArchivedListRecord, ShoppingListRecord, Storage } from './data/storage'
import { itemStoreForAccount } from './data/account-item-store'
import { cloudAwareItemStore } from './data/cloud-aware-item-store'
import type { CloudArchiveCompletion } from './data/cloud-archive'
import type { CompletionMode } from './data/cloud-completion-rpc'
import { profileItemStore } from './data/profile-item-store'
import { MAX_LOCAL_PROFILES, defaultArchiveRecipient, profileName, sortProfiles } from './data/local-profiles'
import { DeleteProfileButton, ProfileBadge, ProfileMenu, ProfileTransferPreference, type ProfileSyncState } from './ProfileMenu'
import type { LocalProfile, LocalProfileRegistry } from './data/local-profiles'
export interface ListOperationStatus {
  accountId: string
  localListId: string
  name: string
  fromLocalCopy?: boolean
  mode: CompletionMode
  phase: 'queued' | 'running' | 'error'
  message?: string
  retry?: () => void
  dismiss?: () => void | Promise<void>
}

type ResolveItemDeletion = (conflict: ItemDeletionConflict, keepItem: boolean) => Promise<void>
export function App({ storage, accountId = null, cloudOffline = false, onQueued, refreshRevision = 0, headerActions, accountMenu, onCompleteCloudList, cloudBoundLists = {}, listOperations = [], completionNotice, completionError, accountCloudLists = [], onCreateCloudList, onChangeCloudList, cloudListBusy = false, cloudListError, cloudArchive, cloudArchiveCount, onOpenCloudArchive, onResolveItemDeletion, onResolveItemName, cloudMerge }: { storage: Storage; accountId?: string | null; cloudOffline?: boolean; onQueued?: () => void; refreshRevision?: number; headerActions?: ReactNode; accountMenu?: { open: boolean; setOpen: (open: boolean) => void; content: (profile: LocalProfile | undefined) => ReactNode; busy: boolean; name?: string; syncState?: ProfileSyncState; onSelectLocal: () => void; onOpenLinked: (profile: LocalProfile, previousProfileId?: string) => void; sessionAccount?: string | null; removeAuthorizedLocalCopy?: (profileId: string, accountId: string) => Promise<void>; checkLocalProfile?: (account: string) => Promise<boolean>; hiddenAccountIds?: ReadonlySet<string> }; onCompleteCloudList?: (listId: ListId, mode: CompletionMode, confirmedMarked?: boolean, confirmedItemIds?: readonly string[]) => void; cloudBoundLists?: Record<string, string>; listOperations?: ListOperationStatus[]; completionNotice?: ListActionMessage; completionError?: string; onCreateCloudList?: (name: string, kind: 'permanent' | 'oneoff', symbol: string) => Promise<ListId | undefined>; onChangeCloudList?: (id: string, action: 'rename' | 'kind' | 'reorder', value: string) => Promise<boolean>; cloudListBusy?: boolean; cloudListError?: string; cloudArchive?: ReactNode; cloudArchiveCount?: number; onOpenCloudArchive?: () => void; cloudMerge?: ListMergeActions; onResolveItemDeletion?: ResolveItemDeletion; onResolveItemName?: (decision: ItemNameDecision) => Promise<void>; accountCloudLists?: { id: string; name: string; kind: 'permanent' | 'oneoff' }[] }) {
  // Never mount a legacy guest workspace before resolving the durable cutover
  // marker. Otherwise a stale guest view could attempt writes after cutover.
  const [guestProfile, setGuestProfile] = useState<string | null | undefined>(undefined)
  const [startupError, setStartupError] = useState('')
  const [upgradeBlocked, setUpgradeBlocked] = useState(false)
  const [registry, setRegistry] = useState<LocalProfileRegistry | null>(null)
  const [localSyncRevision, setLocalSyncRevision] = useState(0)
  const [savedAccount, setSavedAccount] = useState<{
    profileId: string; id: string; bindings: Record<string, string>; archive: CloudArchiveCompletion[] | null;
    completions: Awaited<ReturnType<Storage['readLocalCompletionView']>>
    lists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[]
  } | null>(null)
  const localProfile = accountId === null ? registry?.profiles.find(row => row.id === guestProfile)
    : cloudOffline ? registry?.profiles.find(row => row.cloudAccountId === accountId) : undefined
  const localProfileId = localProfile?.id
  const localProfileAccount = localProfile?.cloudAccountId
  useEffect(() => {
    const profileId = localProfileId
    const id = localProfileAccount
    if (!id || !profileId) { setSavedAccount(null); return }
    let cancelled = false
    void Promise.all([storage.readLocalListMappings(id), storage.readLocalCompletionView(id)]).then(([mappings, completion]) => {
      if (cancelled) return
      const bindings = Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId]))
      const lists = mappings.filter(row => row.metadata).sort((a, b) => a.metadata!.position - b.metadata!.position)
        .map(row => ({ id: row.localListId, name: row.metadata!.name, kind: row.metadata!.kind }))
      setSavedAccount({ profileId, id, bindings, lists, archive: completion.snapshots, completions: completion })
    }).catch(() => { if (!cancelled) setStartupError('Не удалось открыть локальный профиль аккаунта.') })
    return () => { cancelled = true }
  }, [storage, localProfileId, localProfileAccount, localSyncRevision])
  const localAccount = savedAccount?.profileId === localProfileId ? savedAccount : null
  const [queuedMerges, setQueuedMerges] = useState<{ account: string; rows: Awaited<ReturnType<Storage['readQueuedListMerges']>> }>()
  const mergeAccount = localAccount?.id ?? accountId
  useEffect(() => {
    if (!mergeAccount) return
    let current = true
    void storage.readQueuedListMerges(mergeAccount).then(rows => {
      if (current) setQueuedMerges({ account: mergeAccount, rows })
    }).catch(() => { if (current) setStartupError('Не удалось прочитать очередь объединений.') })
    return () => { current = false }
  }, [storage, mergeAccount, localSyncRevision, refreshRevision])
  const [profileActionError, setProfileActionError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileDeletion, setProfileDeletion] = useState<{
    id: string; name: string; archiveCount: number; hasMarked: boolean
  } | null>(null)
  const [archiveTarget, setArchiveTarget] = useState('')
  const [keepArchive, setKeepArchive] = useState(false)
  const [profileRename, setProfileRename] = useState<string | null>(null)
  const [localMenuOpen, setLocalMenuOpen] = useState(false)
  const menuOpen = accountMenu?.open ?? localMenuOpen
  const setMenuOpen = accountMenu?.setOpen ?? setLocalMenuOpen
  const [showAllProfiles, setShowAllProfiles] = useState(false)
  const [menuError, setMenuError] = useState('')
  const [reservedSources, setReservedSources] = useState<string[]>([])
  useEffect(() => {
    if (!menuOpen) setShowAllProfiles(false)
    if (!menuOpen && accountId === null) return
    let current = true
    void Promise.all([storage.readLocalProfiles(), storage.readReservedProfileSources()]).then(([next, reserved]) => {
      if (current) { setRegistry(next); setReservedSources(reserved) }
    }).catch(() => { if (current) setMenuError('Не удалось обновить список профилей.') })
    return () => { current = false }
  }, [storage, menuOpen, accountId])

  useEffect(() => {
    if (accountId !== null) return
    let cancelled = false
    setGuestProfile(undefined)
    setUpgradeBlocked(false)
    const unsubscribe = storage.subscribeUpgradeBlocked(() => {
      if (!cancelled) setUpgradeBlocked(true)
    })
    void (async () => {
      // IndexedDB v10 upgrades only after older open connections have closed.
      // Never activate cutover while an older build can still write legacy data.
      const existing = await storage.readGuestCutoverOwner()
      if (!existing) {
        await storage.migrateLegacyGuestToProfile()
        await storage.markGuestCutoverReady()
      }
      return Promise.all([storage.readGuestCutoverOwner(), storage.readLocalProfiles()])
    })().then(([id, profiles]) => {
      if (cancelled) return
      if (id && (!profiles || !profiles.profiles.some(p => p.id === id))) throw new Error('Cutover profile missing')
      setRegistry(profiles)
      const active = profiles?.profiles.find(p => p.id === profiles.activeProfileId)
      setGuestProfile(id ? (active?.id ?? id) : null)
    }).catch(() => {
      if (!cancelled) setStartupError('Не удалось определить хранилище покупок. Изменения заблокированы.')
    })
    return () => { cancelled = true; unsubscribe() }
  }, [storage, accountId])
  async function createGuestProfile() {
    if (profileBusy || accountMenu?.busy || !registry || cloudOffline ||
        (accountId === null && !guestProfile)) return
    setProfileBusy(true)
    try {
      const next = await storage.createLocalProfile(crypto.randomUUID(), Date.now())
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
      closeMenu()
      const created = next.profiles.find(row => row.id === next.activeProfileId)
      if (created) setProfileRename(profileName(created, next.profiles.indexOf(created)))
      setStartupError('')
    } catch (error) { setProfileActionError(error instanceof Error ? error.message : 'Не удалось создать локальный профиль.') }
    finally { setProfileBusy(false) }
  }
  function closeProfileName() {
    setProfileRename(null)
    if (accountId !== null) accountMenu?.onSelectLocal()
  }
  async function selectGuestProfile(row: LocalProfile) {
    if (profileBusy || accountMenu?.busy || !registry) return
    if (row.cloudAccountId && accountMenu?.checkLocalProfile) {
      setProfileBusy(true)
      try {
        if (await accountMenu.checkLocalProfile(row.cloudAccountId)) return
      } catch {
        setProfileActionError('Не удалось проверить профиль. Повторите открытие.')
        return
      } finally { setProfileBusy(false) }
    }
    if (row.cloudAccountId && row.cloudAccountId === accountMenu?.sessionAccount) {
      accountMenu.onOpenLinked(row, guestProfile ?? undefined)
      return
    }
    setProfileBusy(true)
    try {
      const next = await storage.switchLocalProfile(row.id)
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
      closeMenu()
      if (row.cloudAccountId && accountMenu) accountMenu.onOpenLinked(row)
      else accountMenu?.onSelectLocal()
    } catch { setProfileActionError('Не удалось переключить локальный профиль.') }
    finally { setProfileBusy(false) }
  }
  const localChangesQueued = useCallback(() => setLocalSyncRevision(revision => revision + 1), [])
  function closeProfileDeletion() {
    setProfileDeletion(null)
    setArchiveTarget('')
    setKeepArchive(false)
    setProfileActionError('')
  }
  async function confirmProfileDeletion(id: string, choice?: Parameters<Storage['deleteLocalProfile']>[2]) {
    setProfileActionError('')
    setProfileBusy(true)
    try {
      const next = await storage.deleteLocalProfile(id, id, choice)
      setRegistry(next)
      if (accountId === null) setGuestProfile(next.activeProfileId)
      localChangesQueued()
      // An archive destined for the open cloud workspace uses the existing
      // durable archive-only queue immediately; other recipients wait for their login.
      if (choice?.target && choice.target !== 'new' && accountId && choice.target.accountId === accountId) onQueued?.()
      closeProfileDeletion()
      if (accountId === null && id === guestProfile) closeMenu()
    } catch (error) {
      setProfileActionError(error instanceof Error && error.message.includes('unsynced operations')
        ? 'Есть неотправленные изменения. Войдите в этот аккаунт и дождитесь синхронизации перед удалением.'
        : error instanceof Error && error.message.includes('changed')
          ? 'Данные изменились. Отмените удаление и откройте диалог снова.'
          : 'Не удалось удалить профиль. Данные сохранены.')
    } finally { setProfileBusy(false) }
  }
  async function removeGuestProfile(id: string, name: string, linked: boolean) {
    if (profileBusy || accountMenu?.busy || !registry || (accountId === null && !guestProfile)) return
    const source = registry.profiles.find(row => row.id === id)
    if (!source || !!source.cloudAccountId !== linked) return
    setProfileActionError('')
    if (source.cloudAccountId) {
      const authorized = source.cloudAccountId === accountId || source.cloudAccountId === accountMenu?.sessionAccount
      if (authorized && !accountMenu?.removeAuthorizedLocalCopy) return
      const message = `Удалить локальную копию «${name}» с устройства? ` +
        (authorized ? 'Сначала будет выполнен выход из аккаунта. ' : '') + 'Данные в облаке сохранятся.'
      if (!window.confirm(message)) return
      if (authorized) await accountMenu!.removeAuthorizedLocalCopy!(id, source.cloudAccountId)
      else await confirmProfileDeletion(id)
      return
    }
    setProfileBusy(true)
    try {
      const { registry: latest, archiveCount, hasMarked } = await storage.readLocalProfileDeletion(id)
      setRegistry(latest)
      const targets = latest.profiles.filter(row => row.id !== id && !reservedSources.includes(row.id) &&
        !(row.cloudAccountId && accountMenu?.hiddenAccountIds?.has(row.cloudAccountId)))
      setArchiveTarget(defaultArchiveRecipient(targets, latest.activeProfileId, accountId)?.id ?? '')
      setKeepArchive(false)
      setProfileDeletion({ id, name, archiveCount, hasMarked })
    } catch {
      setProfileActionError('Не удалось проверить данные профиля.')
    } finally { setProfileBusy(false) }
  }
  async function changeSavedAccountList(id: string, action: 'rename' | 'kind' | 'reorder', value: string) {
    if (!localAccount) return false
    await storage.queueLocalListChange(localAccount.id, id, action, value)
    localChangesQueued()
    return true
  }
  const [pendingProfiles, setPendingProfiles] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    if (!registry) return
    let cancelled = false
    const linked = registry.profiles.filter(row => row.cloudAccountId)
    void Promise.all(linked.map(async row => {
      const pending = await storage.hasAccountSyncWork(row.cloudAccountId!)
      return pending ? row.id : null
    })).then(rows => {
      if (!cancelled) setPendingProfiles(new Set(rows.filter(id => id !== null)))
    }).catch(() => { if (!cancelled) setMenuError('Не удалось проверить состояние синхронизации профилей.') })
    return () => { cancelled = true }
  }, [registry, accountId, accountMenu?.sessionAccount, storage, refreshRevision, menuOpen, localSyncRevision])
  if (accountId === null && startupError) return <main><p role="alert">{startupError}</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined && upgradeBlocked) return <main><p role="alert">Другая открытая вкладка использует старую версию покупок и не даёт безопасно обновить хранилище. Закройте другие вкладки приложения, затем повторите открытие. Ваши покупки не удалены.</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined) return <main><p role="status">Открываем сохранённые покупки…</p></main>
  const profile = registry?.profiles.find(row => row.id === guestProfile)
  const name = accountId ? (accountMenu?.name || registry?.profiles.find(p => p.cloudAccountId === accountId)?.login || 'Аккаунт') :
    profile ? profileName(profile, registry!.profiles.indexOf(profile)) : 'Мои покупки'
  const hiddenProfile = (row: LocalProfile) => !!row.cloudAccountId && !!accountMenu?.hiddenAccountIds?.has(row.cloudAccountId)
  if (profile && hiddenProfile(profile)) return <main><p role="status">Убираем данные удалённого аккаунта с устройства…</p></main>
  const mode = accountId ? (cloudOffline ? 'offline' : 'cloud') : profile?.cloudAccountId ? 'linked' : 'local'
  const otherProfiles = sortProfiles(registry?.profiles ?? []).filter(row => (accountId !== null ? row.cloudAccountId !== accountId
    : row.id !== guestProfile || (!!row.cloudAccountId && !!accountMenu?.sessionAccount)) && !reservedSources.includes(row.id) && !hiddenProfile(row))
  const actionsBusy = profileBusy || accountMenu?.busy
  function closeMenu() {
    setMenuOpen(false)
    setMenuError('')
    setProfileActionError('')
  }
  const displayedProfile = accountId ? registry?.profiles.find(row => row.cloudAccountId === accountId) : profile
  const canDeleteProfile = (row: LocalProfile) => !row.cloudAccountId ||
    (row.cloudAccountId !== accountId && row.cloudAccountId !== accountMenu?.sessionAccount) ||
    !!accountMenu?.removeAuthorizedLocalCopy
  const deleteProfileButton = (id: string, label: string, linked: boolean) =>
    <DeleteProfileButton name={label} disabled={actionsBusy || pendingProfiles.has(id)}
      onDelete={() => void removeGuestProfile(id, label, linked)} />
  const profileMenu = <ProfileMenu name={name} mode={mode} open={menuOpen}
    syncState={accountMenu?.syncState ?? (profile && pendingProfiles.has(profile.id) ? 'waiting' : mode === 'offline' ? 'offline' : 'local')}
    onToggle={() => menuOpen ? closeMenu() : setMenuOpen(true)} onClose={closeMenu}
    deleteCurrent={displayedProfile && canDeleteProfile(displayedProfile) ? deleteProfileButton(displayedProfile.id, name, !!displayedProfile.cloudAccountId) : undefined}
    onRename={mode === 'local' && profile && !actionsBusy ? () => {
      setProfileActionError('')
      setProfileRename(name)
    } : undefined}>
    {displayedProfile && pendingProfiles.has(displayedProfile.id) &&
      <p className="profile-delete-hint">Для удаления копии сначала синхронизируйте изменения.</p>}
    {accountMenu?.content(profile)}
    {accountMenu && accountId === null && profile && !profile.cloudAccountId &&
      <ProfileTransferPreference checked={!!profile.skipTransferPrompt} disabled={actionsBusy}
        onChange={skipped => {
          const displayPreference = (value: boolean) => setRegistry(current => current && ({
            ...current,
            profiles: current.profiles.map(row => row.id === profile.id ? { ...row, skipTransferPrompt: value } : row),
          }))
          displayPreference(skipped)
          setProfileBusy(true)
          setProfileActionError('')
          void storage.setProfileTransferPromptSkipped(profile.id, skipped).then(setRegistry).catch(() => {
            displayPreference(!!profile.skipTransferPrompt)
            setProfileActionError('Не удалось сохранить настройку синхронизации.')
          }).finally(() => setProfileBusy(false))
        }}>Не спрашивать о синхронизации этого профиля</ProfileTransferPreference>}
    {registry && (guestProfile || accountId !== null) && <div className="profile-switcher" role="group" aria-label="Локальные профили">
      {otherProfiles.length > 0 && <div className="profile-options" tabIndex={showAllProfiles ? 0 : undefined}>
        {(showAllProfiles ? otherProfiles : otherProfiles.slice(0, 2)).map(row => {
          const label = profileName(row, registry.profiles.indexOf(row))
          return <div className="profile-option" key={row.id}>
            <button type="button" disabled={actionsBusy} onClick={() => { setProfileActionError(''); void selectGuestProfile(row) }}>
              <ProfileBadge mode={row.cloudAccountId ? 'linked' : 'local'} compact={!!row.cloudAccountId} />
              <span>{label}</span>
            </button>
            {canDeleteProfile(row) && deleteProfileButton(row.id, label, !!row.cloudAccountId)}
            {canDeleteProfile(row) && pendingProfiles.has(row.id) && <p>Для удаления копии сначала синхронизируйте изменения.</p>}
          </div>
        })}
      </div>}
      {otherProfiles.length > 2 && <button type="button" aria-expanded={showAllProfiles}
        onClick={() => setShowAllProfiles(value => !value)}>{showAllProfiles ? 'Свернуть' : 'Ещё'}</button>}
      {!cloudOffline && <>
        <button type="button" disabled={actionsBusy || registry.profiles.length >= MAX_LOCAL_PROFILES}
          onClick={() => { setProfileActionError(''); void createGuestProfile() }}>Добавить профиль</button>
        {registry.profiles.length >= MAX_LOCAL_PROFILES && <p>Достигнут лимит в {MAX_LOCAL_PROFILES} профилей на устройстве.</p>}
      </>}
    </div>}
    {menuError && <p role="alert">{menuError}</p>}
    {profileRename === null && !profileDeletion && profileActionError && <p role="alert">{profileActionError}</p>}
  </ProfileMenu>
  const renameDialog = <>
    {profileRename !== null && guestProfile && <WorkspaceDialog label="Имя локального профиля" className="e4-editor profile-name-dialog"
      onDismiss={() => { if (!profileBusy) closeProfileName() }}>
      <form onSubmit={event => { event.preventDefault(); setProfileBusy(true); void storage.renameLocalProfile(guestProfile, profileRename).then(next => { setRegistry(next); closeProfileName(); setProfileActionError('') }).catch(error => setProfileActionError(error instanceof Error ? error.message : 'Не удалось изменить имя.')).finally(() => setProfileBusy(false)) }}>
        <h2>Имя локального профиля</h2>
        <label htmlFor="profile-name">Имя профиля</label>
        <div className="rename-input">
          <input id="profile-name" autoFocus maxLength={120} value={profileRename} disabled={profileBusy}
            onChange={event => setProfileRename(event.target.value)} />
          <button type="button" aria-label="Очистить имя профиля" disabled={profileBusy || !profileRename}
            onClick={event => {
              setProfileRename('')
              event.currentTarget.form?.querySelector('input')?.focus()
            }}>🧹</button>
        </div>
        {profileActionError && <p role="alert">{profileActionError}</p>}
        <div className="dialog-buttons">
          <button type="button" disabled={profileBusy} onClick={closeProfileName}>Отмена</button>
          <button type="submit" disabled={profileBusy || !profileRename.trim()}>Сохранить имя</button>
        </div>
      </form>
    </WorkspaceDialog>}
  </>
  const archiveTargets = profileDeletion
    ? (registry?.profiles ?? []).filter(row => row.id !== profileDeletion.id && !reservedSources.includes(row.id) && !hiddenProfile(row))
    : []
  const selectedTarget = archiveTargets.find(row => row.id === archiveTarget)
  return <>
    {renameDialog}
    {profileDeletion && <WorkspaceDialog label="Удаление профиля" className="e4-editor profile-delete-dialog"
      onDismiss={() => { if (!profileBusy) closeProfileDeletion() }}>
      <h2>Удалить профиль «{profileDeletion.name}»?</h2>
      <p>Все списки и товары этого профиля будут удалены с устройства. Если хотите сохранить списки, отмените удаление и сначала синхронизируйте профиль.</p>
      {profileDeletion.hasMarked && <p>В списках есть отмеченные покупки. Чтобы сохранить их в истории, отмените удаление и сначала завершите отмеченные покупки.</p>}
      {profileDeletion.archiveCount > 0 && <>
        <ProfileTransferPreference checked={!keepArchive} disabled={profileBusy}
          onChange={() => setKeepArchive(false)}>Удалить архив</ProfileTransferPreference>
        <ProfileTransferPreference checked={keepArchive} disabled={profileBusy || !archiveTargets.length}
          onChange={() => {
            setKeepArchive(true)
            if (!selectedTarget && registry)
              setArchiveTarget(defaultArchiveRecipient(archiveTargets, registry.activeProfileId, accountId)?.id ?? '')
          }}>Сохранить архив</ProfileTransferPreference>
        {keepArchive && <>
          <label htmlFor="purchase-archive-target">Куда перенести архив покупок</label>
          <select id="purchase-archive-target" value={archiveTarget} disabled={profileBusy}
            onChange={event => setArchiveTarget(event.target.value)}>
            <option value="" disabled>Выберите профиль</option>
            {archiveTargets.map(row => <option key={row.id} value={row.id}>
              {profileName(row, registry!.profiles.indexOf(row))}{row.cloudAccountId ? ' (локальная копия облака)' : ''}
            </option>)}
          </select>
          {selectedTarget?.cloudAccountId && <p>История появится в локальной копии сразу и попадёт в облако при синхронизации этого профиля.</p>}
        </>}
      </>}
      {profileActionError && <p role="alert">{profileActionError}</p>}
      <div className="dialog-buttons profile-delete-actions">
        <button type="button" autoFocus disabled={profileBusy} onClick={closeProfileDeletion}>Отмена</button>
        <button type="button" className="danger" disabled={profileBusy || (keepArchive && !selectedTarget)}
          onClick={() => {
            if (keepArchive && !selectedTarget) return
            void confirmProfileDeletion(profileDeletion.id, {
              archiveCount: profileDeletion.archiveCount, hasMarked: profileDeletion.hasMarked,
              ...(keepArchive && selectedTarget ? { target: { id: selectedTarget.id, accountId: selectedTarget.cloudAccountId } } : {}),
            })
          }}>Удалить профиль</button>
      </div>
    </WorkspaceDialog>}
    {(!registry?.profiles.find(row => row.id === guestProfile)?.cloudAccountId || accountId !== null || localAccount) && <ShoppingWorkspace key={accountId ?? guestProfile ?? 'legacy-guest'} storage={storage} accountId={accountId ?? localAccount?.id ?? null} cloudStatus={
      accountId !== null ? (cloudOffline ? 'paused' : 'connected') : localAccount ? 'signed-out' : undefined
    } queuedMerges={queuedMerges?.account === mergeAccount ? queuedMerges?.rows : undefined} localCompletions={localAccount?.completions.operations} onCompleteCloudList={onCompleteCloudList} cloudMerge={cloudMerge} cloudBoundLists={localAccount?.bindings ?? cloudBoundLists} listOperations={listOperations} completionNotice={completionNotice} completionError={completionError} accountCloudLists={localAccount?.lists ?? accountCloudLists} onCreateCloudList={onCreateCloudList} onResolveItemDeletion={onResolveItemDeletion} onResolveItemName={onResolveItemName} onChangeCloudList={localAccount ? changeSavedAccountList : onChangeCloudList} cloudListBusy={cloudListBusy} cloudListError={cloudListError} guestProfileId={accountId === null ? (guestProfile ?? null) : null} onQueued={localAccount ? localChangesQueued : onQueued} refreshRevision={refreshRevision + localSyncRevision} headerActions={<>{headerActions}{profileMenu}</>} onOpenProfileMenu={() => setMenuOpen(true)} cloudArchive={localAccount ? <PurchaseHistory snapshots={localAccount.archive} actions={snapshot => {
      const request = snapshot.pending && localAccount.completions.unsent.find(row => row.operationId === snapshot.id)
      return request ? <button type="button" onClick={() => {
        void storage.cancelUnsentAccountCompletion(request).then(localChangesQueued)
          .catch(() => setProfileActionError('Не удалось отменить операцию со списком.'))
      }}>Отменить операцию</button> : null
    }}>
      {localAccount.archive === null && <p>Архив ещё не сохранён на этом устройстве. Войдите в аккаунт, чтобы загрузить его.</p>}
    </PurchaseHistory> : cloudArchive} cloudArchiveCount={localAccount ? localAccount.archive?.length : cloudArchiveCount} onOpenCloudArchive={localAccount ? undefined : onOpenCloudArchive} />}
  </>
}

function ShoppingWorkspace({ storage, accountId, cloudStatus, guestProfileId, onQueued, refreshRevision, headerActions, onCompleteCloudList, cloudBoundLists, listOperations, completionNotice, completionError, accountCloudLists, onCreateCloudList, onChangeCloudList, cloudListBusy, cloudListError, onOpenProfileMenu, cloudArchive, cloudArchiveCount, onOpenCloudArchive, onResolveItemDeletion, onResolveItemName, cloudMerge, localCompletions, queuedMerges = [] }: { queuedMerges?: Awaited<ReturnType<Storage['readQueuedListMerges']>>; localCompletions?: Awaited<ReturnType<Storage['readLocalCompletionView']>>['operations']; storage: Storage; accountId: string | null; cloudStatus?: CloudStatus; guestProfileId: string | null; onQueued?: () => void; refreshRevision: number; headerActions?: ReactNode; onCompleteCloudList?: (listId: ListId, mode: CompletionMode, confirmedMarked?: boolean, confirmedItemIds?: readonly string[]) => void; cloudBoundLists: Record<string, string>; listOperations: ListOperationStatus[]; completionNotice?: ListActionMessage; completionError?: string; onCreateCloudList?: (name: string, kind: 'permanent' | 'oneoff', symbol: string) => Promise<ListId | undefined>; onChangeCloudList?: (id: string, action: 'rename' | 'kind' | 'reorder', value: string) => Promise<boolean>; cloudListBusy?: boolean; cloudListError?: string; onOpenProfileMenu: () => void; cloudArchive?: ReactNode; cloudArchiveCount?: number; onOpenCloudArchive?: () => void; cloudMerge?: ListMergeActions; onResolveItemDeletion?: ResolveItemDeletion; onResolveItemName?: (decision: ItemNameDecision) => Promise<void>; accountCloudLists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[] }) {
  const workspaceKey = 'shopping-workspace:' + (accountId ?? guestProfileId ?? 'guest')
  const cardSizeKey = workspaceKey + ':card-size'
  const [cardSize, setCardSize] = useState<'large' | 'standard'>(() => {
    try { return (localStorage.getItem(cardSizeKey) ?? localStorage.getItem('shopping-card-size')) === 'standard' ? 'standard' : 'large' } catch { return 'large' }
  })
  const [contentSize, setContentSize] = useState<'large' | 'standard'>(() => {
    try { return localStorage.getItem('shopping-content-size') === 'standard' ? 'standard' : 'large' } catch { return 'large' }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsKeyboardFocus, setSettingsKeyboardFocus] = useState(false)
  const [draftCardSize, setDraftCardSize] = useState(cardSize)
  const [draftContentSize, setDraftContentSize] = useState(contentSize)
  function openSettings(fromKeyboard: boolean) {
    setSettingsKeyboardFocus(fromKeyboard)
    setDraftCardSize(cardSize)
    setDraftContentSize(contentSize)
    setSettingsOpen(true)
  }
  function chooseCardSize(value: 'large' | 'standard') {
    setCardSize(value)
    try { localStorage.setItem(cardSizeKey, value) } catch { /* storage disabled */ }
  }
  function chooseContentSize(value: 'large' | 'standard') {
    setContentSize(value)
    try { localStorage.setItem('shopping-content-size', value) } catch { /* storage disabled */ }
  }
  const [active, setActive] = useState<ListId>(() => { try { return localStorage.getItem(workspaceKey + ':list') ?? 'groceries' } catch { return 'groceries' } })
  const [localLists, setLocalLists] = useState<ShoppingListRecord[] | null>(null)
  const [localNotice, setLocalNotice] = useState<ListActionMessage>()
  const notice = accountId === null ? localNotice : completionNotice
  const [listError, setListError] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [newListSymbol, setNewListSymbol] = useState(defaultListSymbol)
  const [editListSymbol, setEditListSymbol] = useState(defaultListSymbol)
  const [symbolOnly, setSymbolOnly] = useState(false)
  const [savingList, setSavingList] = useState(false)
  const [accountSymbols, setAccountSymbols] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    void storage.readAccountListMappings(accountId).then(rows => {
      if (!cancelled) setAccountSymbols(Object.fromEntries(rows
        .filter(row => row.symbol)
        .map(row => [row.localListId, row.symbol!])))
    }).catch(() => { if (!cancelled) setListError('Не удалось загрузить пиктограммы списков.') })
    return () => { cancelled = true }
  }, [storage, accountId, cloudBoundLists])
  const [creatingList, setCreatingList] = useState(false)
  const [newListDialog, setNewListDialog] = useState(false)
  const [newListKind, setNewListKind] = useState<'permanent' | 'oneoff'>('permanent')
  const [changingList, setChangingList] = useState(false)
  const [archives, setArchives] = useState<ArchivedListRecord[]>([])
  const [showArchive, setShowArchive] = useState(() => { try { return accountId !== null && localStorage.getItem(workspaceKey + ':archive') === 'true' } catch { return false } })
  useEffect(() => {
    try { localStorage.setItem(workspaceKey + ':list', active); localStorage.setItem(workspaceKey + ':archive', String(showArchive)) }
    catch { /* persistence unavailable */ }
  }, [workspaceKey, active, showArchive])
  useEffect(() => {
    if (showArchive && cloudArchiveCount === undefined) onOpenCloudArchive?.()
  // Restore once when this account workspace mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [menuTarget, setMenuTarget] = useState<{ id: ListId; source: 'card' | 'heading' | 'completion' } | null>(null)
  const [menuPosition, setMenuPosition] = useState({top:0,left:0})
  const [renaming, setRenaming] = useState<ListId | null>(null)
  const [typeSaving, setTypeSaving] = useState(false)
  const [renameName, setRenameName] = useState('')
  const listRail = useRef<HTMLElement>(null)
  const [revealCard, setRevealCard] = useState<{ id: ListId; previousLeft?: number } | null>(null)
  const movingCard = useRef(false)
  useLayoutEffect(() => {
    const rail = listRail.current
    if (!revealCard || !rail) return
    const tile = Array.from(rail.querySelectorAll<HTMLElement>('[data-list-id]'))
      .find(element => element.dataset.listId === revealCard.id)
    if (!tile) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const left = tile.getBoundingClientRect().left
    const delta = revealCard.previousLeft === undefined ? 0 : revealCard.previousLeft - left
    if (delta && !reducedMotion) tile.animate([{ transform: `translateX(${delta}px)` }, { transform: 'none' }], {
      duration: 200, easing: 'ease-out',
    })
    rail.scrollTo({
      left: rail.scrollLeft + left - rail.getBoundingClientRect().left - rail.clientLeft,
      behavior: reducedMotion ? 'instant' : 'smooth',
    })
    setRevealCard(null)
  }, [revealCard, cardSize, localLists, accountCloudLists])
  const swipe = useRef<{x:number,y:number}|null>(null)
  useEffect(() => {
    if (accountId !== null) return
    let cancelled = false
    void Promise.all([guestProfileId ? storage.readProfileLists(guestProfileId) : storage.readLists(), guestProfileId ? storage.readProfileArchives(guestProfileId) : storage.readArchives()]).then(([rows, snapshots]) => {
      if (!cancelled) {
        setLocalLists(orderLists(rows))
        setArchives(orderArchives(snapshots))
      }
    }).catch(error => {
      if (!cancelled) setListError(error instanceof Error ? error.message : 'Не удалось загрузить списки')
    })
    return () => { cancelled = true }
  }, [storage, accountId, guestProfileId, refreshRevision])
  async function updateLocalList(action: 'rename' | 'kind', listId: string, value: string | null, symbol?: string) {
    if (accountId !== null || changingList) return false
    setChangingList(true)
    try {
      if (action === 'rename') {
        if (guestProfileId) await storage.renameProfileList(guestProfileId, listId, value, symbol)
        else await storage.renameList(listId, value, symbol)
      } else {
        if (guestProfileId) await storage.changeProfileListKind(guestProfileId, listId, value as ShoppingListRecord['kind'])
        else await storage.changeListKind(listId, value as ShoppingListRecord['kind'])
      }
      setLocalLists(guestProfileId ? await storage.readProfileLists(guestProfileId) : await storage.readLists())
      setListError(null)
      return true
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось изменить список')
      return false
    }
    finally { setChangingList(false) }
  }
  async function changeList(action: 'rename' | 'kind', id: ListId, value: string) {
    if (accountId === null) return updateLocalList(action, id, value)
    return await onChangeCloudList?.(id, action, value) ?? false
  }

  const [drafts, setDrafts] = useState<AccountDraftList[]>([])
  const [draftRevision, setDraftRevision] = useState(0)
  const [draftRename, setDraftRename] = useState<AccountDraftList>()
  const [draftName, setDraftName] = useState('')
  const localCopy = !!localCompletions
  function refreshDrafts() {
    setDraftRevision(value => value + 1)
    onQueued?.()
  }
  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    void storage.readAccountDraftLists(accountId).then(rows => {
      if (!cancelled) setDrafts(rows)
    }).catch(() => { if (!cancelled) setListError('Не удалось прочитать локальные списки аккаунта.') })
    return () => { cancelled = true }
  }, [storage, accountId, localCopy, draftRevision, refreshRevision, onQueued])

  async function queueLocalCompletion(id: ListId, mode: CompletionMode, confirmedItemIds?: readonly string[], confirmedMarked?: boolean) {
    const row = visibleLists.find(list => list.id === id)
    if (!accountId || !row || creatingList) return
    setCreatingList(true)
    try {
      await storage.queueAccountCompletion({
        accountId, localListId: id, remoteListId: cloudBoundLists[id] ?? id, name: row.name,
        operationId: crypto.randomUUID(), createdAt: Date.now(), mode, confirmedItemIds, confirmedMarked,
      }, true)
      setListError(null)
      refreshDrafts()
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось поставить завершение в очередь.')
    } finally { setCreatingList(false) }
  }

  async function submitNewList(event: FormEvent) {
    if (accountId === null) return createLocalList(event)
    event.preventDefault()
    if (localCopy && accountId) {
      if (creatingList) return
      setCreatingList(true)
      try {
        const id = crypto.randomUUID()
        await storage.saveAccountDraftList(accountId, { id, name: newListName, kind: newListKind, symbol: newListSymbol, createdAt: Date.now() })
        const updated = await storage.readAccountDraftLists(accountId)
        setDrafts(updated)
        setActive(id)
        setRevealCard({ id })
        setListError(null)
        setNewListDialog(false)
        refreshDrafts()
      } catch (error) {
        setListError(error instanceof Error ? error.message : 'Не удалось сохранить список.')
      } finally { setCreatingList(false) }
      return
    }
    const id = await onCreateCloudList?.(newListName, newListKind, newListSymbol)
    if (!id) return
    // The callback returns the verified, bound list ID only after success.
    // Background list refreshes must not independently change the selection.
    setActive(id)
    setNewListDialog(false)
    setRevealCard({ id })
  }

  async function completeLocalList(id: ListId, mode: Exclude<CompletionMode, 'delete_list'>, confirmedItemIds?: readonly string[]) {
    const list = localLists?.find(row => row.id === id)
    if (accountId !== null || !list || changingList || shopping.busy || shopping.loading) return
    if (!itemsForList(shopping.items, id).length) { window.alert('Список пуст. Его нельзя поместить в архив.'); return }
    setChangingList(true)
    try {
      if (guestProfileId) await storage.completeProfileList(guestProfileId, list.id, crypto.randomUUID(), Date.now(), mode, confirmedItemIds)
      else await storage.completeList(list as ShoppingListRecord, crypto.randomUUID(), Date.now(), mode, confirmedItemIds)
      const [updatedLists, snapshots] = await Promise.all([guestProfileId ? storage.readProfileLists(guestProfileId) : storage.readLists(), guestProfileId ? storage.readProfileArchives(guestProfileId) : storage.readArchives()])
      setLocalLists(updatedLists)
      setArchives(snapshots.sort((a, b) => b.completedAt - a.completedAt))
      setListError(null)
      await shopping.reload()
      setLocalNotice({ text: mode === 'archive_purchased' ? 'Отмеченные покупки перемещены в архив.' : 'Список завершён.', at: Date.now() })
      if (id === active && list.kind === 'oneoff' && mode !== 'archive_purchased') setActive(updatedLists[0]?.id ?? '')
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось завершить список') }
    finally { setChangingList(false) }
  }
  async function deleteLocalList(confirmed = false, id = active) {
    if (accountId !== null || !id || changingList || shopping.loading || shopping.busy || (!confirmed && !window.confirm(itemsForList(shopping.items, id).length ? 'Удалить список и товары в нём?' : 'Удалить пустой список?'))) return
    setChangingList(true)
    try {
      if (guestProfileId) await storage.deleteProfileList(guestProfileId, id)
      else await storage.deleteList(id)
      const next = guestProfileId ? await storage.readProfileLists(guestProfileId) : await storage.readLists()
      setLocalLists(orderLists(next)); if (id === active) setActive(next[0]?.id ?? ''); setMenuTarget(null)
      await shopping.reload(); setListError(null)
      setLocalNotice({ text: 'Список удалён.', at: Date.now() })
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось удалить список') }
    finally { setChangingList(false) }
  }
  async function placeLocalList(id: string, target: string) {
    if (accountId !== null || !localLists || changingList) return false
    const next = placeList(localLists,id,target)
    if (next.every((row,i)=>row.id===localLists[i]?.id)) return false
    setChangingList(true)
    try {
      if (guestProfileId) {
        await storage.reorderProfileLists(guestProfileId,next)
      } else await storage.reorderLists(next)
      setLocalLists(next)
      setListError(null)
      return true
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось изменить порядок списков')
      return false
    }
    finally { setChangingList(false) }
  }
  function openArchive() {
    setMenuTarget(null)
    setShowArchive(true)
    onOpenCloudArchive?.()
  }
  function startSwipe(event:ReactTouchEvent<HTMLElement>){
    const target=event.target as HTMLElement
    if((accountId!==null&&!cloudArchive)||event.touches.length!==1||target.closest('.list-rail,input,textarea,select,[role="dialog"],.list-menu,.menu-anchor,.settings-panel,.dialog-backdrop')||menuTarget||settingsOpen||newListDialog||renaming||editingId){swipe.current=null;return}
    swipe.current={x:event.touches[0].clientX,y:event.touches[0].clientY}
  }
  function endSwipe(event:ReactTouchEvent<HTMLElement>){
    const origin=swipe.current;swipe.current=null
    if(!origin||event.changedTouches.length!==1)return
    const dx=event.changedTouches[0].clientX-origin.x,dy=event.changedTouches[0].clientY-origin.y
    if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return
    if(dx<0&&!showArchive){openArchive();setMenuTarget(null)}
    if(dx>0&&showArchive)setShowArchive(false)
  }
  const mergedSources = new Set(queuedMerges.map(row => row.source.localListId))
  const mergedLists = new Set(queuedMerges.flatMap(row => [row.source.localListId, row.target.localListId]))
  const pendingCompletions = new Map((localCompletions ?? []).map(row => [row.localListId, row]))
  const visibleLists = (accountId === null && localLists !== null ? localLists : (accountId !== null ? [...accountCloudLists.map(row => ({ ...row, symbol: accountSymbols[row.id] ?? defaultListSymbol })), ...drafts] : lists.map(row => ({ ...row, kind: 'permanent' as const })))).filter(row => {
    if (localCopy && mergedSources.has(row.id)) return false
    const queued = pendingCompletions.get(row.id)
    return !queued || (queued.mode !== 'delete_list' && (row.kind !== 'oneoff' || queued.mode === 'archive_purchased'))
  })
  useEffect(() => {
    if (accountId === null && localLists === null) return
    if (visibleLists.length && !visibleLists.some(list => list.id === active)) setActive(visibleLists[0].id)
  }, [visibleLists, active, accountId, localLists])
  async function createLocalList(event: FormEvent) {
    event.preventDefault()
    if (accountId !== null || !localLists || creatingList) return
    const trimmed = newListName.trim()
    if (!trimmed || trimmed.length > 120) { setListError('Введите название списка от 1 до 120 символов.'); return }
    const list: ShoppingListRecord = { id: crypto.randomUUID(), name: trimmed, symbol: newListSymbol, kind: newListKind, createdAt: Date.now(), position: localLists.reduce((last, row) => Math.max(last, row.position ?? row.createdAt), -1) + 1 }
    setCreatingList(true)
    try {
      if (guestProfileId) await storage.saveProfileList(guestProfileId, list)
      else await storage.saveList(list)
      setLocalLists(previous => previous ? [...previous, list] : [list])
      setActive(list.id)
      setRevealCard({ id: list.id })
      setNewListName('')
      setNewListDialog(false)
      setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось создать список') }
    finally { setCreatingList(false) }
  }
  const [name, setName] = useState('')
  const [itemNotice, setItemNotice] = useState('')
  const [itemInputError, setItemInputError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingQuantity, setEditingQuantity] = useState('')
  const [editingUnit, setEditingUnit] = useState('')
  // Guest remains the default until a verified auth session is available.
  const itemStore = useMemo(() => accountId === null ? (guestProfileId ? profileItemStore(storage, guestProfileId) : itemStoreForAccount(storage, null)) : cloudAwareItemStore(storage, accountId, onQueued), [storage, accountId, guestProfileId, onQueued])
  const shopping = useShopping(itemStore, refreshRevision)
  const hiddenCompletionItems = new Set((localCompletions ?? []).flatMap(row => row.hiddenItemIds))
  const visibleItems = shopping.items.filter(item => !hiddenCompletionItems.has(item.id) && (!localCopy || !mergedLists.has(item.listId)))
  if (localCopy) for (const merge of queuedMerges) visibleItems.push(...merge.result)
  const [itemConflicts, setItemConflicts] = useState<ItemDeletionConflict[]>([])
  const [conflictId, setConflictId] = useState<string>()
  const [resolvingConflict, setResolvingConflict] = useState(false)
  const [conflictError, setConflictError] = useState('')
  useEffect(() => {
    let active = true
    if (accountId !== null) void storage.readItemDeletionConflicts(accountId).then(rows => {
      if (active) setItemConflicts(rows)
    }).catch(() => {})
    return () => { active = false }
  }, [storage, accountId, refreshRevision])
  const listConflicts = itemConflicts.filter(conflict => conflict.localListId === active)
  const selectedConflict = listConflicts.find(conflict => conflict.operationId === conflictId)
  async function resolveConflict(conflict: ItemDeletionConflict, keepItem: boolean) {
    if (!onResolveItemDeletion || resolvingConflict || listLocked(conflict.localListId)) return
    setResolvingConflict(true)
    setConflictError('')
    try {
      await onResolveItemDeletion(conflict, keepItem)
      setConflictId(undefined)
    } catch {
      setConflictError('Не удалось применить решение. Проверьте актуальные данные и повторите попытку.')
    } finally {
      setResolvingConflict(false)
    }
  }
  const [itemSort, setItemSort] = useState<Record<ListId, ItemSort>>({})
  const sort = itemSort[active] ?? 'recent'
  const [nameConflict, setNameConflict] = useState<{ listId: ListId; key: string }>()
  const nameConflicts = duplicatedItems(visibleItems.filter(item =>
    !itemConflicts.some(conflict => conflict.item.id === item.id)))
  const activeNameConflicts = nameConflicts.filter(group => group[0].listId === active)
  const selectedNameConflict = nameConflict?.listId === active
    ? activeNameConflicts.find(group => itemNameKey(group[0].name) === nameConflict.key)
    : undefined
  const hiddenIds = new Set([...listConflicts.map(conflict => conflict.item.id),
    ...activeNameConflicts.flatMap(group => group.map(item => item.id))])
  const rows = sortShoppingItems(visibleItems.filter(item => item.listId === active && !hiddenIds.has(item.id)), sort)
  const [deleteListId, setDeleteListId] = useState<ListId | null>(null)
  const [completionListId, setCompletionListId] = useState<ListId | null>(null)
  const [purchaseArchive, setPurchaseArchive] = useState<{ listId: ListId; itemIds: string[] } | null>(null)
  const canEditList = accountId === null || !!onChangeCloudList
  const operations = localCopy ? [] : listOperations
  const isDraft = (id: ListId) => drafts.some(draft => draft.id === id)
  const canWriteItems = (id: ListId) => accountId === null || !!cloudBoundLists[id] || isDraft(id)
  const listActionsBusy = changingList || cloudListBusy
  const listMutationBusy = shopping.loading || shopping.busy || listActionsBusy || creatingList
  function listLocked(id: ListId) {
    return mergedLists.has(id) || pendingCompletions.has(id) || operations.some(operation => operation.localListId === id && (operation.phase !== 'error' || !!operation.retry))
  }
  const displayedOperations = operations.filter(operation => !operation.fromLocalCopy || operation.phase === 'error')
  const activeListLocked = listLocked(active)
  function canComplete(id: ListId) {
    return !listLocked(id) && (accountId === null || isDraft(id) ||
      (!!cloudBoundLists[id] && (localCopy || !!onCompleteCloudList)))
  }
  function canDelete(id: ListId) {
    return canComplete(id) && (accountId === null || localCopy || (!!cloudBoundLists[id] && !!onCompleteCloudList))
  }
  async function moveCard(id: ListId, direction: -1 | 1, previousLeft: number) {
    const index = visibleLists.findIndex(row => row.id === id)
    const target = visibleLists[index + direction]
    if (index < 0 || !target || listActionsBusy || listLocked(id) || listLocked(target.id) || movingCard.current) return
    movingCard.current = true
    try {
      const moved = accountId === null
        ? await placeLocalList(id, target.id)
        : await onChangeCloudList?.(id, 'reorder', target.id)
      if (moved) {
        setListError(null)
        setRevealCard({ id, previousLeft })
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось изменить порядок списков.')
    } finally {
      movingCard.current = false
    }
  }
  const completionDisabled = listMutationBusy || !canComplete(active)
  function requestCompletion(id: ListId) {
    if (listMutationBusy || !canComplete(id)) return
    if (!itemsForList(visibleItems, id).length) {
      window.alert('Список пуст. Его нельзя поместить в архив.')
      return
    }
    setCompletionListId(id)
  }
  function confirmCompletion(id: ListId, mode: Exclude<CompletionMode, 'delete_list'>) {
    setCompletionListId(null)
    if (accountId === null) void completeLocalList(id, mode)
    else if (canComplete(id)) {
      if (localCopy || isDraft(id)) void queueLocalCompletion(id, mode)
      else onCompleteCloudList?.(id, mode)
    }
  }
  function requestDeletion(id: ListId) {
    if (listMutationBusy || !canDelete(id)) return
    if (accountId === null && !itemsForList(visibleItems, id).some(item => item.purchased)) {
      void deleteLocalList(false, id)
      return
    }
    setDeleteListId(id)
  }
  const [mergeSourceId, setMergeSourceId] = useState<ListId>()
  const mergeSource = visibleLists.find(row => row.id === mergeSourceId)
  const mergeActions: ListMergeActions | undefined = accountId === null && guestProfileId ? {
    read: (source, target) => storage.readProfileListMerge(guestProfileId, source, target),
    apply: async (snapshot, choices) => {
      await storage.mergeProfileLists(guestProfileId, snapshot, choices)
      const updated = await storage.readProfileLists(guestProfileId)
      setLocalLists(orderLists(updated))
      await shopping.reload()
    },
  } : localCopy && accountId ? {
    read: (source, target) => storage.readLocalListMerge(accountId, source, target),
    apply: async (snapshot, choices, operationId) => {
      await storage.queueLocalListMerge(accountId, snapshot, choices, operationId)
      onQueued?.()
    },
  } : cloudMerge
  const mergeTargets = (from: ListId) => visibleLists.filter(row => row.id !== from && !listLocked(row.id) &&
    (accountId === null || !!cloudBoundLists[row.id]))
  const editingItem = rows.find(item => item.id === editingId)
  const deletionItems = deleteListId ? itemsForList(visibleItems, deleteListId) : []
  const hasMarkedItems = deletionItems.some(item => item.purchased)
  const remaining = visibleItems.filter(item => item.listId === active && !item.purchased &&
    !listConflicts.some(conflict => conflict.item.id === item.id)).length
  const list = visibleLists.find(list => list.id === active)
  const menuList = menuTarget && visibleLists.find(row => row.id === menuTarget.id)
  const renameList = renaming && visibleLists.find(row => row.id === renaming)
  async function selectListKind(id: ListId, kind: ListKind) {
    if (typeSaving || !canEditList || listActionsBusy || listLocked(id)) return
    setTypeSaving(true)
    try {
      if (await changeList('kind', id, kind)) {
        setListError(null)
        setMenuTarget(current => current?.id === id ? null : current)
      }
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось изменить тип списка.')
    } finally {
      setTypeSaving(false)
    }
  }
  async function submitListEdit(event: FormEvent) {
    event.preventDefault()
    if (!renameList || !renameName.trim() || savingList || listLocked(renameList.id)) return
    setSavingList(true)
    setListError(null)
    try {
      const name = symbolOnly ? renameList.name : renameName.trim()
      if (accountId === null) {
        if (!await updateLocalList('rename', renameList.id, symbolOnly ? null : name, editListSymbol)) return
      } else {
        const savingSymbol = editListSymbol !== renameList.symbol
        const remoteId = cloudBoundLists[renameList.id]
        if (savingSymbol && !remoteId) throw new Error('Локальная копия списка ещё не готова.')
        if (name !== renameList.name && !await changeList('rename', renameList.id, name)) return
        if (savingSymbol) {
          await storage.setAccountListSymbol(accountId, renameList.id, remoteId, editListSymbol)
          setAccountSymbols(previous => ({ ...previous, [renameList.id]: editListSymbol }))
        }
      }
      setRenaming(null)
    } catch (error) {
      setListError(error instanceof Error ? error.message : 'Не удалось сохранить список.')
    } finally {
      setSavingList(false)
    }
  }
  function openRename(row: (typeof visibleLists)[number], onlySymbol = false) {
    setListError(null)
    setSymbolOnly(onlySymbol)
    setEditListSymbol(row.symbol)
    setRenameName(row.name)
    setRenaming(row.id)
    setMenuTarget(null)
  }
  function toggleListMenu(id: ListId, source: 'card' | 'heading' | 'completion', anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect()
    const top = source === 'completion'
      ? (rect.bottom + 112 <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - 112))
      : Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 340))
    setMenuPosition({
      top,
      left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)),
    })
    setMenuTarget(menuTarget?.id === id && menuTarget.source === source ? null : { id, source })
  }
  const createListTile = <button type="button" className="create-list-tile" aria-label="Новый список"
    disabled={accountId !== null && !localCopy && !onCreateCloudList}
    onClick={() => { setNewListName(''); setNewListKind('permanent'); setNewListSymbol(defaultListSymbol); setNewListDialog(true) }}>
    <span className="create-plus" aria-hidden="true">+</span><span className="list-name">Новый список</span>
  </button>
  function menuTrigger(row: (typeof visibleLists)[number], source: 'card' | 'heading') {
    return <button type="button" className="menu-trigger"
      aria-label={source === 'heading' ? 'Действия со списком' : `Действия со списком «${row.name}»`}
      aria-expanded={menuTarget?.id === row.id && menuTarget.source === source} aria-haspopup="menu"
      onClick={event => toggleListMenu(row.id, source, event.currentTarget)}>⋯</button>
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!list || activeListLocked) return
    if (!canWriteItems(active)) return
    shopping.clearError()
    setItemNotice('')
    setItemInputError('')
    const result = await shopping.add(active, name)
    if (!result) return
    if (result.validationError) { setItemInputError(result.validationError); return }
    if (result.saved) setName('')
    if (result.skipped?.length) setItemNotice(result.saved
      ? `Пропущены товары, которые уже есть в списке: ${result.skipped.join(', ')}.`
      : `В списке уже есть: ${result.skipped.join(', ')}.`)
  }
  async function saveEdit(event: FormEvent, item: typeof shopping.items[number]) {
    event.preventDefault()
    if (activeListLocked) return
    if (await shopping.edit(item, editingName, editingQuantity.trim() ? Number(editingQuantity) : undefined, editingUnit)) {
      setEditingId(null); setEditingName(''); setEditingQuantity(''); setEditingUnit('')
    }
  }
  return <main className={`shopping-e4 content-${contentSize}`} onTouchStart={startSwipe} onTouchEnd={endSwipe}>
    <header>
      <div className="workspace-topbar">
        <button className="settings-trigger" type="button" aria-label="Настройки"
          aria-expanded={settingsOpen} onClick={event => openSettings(event.detail === 0)}>☰</button>
        {headerActions}
      </div>
      <div className="header-copy"><h1>Надо купить</h1><p>Версия {version}</p></div>
    </header>
    {settingsOpen && <WorkspaceDialog
      className={settingsKeyboardFocus ? 'settings-panel keyboard-focus' : 'settings-panel'}
      label="Настройки приложения" onDismiss={() => setSettingsOpen(false)}
      onPointerDownCapture={() => setSettingsKeyboardFocus(false)}
      onKeyDownCapture={event => {
        if (event.key === 'Tab' || event.key.startsWith('Arrow') || event.key === ' ') setSettingsKeyboardFocus(true)
      }}>
      <h2>Настройки</h2>
      <fieldset><legend>Размер карточек списков</legend>
        <label><input type="radio" name="card-size" checked={draftCardSize === 'standard'} onChange={() => setDraftCardSize('standard')}/> Стандартный (горизонтальная лента)</label>
        <label><input type="radio" name="card-size" checked={draftCardSize === 'large'} onChange={() => setDraftCardSize('large')}/> Крупный (горизонтальная лента)</label>
      </fieldset>
      <fieldset><legend>Размер содержимого списка покупок</legend>
        <label><input type="radio" name="content-size" checked={draftContentSize === 'standard'} onChange={() => setDraftContentSize('standard')}/> Стандартный</label>
        <label><input type="radio" name="content-size" checked={draftContentSize === 'large'} onChange={() => setDraftContentSize('large')}/> Крупный</label>
      </fieldset>
      <button type="button" onClick={() => { setSettingsOpen(false); onOpenProfileMenu() }}>Настройка профиля</button>
      <div className="dialog-buttons">
        <button type="button" onClick={() => setSettingsOpen(false)}>
          {draftCardSize === cardSize && draftContentSize === contentSize ? 'Закрыть' : 'Отмена'}
        </button>
        <button type="button" disabled={draftCardSize === cardSize && draftContentSize === contentSize} onClick={() => {
          chooseCardSize(draftCardSize)
          chooseContentSize(draftContentSize)
          setSettingsOpen(false)
        }}>Сохранить</button>
      </div>
    </WorkspaceDialog>}
    {(accountId === null || cloudArchive) && <div className="section-switch" aria-label="Разделы приложения"><button type="button" aria-label="Основные списки" aria-current={!showArchive ? 'page' : undefined} className={!showArchive ? 'current' : ''} onClick={() => setShowArchive(false)}>●</button><button type="button" aria-label={`Архив, ${accountId === null ? archives.length : (cloudArchiveCount ?? 0)} завершённых списков`} aria-current={showArchive ? 'page' : undefined} className={showArchive ? 'current' : ''} onClick={openArchive}>●</button></div>}
    {!showArchive && <nav ref={listRail} className={`lists-grid ${cardSize} list-rail`} aria-label="Списки покупок">
      {visibleLists.map((row, index) => <div className="list-tile" data-list-id={row.id} key={row.id}>
        <button className="list-select" title={row.name} aria-pressed={active===row.id} onClick={() => { setActive(row.id);setName('');setItemNotice('');setMenuTarget(null) }}><span className="list-symbol" aria-hidden="true">{row.symbol}</span><span className="list-name-wrap"><span className="list-name">{row.name}</span></span></button>
        <div className="list-card-indicators"><ListIndicators kind={row.kind}/></div>
        <div className="menu-anchor">{menuTrigger(row, 'card')}</div>
        {active === row.id && canEditList && <div className="list-rail-controls" role="group" aria-label="Порядок выбранного списка">
          {([-1, 1] as const).map(direction => {
            const target = visibleLists[index + direction]
            return <button key={direction} type="button" className={direction === -1 ? 'move-left' : 'move-right'}
              aria-label={direction === -1 ? 'Переместить список влево' : 'Переместить список вправо'}
              disabled={!target || listActionsBusy || isDraft(row.id) || isDraft(target.id) || listLocked(row.id) || listLocked(target.id)}
              onClick={event => {
                const tile = event.currentTarget.closest('.list-tile')
                if (tile) void moveCard(row.id, direction, tile.getBoundingClientRect().left)
              }}>
              <span aria-hidden="true" />
            </button>
          })}
        </div>}
        {itemConflicts.some(conflict => conflict.localListId === row.id) && <span className="list-conflict-marker" role="img" title="Конфликт удаления товара" aria-label="Конфликт удаления товара">!</span>}
        {nameConflicts.some(group => group[0].listId === row.id) && <span className="list-conflict-marker" role="img"
          title="Совпадение названий товаров" aria-label="Совпадение названий товаров">!</span>}
      </div>)}
      <div className="list-create-control rail-create">{createListTile}</div>
    </nav>}
    {!showArchive && displayedOperations.length > 0 && <ul className="list-operation-statuses" aria-label="Операции со списками">
      {displayedOperations.map(operation => <li key={operation.localListId}>
        <p role={operation.phase === 'error' ? 'alert' : 'status'}>
          {operation.phase === 'running' && <span className="list-operation-spinner" aria-hidden="true" />}
          {operation.phase === 'error' ? `«${operation.name}». ${operation.message}` :
            operation.phase === 'queued' ? `«${operation.name}» ожидает синхронизации` :
            `${operation.mode === 'delete_list' ? 'Удаляем' : operation.mode === 'archive_purchased' ? 'Архивируем покупки из' : 'Завершаем'} «${operation.name}»…`}
        </p>
        {operation.retry && <button type="button" onClick={operation.retry}>Повторить</button>}
        {operation.dismiss && <button type="button" onClick={() => void operation.dismiss?.()}>{operation.phase === 'queued' || operation.retry ? 'Отменить операцию' : 'Закрыть'}</button>}
      </li>)}
    </ul>}
    {!showArchive && menuTarget && menuList && createPortal(<>
      <button type="button" className="menu-dismiss" aria-label="Закрыть меню" onClick={() => setMenuTarget(null)}/>
      {menuTarget.source === 'completion' ? <div className="list-menu" role="menu" aria-label="Завершение" style={{ ...menuPosition, maxHeight: `calc(100dvh - ${menuPosition.top + 8}px)` }}>
        <button type="button" role="menuitem" disabled={listMutationBusy || !canComplete(menuList.id) ||
          !itemsForList(visibleItems, menuList.id).some(item => item.purchased)} onClick={() => {
          const itemIds = itemsForList(visibleItems, menuList.id).filter(item => item.purchased).map(item => item.id)
          setMenuTarget(null)
          setPurchaseArchive({ listId: menuList.id, itemIds })
        }}>
          <svg aria-hidden="true" className="completion-icon" viewBox="0 0 24 24">
            <path d="M3 2h8v8H3zM3 14h8v8H3zM5 6l2 2 6-6M5 18l2 2 6-6M15 6h6m-6 12h6" />
          </svg>
          Завершить покупки
        </button>
        <button type="button" role="menuitem" onClick={() => { setMenuTarget(null); requestCompletion(menuList.id) }}>
          <svg aria-hidden="true" className="completion-icon" viewBox="0 0 24 24">
            <path d="M8 4H5v18h14V4h-3M8 2h8v5H8zM8 14l3 3 5-6" />
          </svg>
          Завершить список
        </button>
      </div> :       <div className="list-menu" role="menu" aria-label="Действия со списком" style={{ ...menuPosition, maxHeight: `calc(100dvh - ${menuPosition.top + 8}px)` }}>
        <button disabled={!canEditList || isDraft(menuList.id) || listActionsBusy || listLocked(menuList.id)} role="menuitem" onClick={() => openRename(menuList)}>✎ Переименовать</button>
        <button disabled={!canEditList || isDraft(menuList.id) || listActionsBusy || listLocked(menuList.id)} role="menuitem"
          onClick={() => openRename(menuList, true)}>Изменить пиктограмму</button>
        <div className="list-kind-menu-label" id="list-kind-menu-label">Изменить тип списка</div>
        <div className="list-kind-options" role="group" aria-labelledby="list-kind-menu-label">
          {(['oneoff', 'permanent'] as const).map(kind => <button key={kind} type="button" role="menuitemradio"
            aria-checked={menuList.kind === kind} disabled={typeSaving || !canEditList || isDraft(menuList.id) || listActionsBusy || listLocked(menuList.id)}
            onClick={() => {
              if (menuList.kind === kind) setMenuTarget(null)
              else void selectListKind(menuList.id, kind)
            }}>
            <ListIndicators kind={kind} decorative />{listKindLabels[kind]}
            {menuList.kind === kind && <span className="menu-check" aria-hidden="true">✓</span>}
          </button>)}
        </div>
        <div className="menu-separator"/>
        {mergeActions && <button type="button" role="menuitem"
          disabled={listMutationBusy || listLocked(menuList.id) || !mergeTargets(menuList.id).length ||
            (accountId !== null && !cloudBoundLists[menuList.id])}
          onClick={() => { setMergeSourceId(menuList.id); setMenuTarget(null) }}>Объединить со списком</button>}
        <button disabled={listMutationBusy || !canComplete(menuList.id)} role="menuitem"
          onClick={() => { setMenuTarget(null); requestCompletion(menuList.id) }}>✓ Завершить список</button>
        <button disabled={listMutationBusy || !canDelete(menuList.id)} role="menuitem" className="danger"
          onClick={() => { setMenuTarget(null); requestDeletion(menuList.id) }}>▤ Удалить список</button>
      </div>}
    </>, document.body)}
    {!showArchive && drafts.map(draft => draft.nameConflict ? <div className="list-operation-statuses" key={draft.id}>
      <p role="alert">В облаке уже есть список «{draft.name}». Выберите новое имя для локального списка.</p>
      <button type="button" onClick={() => { setDraftRename(draft); setDraftName(draft.name); setListError(null) }}>Переименовать локальный список</button>
    </div> : <p role="status" key={draft.id}>«{draft.name}» ожидает создания в облаке.</p>)}
    {draftRename && accountId && <WorkspaceDialog label="Переименовать локальный список" className="create-dialog"
      onDismiss={() => { if (!creatingList) setDraftRename(undefined) }}>
      <h2>Переименовать локальный список</h2>
      <form onSubmit={async event => {
        event.preventDefault()
        if (creatingList) return
        setCreatingList(true)
        try {
          await storage.saveAccountDraftList(accountId, { ...draftRename, name: draftName })
          setListError(null)
          setDraftRename(undefined)
          refreshDrafts()
        } catch (error) {
          setListError(error instanceof Error ? error.message : 'Не удалось переименовать список.')
        } finally { setCreatingList(false) }
      }}>
        <label>Новое имя<input value={draftName} onChange={event => setDraftName(event.target.value)} maxLength={120} required /></label>
        {listError && <p role="alert">{listError}</p>}
        <button type="submit" disabled={creatingList || !draftName.trim()}>Сохранить</button>
        <button type="button" disabled={creatingList} onClick={() => setDraftRename(undefined)}>Отмена</button>
      </form>
    </WorkspaceDialog>}
    {mergeSource && mergeActions && <ListMergeDialog source={mergeSource} targets={mergeTargets(mergeSource.id)}
      actions={mergeActions} onDismiss={() => setMergeSourceId(undefined)} onMerged={id => {
        setMergeSourceId(undefined)
        setActive(id)
        setRevealCard({ id })
        setLocalNotice({ text: 'Списки объединены.', at: Date.now() })
      }}/>}
    {newListDialog && <WorkspaceDialog label="Создать список" className="create-dialog"
      onDismiss={() => { if (!creatingList && !cloudListBusy) setNewListDialog(false) }}>
        <div className="account-dialog-heading"><h2 id="new-list-title">Создать список</h2><button type="button" aria-label="Закрыть создание списка" disabled={creatingList || cloudListBusy} onClick={() => setNewListDialog(false)}>×</button></div>
        <form onSubmit={event => void submitNewList(event)}>
          <label htmlFor="new-list-name">Название списка</label>
          <input id="new-list-name" value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} required disabled={creatingList || cloudListBusy || (accountId === null && localLists === null)}/>
          <label htmlFor="new-list-kind">Тип списка</label>
          <select id="new-list-kind" value={newListKind} onChange={event => setNewListKind(event.target.value as 'permanent' | 'oneoff')}>
            <option value="permanent">Постоянный</option><option value="oneoff">Разовый</option>
          </select>
          <ListSymbolPicker value={newListSymbol} onChange={setNewListSymbol} disabled={creatingList || cloudListBusy}/>
          <button disabled={creatingList || cloudListBusy || (accountId === null && localLists === null) || !newListName.trim()}>Создать</button>
          <button type="button" disabled={creatingList || cloudListBusy} onClick={() => setNewListDialog(false)}>Отмена</button>
          {(cloudListError || (localCopy && listError)) && <p role="alert">{cloudListError || listError}</p>}
        </form>
    </WorkspaceDialog>}
    {renameList && canEditList && <WorkspaceDialog
      label={symbolOnly ? 'Изменить пиктограмму' : 'Переименовать список'} className="create-dialog"
      onDismiss={() => { if (!savingList) setRenaming(null) }}>
      <h2>{symbolOnly ? 'Изменить пиктограмму' : 'Переименовать список'}</h2>
      <form onSubmit={event => void submitListEdit(event)}>
        {!symbolOnly && <>
          <label htmlFor="rename-name">Название списка</label>
          <div className="rename-input">
            <input id="rename-name" maxLength={120} value={renameName} disabled={savingList}
              onChange={event => setRenameName(event.target.value)}/>
            <button type="button" aria-label="Очистить название" disabled={savingList} onClick={() => setRenameName('')}>🧹</button>
          </div>
        </>}
        <ListSymbolPicker value={editListSymbol} onChange={setEditListSymbol} disabled={savingList}/>
        <div className="dialog-buttons">
          <button type="button" disabled={savingList} onClick={() => setRenaming(null)}>Отмена</button>
          <button disabled={savingList || listActionsBusy || !renameName.trim()}>Сохранить</button>
        </div>
        {(listError || (!symbolOnly && cloudListError)) && <p role="alert">{listError || cloudListError}</p>}
      </form>
    </WorkspaceDialog>}
    {cloudListError && !newListDialog && !renaming && <p role="alert">{cloudListError}</p>}
    {notice && <ListActionNotice key={notice.at} message={notice} />}
    {completionError && <p role="alert" className="error">{completionError}</p>}
    {listError && !renaming && !draftRename && !(newListDialog && localCopy) && <p role="alert" className="error">{listError}</p>}
    {!showArchive && localCopy && queuedMerges.some(row => row.target.localListId === active) &&
      <p role="status">Объединение будет отправлено при синхронизации аккаунта.</p>}
    {showArchive && accountId !== null && cloudArchive ? cloudArchive : showArchive && accountId === null ? <PurchaseHistory snapshots={archives} /> : visibleLists.length === 0 ? <section aria-labelledby="list-title">
      <h2 id="list-title">Списки покупок</h2>
      <p>Чтобы добавить товары, создайте список.</p>
    </section> : <section aria-labelledby="list-title">
      <ListHeading name={list?.name ?? 'Списки покупок'} remaining={remaining}
        indicators={list && <ListIndicators kind={list.kind} cloudStatus={cloudStatus}/>}
        syncHint={!!list && cloudStatus === 'signed-out'}
        rename={list ? { disabled: !canEditList || isDraft(list.id) || !!listActionsBusy || activeListLocked, open: () => openRename(list) } : undefined}
        actions={list && <div className="list-toolbar" aria-label="Управление текущим списком">
          <button type="button" aria-label="Завершить список" title="Завершить список"
            aria-haspopup="menu" aria-expanded={menuTarget?.source === 'completion' && menuTarget.id === list.id}
            disabled={completionDisabled} onClick={event => toggleListMenu(list.id, 'completion', event.currentTarget)}>✓</button>
          {(rows.length > 1 || sort !== 'recent') && <label className="item-sort" title="Сортировка товаров">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h9M4 12h7M4 18h5M17 5v14m-3-3 3 3 3-3"/>
            </svg>
            <select aria-label="Сортировка товаров" value={sort} onChange={event => setItemSort(current => ({ ...current, [active]: event.target.value as ItemSort }))}>
              <option value="recent">Сначала новые</option>
              <option value="name-asc">По названию: А–Я</option>
              <option value="name-desc">По названию: Я–А</option>
              <option value="quantity-asc">По количеству: по возрастанию</option>
              <option value="quantity-desc">По количеству: по убыванию</option>
            </select>
          </label>}
          {menuTrigger(list, 'heading')}
        </div>}/>
      {purchaseArchive && <WorkspaceDialog label="Завершить покупки" className="create-dialog" onDismiss={() => setPurchaseArchive(null)}>
        <h2>Завершить покупки</h2>
        <p>Отмеченные покупки будут перемещены из текущего списка в архив. Список и остальные товары останутся.</p>
        <p>Отмечено: {purchaseArchive.itemIds.length}</p>
        <div className="dialog-buttons">
          <button type="button" disabled={listMutationBusy || !canComplete(purchaseArchive.listId)} onClick={() => {
            const { listId, itemIds } = purchaseArchive
            setPurchaseArchive(null)
            if (accountId === null) void completeLocalList(listId, 'archive_purchased', itemIds)
            else if (localCopy || isDraft(listId)) void queueLocalCompletion(listId, 'archive_purchased', itemIds)
            else onCompleteCloudList?.(listId, 'archive_purchased', undefined, itemIds)
          }}>Завершить отмеченные</button>
          <button type="button" onClick={() => setPurchaseArchive(null)}>Отмена</button>
        </div>
      </WorkspaceDialog>}
      {completionListId && canComplete(completionListId) && <div className="dialog-backdrop"><section className="rename-dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-completion-title"><h2 id="cloud-completion-title">Завершить список</h2><div className="dialog-buttons">
        <button type="button" disabled={shopping.loading || shopping.busy} onClick={()=>confirmCompletion(completionListId, 'marked_only')}>Завершить: отмеченные</button>
        <button type="button" disabled={shopping.loading || shopping.busy} onClick={()=>confirmCompletion(completionListId, 'all_purchased')}>Завершить: всё куплено</button>
        <button type="button" disabled={shopping.loading || shopping.busy} onClick={()=>confirmCompletion(completionListId, 'none_purchased')}>Завершить: ничего не куплено</button>
        <button type="button" onClick={()=>setCompletionListId(null)}>Отмена</button></div></section></div>}
        {deleteListId && canDelete(deleteListId) && <div className="dialog-backdrop">

          <section role="dialog" aria-modal="true" aria-labelledby="cloud-delete-title" className="rename-dialog">
            <h2 id="cloud-delete-title">Удалить список?</h2>
            <p>{deletionItems.length ? 'Товары из списка будут удалены.' : 'Список пуст.'}</p>
            {hasMarkedItems && <p>Отмеченные товары не попадут в историю покупок и будут удалены без записи в архив. Чтобы сохранить их, сначала завершите список.</p>}
            <div className="dialog-buttons">
              {hasMarkedItems && <button type="button" onClick={() => {
                setDeleteListId(null)
                confirmCompletion(deleteListId, 'marked_only')
              }}>Завершить отмеченные</button>}
              <button type="button" onClick={() => setDeleteListId(null)}>Отмена</button>
              <button type="button" className="danger" disabled={shopping.loading || shopping.busy} onClick={() => {
                setDeleteListId(null)
                if (accountId === null) void deleteLocalList(true, deleteListId)
                else if (localCopy) void queueLocalCompletion(deleteListId, 'delete_list', undefined, hasMarkedItems)
                else onCompleteCloudList?.(deleteListId, 'delete_list', hasMarkedItems)
              }}>Удалить</button>
            </div>
          </section>
        </div>}

      {list && !canWriteItems(active) && <p role="status">Облачный список доступен для просмотра. Добавление товаров станет доступно после подтверждённой привязки к локальному хранилищу.</p>}
      <form onSubmit={submit}><div className="input-row"><textarea id="item-name" aria-label="Что нужно купить? (можно несколько строк)" value={name} onChange={event => {setName(event.target.value);setItemNotice('');setItemInputError('');shopping.clearError()}} placeholder="Добавьте покупку" rows={2} disabled={shopping.loading || shopping.busy || activeListLocked}/><button className="add" disabled={shopping.loading || shopping.busy || activeListLocked || !name.trim() || !canWriteItems(active)} aria-label="Добавить товар">+</button></div>{itemInputError && <p className="field-error" role="alert">{itemInputError}</p>}{itemNotice && <p className="field-error" role="status">{itemNotice}</p>}</form>
      {shopping.error && !editingItem && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
      {listConflicts.length > 0 && <ul className="item-conflicts" aria-label="Конфликты удаления">
        {listConflicts.map(conflict => <li key={conflict.operationId}><button type="button" onClick={() => {
          setConflictError('')
          setConflictId(conflict.operationId)
        }}><strong>{conflict.item.name}</strong><span>{conflict.deleted === 'cloud'
          ? 'Удалён в облаке, изменён здесь' : 'Удалён здесь, изменён в облаке'}</span></button></li>)}
      </ul>}
      {activeNameConflicts.length > 0 && <ul className="item-conflicts" aria-label="Совпадения названий">
        {activeNameConflicts.map(group => {
          const key = itemNameKey(group[0].name)
          return <li key={key}><button type="button" disabled={listMutationBusy || activeListLocked}
            onClick={() => setNameConflict({ listId: active, key })}>
            <strong>{group[0].name}</strong><span>Совпадение названий · {group.length} позиции</span>
          </button></li>
        })}
      </ul>}
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? (listConflicts.length || activeNameConflicts.length ? null : <div className="empty"><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div>) : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy || activeListLocked} onChange={() => void shopping.toggle(item)}/><span>{item.name}{item.quantity !== undefined || item.unit ? ` · ${[item.quantity, item.unit].filter(value => value !== undefined).join(' ')}` : ''}</span></label>{<button type="button" aria-label={`Изменить ${item.name}`} disabled={shopping.busy || activeListLocked} onClick={() => { shopping.clearError(); setEditingId(item.id); setEditingName(item.name); setEditingQuantity(item.quantity?.toString() ?? ''); setEditingUnit(item.unit ?? '') }} className="e4-small">✎</button>}<button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy || activeListLocked} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно завершить список!</p>}
    </section>}
    {!showArchive && selectedNameConflict && <ItemNameConflictDialog
      key={JSON.stringify(selectedNameConflict.map(item => item.id))}
      group={selectedNameConflict} items={visibleItems}
      available={accountId === null || !!onResolveItemName}
      onDismiss={() => { setNameConflict(undefined); shopping.clearError() }}
      onResolve={async decision => {
        if (activeListLocked || shopping.loading || shopping.busy) throw new Error('List is busy')
        if (accountId !== null) {
          if (!onResolveItemName) throw new Error('Cloud is unavailable')
          await onResolveItemName(decision)
        } else if (!await shopping.resolveName(decision)) throw new Error('Local item changed')
      }}/>}
    {!showArchive && selectedConflict && <WorkspaceDialog className="e4-editor" label="Конфликт удаления" onDismiss={() => {
      if (!resolvingConflict) setConflictId(undefined)
    }}>
      <h2>{selectedConflict.item.name}</h2>
      <p>{[selectedConflict.item.quantity, selectedConflict.item.unit].filter(value => value !== undefined).join(' ')}
        {selectedConflict.item.purchased ? ' · Куплено' : ''}</p>
      <p>{selectedConflict.deleted === 'cloud' ? 'Товар удалён в облаке и изменён здесь.' : 'Товар удалён здесь и изменён в облаке.'}</p>
      {!onResolveItemDeletion && <p>Войдите в аккаунт и подключитесь к интернету, чтобы применить решение.</p>}
      {conflictError && <p role="alert">{conflictError}</p>}
      <button type="button" disabled={!onResolveItemDeletion || resolvingConflict} onClick={() => void resolveConflict(selectedConflict, true)}>Сохранить товар с правкой</button>
      <button type="button" disabled={!onResolveItemDeletion || resolvingConflict} onClick={() => void resolveConflict(selectedConflict, false)}>Подтвердить удаление</button>
      <button type="button" disabled={resolvingConflict} onClick={() => setConflictId(undefined)}>Позже</button>
    </WorkspaceDialog>}
    {!showArchive && editingItem && !activeListLocked && <WorkspaceDialog className="e4-editor" label="Редактирование товара" onDismiss={() => { if (!shopping.busy) { shopping.clearError(); setEditingId(null) } }}><h2>Изменить товар</h2><form onSubmit={event => void saveEdit(event, editingItem)}><label htmlFor={`edit-${editingItem.id}`}>Название</label><input id={`edit-${editingItem.id}`} value={editingName} maxLength={120} onChange={event => setEditingName(event.target.value)} disabled={shopping.busy}/><label htmlFor={`quantity-${editingItem.id}`}>Количество</label><input id={`quantity-${editingItem.id}`} type="number" min="0.001" step="any" value={editingQuantity} onChange={event => setEditingQuantity(event.target.value)} disabled={shopping.busy}/><label htmlFor={`unit-${editingItem.id}`}>Единица измерения</label><input id={`unit-${editingItem.id}`} autoCapitalize="none" maxLength={30} value={editingUnit} onChange={event => setEditingUnit(event.target.value)} disabled={shopping.busy}/>
      <div className="item-unit-options" role="group" aria-label="Быстрый выбор единицы измерения">
        {['шт.', 'уп.'].map(unit => <button type="button" key={unit} aria-pressed={editingUnit === unit}
          disabled={shopping.busy} onClick={() => setEditingUnit(unit)}>{unit}</button>)}
      </div>{shopping.error && <p role="alert">{shopping.error}</p>}<button type="submit" disabled={shopping.loading || shopping.busy || !editingName.trim()}>Сохранить</button><button type="button" onClick={() => { shopping.clearError(); setEditingId(null) }} disabled={shopping.busy}>Отмена</button></form></WorkspaceDialog>}
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
