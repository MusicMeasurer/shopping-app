import { useEffect, useMemo, useState, useRef, type FormEvent, type ReactNode, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { placeList, orderLists, orderArchives } from './domain/ordering'
import { lists, itemsForList, type ListId } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { ArchivedListRecord, ShoppingListRecord, Storage } from './data/storage'
import { itemStoreForAccount } from './data/account-item-store'
import { cloudAwareItemStore } from './data/cloud-aware-item-store'
import type { CompletionMode } from './data/cloud-completion-rpc'
import { profileItemStore } from './data/profile-item-store'
import type { LocalProfileRegistry } from './data/local-profiles'
export function App({ storage, accountId = null, onQueued, refreshRevision = 0, headerActions, onCompleteCloudList, cloudBoundLists = {}, completionBusy = false, completionStatus = '', accountCloudLists = [], onCreateCloudList, onChangeCloudList, cloudListBusy = false, cloudListError, cloudArchive, cloudArchiveCount, onOpenCloudArchive }: { storage: Storage; accountId?: string | null; onQueued?: () => void; refreshRevision?: number; headerActions?: ReactNode; onCompleteCloudList?: (listId: ListId, mode: CompletionMode, confirmedMarked?: boolean) => void; cloudBoundLists?: Record<string, string>; completionBusy?: boolean; completionStatus?: string; onCreateCloudList?: (name: string, kind: 'permanent' | 'oneoff') => Promise<boolean>; onChangeCloudList?: (id: string, action: 'rename' | 'kind' | 'reorder', value: string) => Promise<boolean>; cloudListBusy?: boolean; cloudListError?: string; cloudArchive?: ReactNode; cloudArchiveCount?: number; onOpenCloudArchive?: () => void; accountCloudLists?: { id: string; name: string; kind: 'permanent' | 'oneoff' }[] }) {
  // Never mount a legacy guest workspace before resolving the durable cutover
  // marker. Otherwise a stale guest view could attempt writes after cutover.
  const [guestProfile, setGuestProfile] = useState<string | null | undefined>(undefined)
  const [startupError, setStartupError] = useState('')
  const [upgradeBlocked, setUpgradeBlocked] = useState(false)
  const [registry, setRegistry] = useState<LocalProfileRegistry | null>(null)
  const [savedAccount, setSavedAccount] = useState<{
    profileId: string; id: string; bindings: Record<string, string>;
    lists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[]
  } | null>(null)
  useEffect(() => {
    const profile = accountId === null ? registry?.profiles.find(row => row.id === guestProfile) : undefined
    const id = profile?.cloudAccountId
    if (!id || !profile) { setSavedAccount(null); return }
    let cancelled = false
    void storage.readAccountListMappings(id).then(mappings => {
      if (cancelled) return
      const bindings = Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId]))
      const lists = mappings.filter(row => row.metadata).sort((a, b) => a.metadata!.position - b.metadata!.position)
        .map(row => ({ id: row.localListId, name: row.metadata!.name, kind: row.metadata!.kind }))
      setSavedAccount({ profileId: profile.id, id, bindings, lists })
    }).catch(() => { if (!cancelled) setStartupError('Не удалось открыть локальный профиль аккаунта.') })
    return () => { cancelled = true }
  }, [storage, accountId, registry, guestProfile])
  const localAccount = savedAccount?.profileId === guestProfile ? savedAccount : null
  const [profileActionError, setProfileActionError] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
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
    if (profileBusy || !registry || !guestProfile) return
    setProfileBusy(true)
    try {
      const next = await storage.createLocalProfile(crypto.randomUUID(), Date.now())
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
      setStartupError('')
    } catch { setStartupError('Не удалось создать локальный профиль. Данные не изменены.') }
    finally { setProfileBusy(false) }
  }
  async function selectGuestProfile(id: string) {
    if (profileBusy || !registry || !guestProfile || id === guestProfile) return
    setProfileBusy(true)
    try {
      const next = await storage.switchLocalProfile(id)
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
    } catch { setStartupError('Не удалось переключить локальный профиль. Изменения заблокированы.') }
    finally { setProfileBusy(false) }
  }
  async function removeGuestProfile() {
    if (profileBusy || !registry || !guestProfile || registry.profiles[0]?.id === guestProfile) return
    setProfileActionError('')
    if (!window.confirm('Удалить локальные списки и архивы этого профиля с устройства? Облачные данные не удаляются. Неотправленные операции блокируют удаление.')) return
    setProfileBusy(true)
    try {
      const next = await storage.deleteLocalProfile(guestProfile, guestProfile)
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
    } catch (error) {
      setProfileActionError(error instanceof Error && error.message.includes('unsynced operations')
        ? 'Есть неотправленные изменения. Войдите в этот аккаунт и дождитесь синхронизации перед удалением.'
        : 'Не удалось удалить локальную копию профиля. Данные сохранены.')
    }
    finally { setProfileBusy(false) }
  }
  if (accountId === null && startupError) return <main><p role="alert">{startupError}</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined && upgradeBlocked) return <main><p role="alert">Другая открытая вкладка использует старую версию покупок и не даёт безопасно обновить хранилище. Закройте другие вкладки приложения, затем повторите открытие. Ваши покупки не удалены.</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined) return <main><p role="status">Открываем сохранённые покупки…</p></main>
  const profileControls = <>
    {accountId === null && guestProfile && registry && <div className="profile-controls" role="group" aria-label="Локальные профили"><label htmlFor="local-profile-select">Локальный профиль</label> <select id="local-profile-select" value={guestProfile} disabled={profileBusy} onChange={event => void selectGuestProfile(event.target.value)}>{registry.profiles.map((profile, index) => <option key={profile.id} value={profile.id}>{profile.id === registry.profiles[0].id ? 'Мои покупки' : `Локальный профиль ${index + 1}`}</option>)}</select> <button type="button" disabled={profileBusy} onClick={() => void createGuestProfile()}>Добавить профиль</button> {registry.profiles[0]?.id !== guestProfile && <button type="button" disabled={profileBusy} onClick={() => void removeGuestProfile()}>Удалить локальный профиль</button>}</div>}
    {accountId === null && profileActionError && <p role="alert">{profileActionError}</p>}
  </>
  return <>
    {(!registry?.profiles.find(row => row.id === guestProfile)?.cloudAccountId || accountId !== null || localAccount) && <ShoppingWorkspace key={accountId ?? guestProfile ?? 'legacy-guest'} storage={storage} accountId={accountId ?? localAccount?.id ?? null} onCompleteCloudList={onCompleteCloudList} cloudBoundLists={localAccount?.bindings ?? cloudBoundLists} completionBusy={completionBusy} completionStatus={completionStatus} accountCloudLists={localAccount?.lists ?? accountCloudLists} onCreateCloudList={onCreateCloudList} onChangeCloudList={onChangeCloudList} cloudListBusy={cloudListBusy} cloudListError={cloudListError} guestProfileId={accountId === null ? (guestProfile ?? null) : null} onQueued={onQueued} refreshRevision={refreshRevision} headerActions={headerActions} profileControls={profileControls} cloudArchive={cloudArchive} cloudArchiveCount={cloudArchiveCount} onOpenCloudArchive={onOpenCloudArchive} />}
  </>
}

function ShoppingWorkspace({ storage, accountId, guestProfileId, onQueued, refreshRevision, headerActions, onCompleteCloudList, cloudBoundLists, completionBusy, completionStatus, accountCloudLists, onCreateCloudList, onChangeCloudList, cloudListBusy, cloudListError, profileControls, cloudArchive, cloudArchiveCount, onOpenCloudArchive }: { storage: Storage; accountId: string | null; guestProfileId: string | null; onQueued?: () => void; refreshRevision: number; headerActions?: ReactNode; onCompleteCloudList?: (listId: ListId, mode: CompletionMode, confirmedMarked?: boolean) => void; cloudBoundLists: Record<string, string>; completionBusy: boolean; completionStatus: string; onCreateCloudList?: (name: string, kind: 'permanent' | 'oneoff') => Promise<boolean>; onChangeCloudList?: (id: string, action: 'rename' | 'kind' | 'reorder', value: string) => Promise<boolean>; cloudListBusy?: boolean; cloudListError?: string; profileControls?: ReactNode; cloudArchive?: ReactNode; cloudArchiveCount?: number; onOpenCloudArchive?: () => void; accountCloudLists: { id: string; name: string; kind: 'permanent' | 'oneoff' }[] }) {
  const [cardSize, setCardSize] = useState<'large' | 'standard'>(() => {
    try { return localStorage.getItem('shopping-card-size') === 'standard' ? 'standard' : 'large' } catch { return 'large' }
  })
  const [contentSize, setContentSize] = useState<'large' | 'standard'>(() => {
    try { return localStorage.getItem('shopping-content-size') === 'standard' ? 'standard' : 'large' } catch { return 'large' }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  function chooseCardSize(value: 'large' | 'standard') {
    setCardSize(value)
    try { localStorage.setItem('shopping-card-size', value) } catch { /* storage disabled */ }
  }
  function chooseContentSize(value: 'large' | 'standard') {
    setContentSize(value)
    try { localStorage.setItem('shopping-content-size', value) } catch { /* storage disabled */ }
  }
  const [active, setActive] = useState<ListId>('groceries')
  const [localLists, setLocalLists] = useState<ShoppingListRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [newListDialog, setNewListDialog] = useState(false)
  const [newListKind, setNewListKind] = useState<'permanent' | 'oneoff'>('permanent')
  const [changingList, setChangingList] = useState(false)
  const [archives, setArchives] = useState<ArchivedListRecord[]>([])
  const [showArchive, setShowArchive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({top:0,left:0})
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const drag = useRef<{timer: ReturnType<typeof setTimeout> | null,id:string|null,target:string|null,started:boolean,x:number,y:number}>({timer:null,id:null,target:null,started:false,x:0,y:0})
  const suppressClick = useRef(false)
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
  }, [storage, accountId, guestProfileId])
  async function updateLocalList(action: 'rename' | 'kind', listId: string, value: string) {
    if (accountId !== null || changingList) return
    setChangingList(true)
    try {
      if (action === 'rename') {
        if (guestProfileId) await storage.renameProfileList(guestProfileId, listId, value)
        else await storage.renameList(listId, value)
      } else {
        if (guestProfileId) await storage.changeProfileListKind(guestProfileId, listId, value as ShoppingListRecord['kind'])
        else await storage.changeListKind(listId, value as ShoppingListRecord['kind'])
      }
      setLocalLists(guestProfileId ? await storage.readProfileLists(guestProfileId) : await storage.readLists())
      setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось изменить список') }
    finally { setChangingList(false) }
  }
  async function changeList(action: 'rename' | 'kind', id: ListId, value: string) {
    if (accountId === null) {
      await updateLocalList(action, id, value)
      return true
    }
    return await onChangeCloudList?.(id, action, value) ?? false
  }

  async function submitNewList(event: FormEvent) {
    if (accountId === null) return createLocalList(event)
    event.preventDefault()
    if (await onCreateCloudList?.(newListName, newListKind)) setNewListDialog(false)
  }

  async function completeLocalList() {
    if (accountId !== null || !list || changingList || shopping.busy || shopping.loading) return
    if (!rows.length) { window.alert('Список пуст. Его нельзя поместить в архив.'); return }
    if (!window.confirm('Завершить список и перенести товары в архив?')) return
    setChangingList(true)
    try {
      if (guestProfileId) await storage.completeProfileList(guestProfileId, list.id, crypto.randomUUID(), Date.now())
      else await storage.completeList(list as ShoppingListRecord, crypto.randomUUID(), Date.now())
      const [updatedLists, snapshots] = await Promise.all([guestProfileId ? storage.readProfileLists(guestProfileId) : storage.readLists(), guestProfileId ? storage.readProfileArchives(guestProfileId) : storage.readArchives()])
      setLocalLists(updatedLists)
      setArchives(snapshots.sort((a, b) => b.completedAt - a.completedAt))
      setListError(null)
      await shopping.reload()
      if ('kind' in list && list.kind === 'oneoff') setActive(updatedLists[0]?.id ?? '')
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось завершить список') }
    finally { setChangingList(false) }
  }
  async function deleteLocalList() {
    if (accountId !== null || !list || changingList || !window.confirm('Удалить список и активные товары? Архив сохранится.')) return
    setChangingList(true)
    try {
      if (guestProfileId) await storage.deleteProfileList(guestProfileId, list.id)
      else await storage.deleteList(list.id)
      const next = guestProfileId ? await storage.readProfileLists(guestProfileId) : await storage.readLists()
      setLocalLists(orderLists(next)); setActive(next[0]?.id ?? ''); setMenuOpen(false)
      await shopping.reload(); setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось удалить список') }
    finally { setChangingList(false) }
  }
  async function placeLocalList(id: string, target: string) {
    if (accountId !== null || !localLists || changingList) return
    const next = placeList(localLists,id,target)
    if (next.every((row,i)=>row.id===localLists[i]?.id)) return
    setChangingList(true)
    try {
      if (guestProfileId) {
        await storage.reorderProfileLists(guestProfileId,next)
      } else await storage.reorderLists(next)
      setLocalLists(next); setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось изменить порядок списков') }
    finally { setChangingList(false) }
  }
  function startPress(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if ((accountId !== null && !onChangeCloudList) || changingList || cloudListBusy || event.button !== 0 || (event.target as HTMLElement).closest('.menu-anchor')) return
    if (drag.current.timer) clearTimeout(drag.current.timer)
    drag.current={timer:null,id,target:id,started:false,x:event.clientX,y:event.clientY}
    const element=event.currentTarget,pointerId=event.pointerId
    drag.current.timer=setTimeout(()=>{
      if (drag.current.id!==id) return
      try {element.setPointerCapture(pointerId)} catch {/* pointer ended */}
      drag.current.started=true;setDraggingId(id);setOverId(id);setMenuOpen(false)
      if(navigator.vibrate) navigator.vibrate(15)
    },380)
  }
  function movePress(event: ReactPointerEvent<HTMLDivElement>) {
    const state=drag.current
    if(!state.id)return
    if(!state.started){if(Math.hypot(event.clientX-state.x,event.clientY-state.y)>12){if(state.timer)clearTimeout(state.timer);drag.current.id=null}return}
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-list-id]')?.dataset.listId
    if(target){state.target=target;setOverId(target)}
  }
  function finishPress(){
    const state=drag.current
    if(state.timer)clearTimeout(state.timer)
    if(state.started&&state.id){suppressClick.current=true;if(state.target&&state.target!==state.id){if(accountId===null)void placeLocalList(state.id,state.target);else void onChangeCloudList?.(state.id,'reorder',state.target)};window.setTimeout(()=>{suppressClick.current=false},0)}
    drag.current={timer:null,id:null,target:null,started:false,x:0,y:0};setDraggingId(null);setOverId(null)
  }
  function openArchive() {
    setShowArchive(true)
    onOpenCloudArchive?.()
  }
  function startSwipe(event:ReactTouchEvent<HTMLElement>){
    const target=event.target as HTMLElement
    if((accountId!==null&&!cloudArchive)||event.touches.length!==1||target.closest('input,textarea,select,[role="dialog"],.list-menu,.menu-anchor,.settings-panel,.dialog-backdrop')||menuOpen||settingsOpen||newListDialog||renaming||editingId){swipe.current=null;return}
    swipe.current={x:event.touches[0].clientX,y:event.touches[0].clientY}
  }
  function endSwipe(event:ReactTouchEvent<HTMLElement>){
    const origin=swipe.current;swipe.current=null
    if(!origin||event.changedTouches.length!==1||draggingId)return
    const dx=event.changedTouches[0].clientX-origin.x,dy=event.changedTouches[0].clientY-origin.y
    if(Math.abs(dx)<45||Math.abs(dx)<Math.abs(dy)*1.2)return
    if(dx<0&&!showArchive){openArchive();setMenuOpen(false)}
    if(dx>0&&showArchive)setShowArchive(false)
  }
  const visibleLists = accountId === null && localLists !== null ? localLists : (accountId !== null && accountCloudLists.length ? accountCloudLists.map(row => ({ ...row, symbol: '🛒' })) : lists)
  useEffect(() => {
    if (visibleLists.length && !visibleLists.some(list => list.id === active)) setActive(visibleLists[0].id)
  }, [visibleLists, active])
  async function createLocalList(event: FormEvent) {
    event.preventDefault()
    if (accountId !== null || !localLists || creatingList) return
    const trimmed = newListName.trim()
    if (!trimmed || trimmed.length > 120) { setListError('Введите название списка от 1 до 120 символов.'); return }
    const list: ShoppingListRecord = { id: crypto.randomUUID(), name: trimmed, symbol: '🛒', kind: newListKind, createdAt: Date.now(), position: localLists.length }
    setCreatingList(true)
    try {
      if (guestProfileId) await storage.saveProfileList(guestProfileId, list)
      else await storage.saveList(list)
      setLocalLists(previous => previous ? [...previous, list] : [list])
      setActive(list.id)
      setNewListName('')
      setNewListDialog(false)
      setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось создать список') }
    finally { setCreatingList(false) }
  }
  const [name, setName] = useState('')
  const [itemError, setItemError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingQuantity, setEditingQuantity] = useState('')
  const [editingUnit, setEditingUnit] = useState('')
  // Guest remains the default until a verified auth session is available.
  const itemStore = useMemo(() => accountId === null ? (guestProfileId ? profileItemStore(storage, guestProfileId) : itemStoreForAccount(storage, null)) : cloudAwareItemStore(storage, accountId, onQueued), [storage, accountId, guestProfileId, onQueued])
  const shopping = useShopping(itemStore, refreshRevision)
  const rows = itemsForList(shopping.items, active)
  const [deleteCloudListId, setDeleteCloudListId] = useState<ListId | null>(null)
  const [cloudCompletionOpen, setCloudCompletionOpen] = useState(false)
  const canCompleteCloud = accountId !== null && !!cloudBoundLists[active] && !!onCompleteCloudList
  const canEditList = accountId === null || !!onChangeCloudList
  const listActionsBusy = changingList || cloudListBusy
  function requestCompletion() {
    if (accountId === null) void completeLocalList()
    else if (canCompleteCloud) setCloudCompletionOpen(true)
  }
  function requestDeletion() {
    if (accountId === null) void deleteLocalList()
    else if (canCompleteCloud) setDeleteCloudListId(active)
  }
  const editingItem = rows.find(item => item.id === editingId)
  const hasMarkedItems = rows.some(item => item.purchased)
  const remaining = rows.filter(item => !item.purchased).length
  const list = visibleLists.find(list => list.id === active)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (accountId !== null && !cloudBoundLists[active]) { setItemError('Для добавления товаров сначала требуется безопасная привязка облачного списка.'); return }
    if (await shopping.add(active, name)) { setName(''); setItemError('') }
    else setItemError('Проверьте название: каждый товар должен содержать от 1 до 120 символов.')
  }
  async function saveEdit(event: FormEvent, item: typeof shopping.items[number]) {
    event.preventDefault()
    if (await shopping.edit(item, editingName, editingQuantity.trim() ? Number(editingQuantity) : undefined, editingUnit)) {
      setEditingId(null); setEditingName(''); setEditingQuantity(''); setEditingUnit('')
    }
  }
  return <main className={`shopping-e4 content-${contentSize}`} onTouchStart={startSwipe} onTouchEnd={endSwipe}>
    <header><button className="settings-trigger" type="button" aria-label="Настройки" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}>☰</button><div className="header-copy"><div className="brand">ПОКУПКИ · E4 (разработка)</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></div>{headerActions}</header>
    {settingsOpen && <section className="settings-panel" aria-label="Настройки приложения">
      <h2>Настройки</h2>
      <fieldset><legend>Размер карточек списков</legend>
        <label><input type="radio" name="card-size" checked={cardSize === 'standard'} onChange={() => chooseCardSize('standard')}/> Стандартный (3 в ряд)</label>
        <label><input type="radio" name="card-size" checked={cardSize === 'large'} onChange={() => chooseCardSize('large')}/> Крупный (2 в ряд)</label>
      </fieldset>
      <fieldset><legend>Размер содержимого списка покупок</legend>
        <label><input type="radio" name="content-size" checked={contentSize === 'standard'} onChange={() => chooseContentSize('standard')}/> Стандартный</label>
        <label><input type="radio" name="content-size" checked={contentSize === 'large'} onChange={() => chooseContentSize('large')}/> Крупный</label>
      </fieldset>
      {profileControls}
      <button type="button" onClick={() => setSettingsOpen(false)}>Закрыть</button>
    </section>}
    {(accountId === null || cloudArchive) && <div className="section-switch" aria-label="Разделы приложения"><button type="button" aria-label="Основные списки" aria-current={!showArchive ? 'page' : undefined} className={!showArchive ? 'current' : ''} onClick={() => setShowArchive(false)}>●</button><button type="button" aria-label={`Архив, ${accountId === null ? archives.length : (cloudArchiveCount ?? 0)} завершённых списков`} aria-current={showArchive ? 'page' : undefined} className={showArchive ? 'current' : ''} onClick={openArchive}>●</button></div>}
    {!showArchive && accountId !== null && !onCreateCloudList && <p role="status">Для создания, переименования и удаления облачных списков войдите в этот аккаунт. Товары в сохранённых списках доступны.</p>}
    {!showArchive && <nav className={`lists-grid ${cardSize}`} aria-label="Списки покупок" onPointerMove={movePress} onPointerUp={finishPress} onPointerCancel={finishPress}>
      {visibleLists.map(row => <div className={`list-tile${draggingId===row.id?' dragging':''}${overId===row.id&&draggingId!==row.id?' drag-over':''}`} data-list-id={row.id} key={row.id} onPointerDown={event=>startPress(event,row.id)} onPointerMove={movePress} onPointerUp={finishPress} onPointerCancel={finishPress}>
        <button className="list-select" title={row.name} aria-pressed={active===row.id} onClick={event=>{if(suppressClick.current){event.preventDefault();return}setActive(row.id);setName('');setMenuOpen(false)}}><span className="list-symbol" aria-hidden="true">{row.symbol}</span><span className="list-name-wrap"><span className="list-name">{row.name}</span></span></button>
        {active===row.id&&<div className="menu-anchor"><button type="button" className="menu-trigger" aria-label="Действия со списком" aria-expanded={menuOpen} aria-haspopup="menu" onClick={event=>{const rect=event.currentTarget.getBoundingClientRect();setMenuPosition({top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-340)),left:Math.max(12,Math.min(rect.right-280,window.innerWidth-292))});setMenuOpen(open=>!open)}}><span aria-hidden="true">•••</span></button>{createPortal(<><button type="button" className="menu-dismiss" aria-label="Закрыть меню" style={{visibility:menuOpen?'visible':'hidden'}} onClick={()=>setMenuOpen(false)}/><div className="list-menu" role="menu" aria-label="Действия со списком" style={{top:menuPosition.top,left:menuPosition.left,visibility:menuOpen?'visible':'hidden',opacity:menuOpen?1:0,pointerEvents:menuOpen?'auto':'none'}}><button disabled={!canEditList || listActionsBusy} role="menuitem" onClick={()=>{setRenameName(row.name);setRenaming(true);setMenuOpen(false)}}>✎ Переименовать</button><div className="menu-caption">ТИП СПИСКА</div><button disabled={!canEditList || listActionsBusy} role="menuitemradio" aria-checked={'kind' in row && row.kind==='oneoff'} onClick={()=>{setMenuOpen(false);void changeList('kind',row.id,'oneoff')}}>⌛ Разовый {'kind' in row && row.kind==='oneoff'?'✓':''}</button><button disabled={!canEditList || listActionsBusy} role="menuitemradio" aria-checked={'kind' in row && row.kind==='permanent'} onClick={()=>{setMenuOpen(false);void changeList('kind',row.id,'permanent')}}>∞ Постоянный {'kind' in row && row.kind==='permanent'?'✓':''}</button><div className="menu-separator"/><button disabled={accountId !== null && !canCompleteCloud} role="menuitem" onClick={()=>{setMenuOpen(false);requestCompletion()}}>✓ Завершить список</button><button disabled={accountId !== null && !canCompleteCloud} role="menuitem" className="danger" onClick={()=>{setMenuOpen(false);requestDeletion()}}>▤ Удалить список</button></div></>,document.body)}</div>}
      </div>)}
      <div className="list-tile create-tile"><button type="button" className="list-select create-list-tile" aria-label="Новый список" disabled={accountId !== null && !onCreateCloudList} onClick={()=>{setNewListName('');setNewListKind('permanent');setNewListDialog(true)}}><span className="create-plus" aria-hidden="true">+</span><span className="list-name">Новый список</span></button></div>
    </nav>}
    {newListDialog && <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewListDialog(false) }}>
      <section className="rename-dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="new-list-title">
        <div className="account-dialog-heading"><h2 id="new-list-title">Создать список</h2><button type="button" aria-label="Закрыть создание списка" onClick={() => setNewListDialog(false)}>×</button></div>
        <form onSubmit={event => void submitNewList(event)}>
          <label htmlFor="new-list-name">Название списка</label>
          <input id="new-list-name" autoFocus value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} required disabled={creatingList || cloudListBusy || (accountId === null && localLists === null)}/>
          <label htmlFor="new-list-kind">Тип списка</label>
          <select id="new-list-kind" value={newListKind} onChange={event => setNewListKind(event.target.value as 'permanent' | 'oneoff')}>
            <option value="permanent">Постоянный</option><option value="oneoff">Разовый</option>
          </select>
          <button disabled={creatingList || cloudListBusy || (accountId === null && localLists === null) || !newListName.trim()}>Создать</button>
          <button type="button" onClick={() => setNewListDialog(false)}>Отмена</button>
          {cloudListError && <p role="alert">{cloudListError}</p>}
        </form>
      </section>
    </div>}
    {renaming && canEditList && list && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="rename-title" className="rename-dialog"><h2 id="rename-title">Переименовать список</h2><form onSubmit={event=>{event.preventDefault();if(renameName.trim()){void changeList('rename',list.id,renameName).then(saved=>{if(saved)setRenaming(false)})}}}><label htmlFor="rename-name">Название списка</label><div className="rename-input"><input id="rename-name" autoFocus maxLength={120} value={renameName} onChange={event=>setRenameName(event.target.value)}/><button type="button" aria-label="Очистить название" onClick={()=>setRenameName('')}>🧹</button></div><div className="dialog-buttons"><button type="button" onClick={()=>setRenaming(false)}>Отмена</button><button disabled={listActionsBusy||!renameName.trim()}>Сохранить</button></div></form></section></div>}
    {cloudListError && !newListDialog && <p role="alert">{cloudListError}</p>}
    {listError && <p role="alert" className="error">{listError}</p>}
    {showArchive && accountId !== null && cloudArchive ? cloudArchive : showArchive && accountId === null ? <section aria-label="Архив покупок"><h2>Завершённые списки</h2>{archives.length === 0 ? <p>Архив пока пуст.</p> : archives.map(snapshot => <article key={snapshot.id} className="archive-entry"><h3>{snapshot.name}</h3><p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {snapshot.items.length} товаров</p><ul>{snapshot.items.map(item => <li key={item.id}>{item.name}{item.quantity ? ` — ${item.quantity} ${item.unit ?? ''}` : ''}</li>)}</ul></article>)}</section> : <section aria-labelledby="list-title">
      <div className="section-heading"><div className="list-heading-copy"><h2 id="list-title">{list?.name ?? 'Списки покупок'}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>{canCompleteCloud && cloudCompletionOpen && onCompleteCloudList && <div className="dialog-backdrop"><section className="rename-dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-completion-title"><h2 id="cloud-completion-title">Завершить список</h2><div className="dialog-buttons">
        <button type="button" disabled={shopping.loading || shopping.busy || completionBusy} onClick={()=>{setCloudCompletionOpen(false);onCompleteCloudList(active,'marked_only')}}>Завершить: отмеченные</button>
        <button type="button" disabled={shopping.loading || shopping.busy || completionBusy} onClick={()=>{setCloudCompletionOpen(false);onCompleteCloudList(active,'all_purchased')}}>Завершить: всё куплено</button>
        <button type="button" disabled={shopping.loading || shopping.busy || completionBusy} onClick={()=>{setCloudCompletionOpen(false);onCompleteCloudList(active,'none_purchased')}}>Завершить: ничего не куплено</button>
        <button type="button" onClick={()=>setCloudCompletionOpen(false)}>Отмена</button></div></section></div>}
        {canCompleteCloud && onCompleteCloudList && deleteCloudListId === active && <div className="dialog-backdrop">

          <section role="dialog" aria-modal="true" aria-labelledby="cloud-delete-title" className="rename-dialog">
            <h2 id="cloud-delete-title">Удалить список?</h2>
            <p>Активные товары будут удалены. Сохранённые покупки останутся в архиве.</p>
            {hasMarkedItems && <p>Отмеченные товары не попадут в историю покупок. Чтобы сохранить их, сначала завершите список.</p>}
            <div className="dialog-buttons">
              {hasMarkedItems && <button type="button" onClick={() => {
                setDeleteCloudListId(null)
                onCompleteCloudList(active, 'marked_only')
              }}>Завершить отмеченные</button>}
              <button type="button" onClick={() => setDeleteCloudListId(null)}>Отмена</button>
              <button type="button" className="danger" disabled={shopping.loading || shopping.busy || completionBusy} onClick={() => {
                setDeleteCloudListId(null)
                onCompleteCloudList(active, 'delete_list', hasMarkedItems)
              }}>Удалить</button>
            </div>
          </section>
        </div>}
      {accountId!==null&&completionStatus&&<p role="status">{completionStatus}</p>}{list&&<div className="list-toolbar" aria-label="Управление текущим списком"><button type="button" aria-label="Переименовать список" title="Переименовать" disabled={!canEditList || listActionsBusy} onClick={()=>{setRenameName(list.name);setRenaming(true)}}>✎</button><button type="button" aria-label={`Тип списка: ${'kind' in list&&list.kind==='oneoff'?'Разовый':'Постоянный'}. Изменить тип`} title="Изменить тип" disabled={!canEditList || listActionsBusy} onClick={()=>void changeList('kind',list.id,'kind' in list&&list.kind==='oneoff'?'permanent':'oneoff')}>{'kind' in list&&list.kind==='oneoff'?'⌛':'∞'}</button><button type="button" aria-label="Завершить список" title="Завершить список" disabled={listActionsBusy || (accountId !== null && (!canCompleteCloud || completionBusy))} onClick={requestCompletion}>✓</button><button type="button" className="danger" aria-label="Удалить список" title="Удалить список" disabled={listActionsBusy || (accountId !== null && (!canCompleteCloud || completionBusy))} onClick={requestDeletion}><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v7m4-7v7"/></svg></button></div>}</div>
      {accountId !== null && list && !cloudBoundLists[active] && <p role="status">Облачный список доступен для просмотра. Добавление товаров станет доступно после подтверждённой привязки к локальному хранилищу.</p>}
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить? (можно несколько строк)</label><div className="input-row"><textarea id="item-name" value={name} onChange={event => {setName(event.target.value);setItemError('')}} placeholder="Например, молоко" rows={2} disabled={shopping.loading || shopping.busy}/><button className="add" disabled={shopping.loading || shopping.busy || !name.trim() || (accountId !== null && !cloudBoundLists[active])} aria-label="Добавить товар">+</button></div>{itemError && <p className="field-error" role="alert">{itemError}</p>}</form>
      {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}{item.quantity !== undefined || item.unit ? ` · ${[item.quantity, item.unit].filter(value => value !== undefined).join(' ')}` : ''}</span></label>{<button type="button" aria-label={`Изменить ${item.name}`} disabled={shopping.busy} onClick={() => { setEditingId(item.id); setEditingName(item.name); setEditingQuantity(item.quantity?.toString() ?? ''); setEditingUnit(item.unit ?? '') }} className="e4-small">✎</button>}<button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно завершить список!</p>}
    </section>}
    {!showArchive && editingItem && <section className="e4-editor" aria-label="Редактирование товара"><h2>Изменить товар</h2><form onSubmit={event => void saveEdit(event, editingItem)}><label htmlFor={`edit-${editingItem.id}`}>Название</label><input id={`edit-${editingItem.id}`} value={editingName} maxLength={120} onChange={event => setEditingName(event.target.value)} disabled={shopping.busy}/><label htmlFor={`quantity-${editingItem.id}`}>Количество</label><input id={`quantity-${editingItem.id}`} type="number" min="0.001" step="any" value={editingQuantity} onChange={event => setEditingQuantity(event.target.value)} disabled={shopping.busy}/><label htmlFor={`unit-${editingItem.id}`}>Единица измерения</label><input id={`unit-${editingItem.id}`} maxLength={30} value={editingUnit} onChange={event => setEditingUnit(event.target.value)} disabled={shopping.busy}/><button type="submit" disabled={shopping.busy || !editingName.trim()}>Сохранить</button><button type="button" onClick={() => setEditingId(null)} disabled={shopping.busy}>Отмена</button></form></section>}
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
