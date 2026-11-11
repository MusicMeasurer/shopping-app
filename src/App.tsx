import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { lists, itemsForList, type ListId } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { ArchivedListRecord, ShoppingListRecord, Storage } from './data/storage'
import { itemStoreForAccount } from './data/account-item-store'
import { cloudAwareItemStore } from './data/cloud-aware-item-store'
import { profileItemStore } from './data/profile-item-store'
import type { LocalProfileRegistry } from './data/local-profiles'
export function App({ storage, accountId = null, onQueued, refreshRevision = 0, headerActions }: { storage: Storage; accountId?: string | null; onQueued?: () => void; refreshRevision?: number; headerActions?: ReactNode }) {
  // Never mount a legacy guest workspace before resolving the durable cutover
  // marker. Otherwise a stale guest view could attempt writes after cutover.
  const [guestProfile, setGuestProfile] = useState<string | null | undefined>(undefined)
  const [startupError, setStartupError] = useState('')
  const [upgradeBlocked, setUpgradeBlocked] = useState(false)
  const [registry, setRegistry] = useState<LocalProfileRegistry | null>(null)
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
      // A guest session must never expose a cloud-bound profile without verification.
      setGuestProfile(id ? (active?.cloudAccountId === null ? active.id : id) : null)
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
    if (!window.confirm('Удалить локальные списки и архивы этого профиля с устройства? Облачные данные не удаляются. Неотправленные операции блокируют удаление.')) return
    setProfileBusy(true)
    try {
      const next = await storage.deleteLocalProfile(guestProfile, guestProfile)
      setRegistry(next)
      setGuestProfile(next.activeProfileId)
    } catch { setStartupError('Не удалось удалить профиль. Возможно, есть неотправленные изменения. Данные сохранены.') }
    finally { setProfileBusy(false) }
  }
  if (accountId === null && startupError) return <main><p role="alert">{startupError}</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined && upgradeBlocked) return <main><p role="alert">Другая открытая вкладка использует старую версию покупок и не даёт безопасно обновить хранилище. Закройте другие вкладки приложения, затем повторите открытие. Ваши покупки не удалены.</p><button type="button" onClick={() => window.location.reload()}>Повторить открытие</button></main>
  if (accountId === null && guestProfile === undefined) return <main><p role="status">Открываем сохранённые покупки…</p></main>
  return <>
    {accountId === null && guestProfile && registry && <section aria-label="Локальные профили"><label htmlFor="local-profile-select">Локальный профиль</label> <select id="local-profile-select" value={guestProfile} disabled={profileBusy} onChange={event => void selectGuestProfile(event.target.value)}>{registry.profiles.filter(p => p.cloudAccountId === null).map((profile, index) => <option key={profile.id} value={profile.id}>{profile.id === registry.profiles[0].id ? 'Мои покупки' : `Локальный профиль ${index + 1}`}</option>)}</select> <button type="button" disabled={profileBusy} onClick={() => void createGuestProfile()}>Добавить профиль</button> {registry.profiles[0]?.id !== guestProfile && <button type="button" disabled={profileBusy} onClick={() => void removeGuestProfile()}>Удалить локальный профиль</button>}</section>}
    <ShoppingWorkspace key={accountId ?? guestProfile ?? 'legacy-guest'} storage={storage} accountId={accountId} guestProfileId={accountId === null ? (guestProfile ?? null) : null} onQueued={onQueued} refreshRevision={refreshRevision} headerActions={headerActions} />
  </>
}

function ShoppingWorkspace({ storage, accountId, guestProfileId, onQueued, refreshRevision, headerActions }: { storage: Storage; accountId: string | null; guestProfileId: string | null; onQueued?: () => void; refreshRevision: number; headerActions?: ReactNode }) {
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
  useEffect(() => {
    if (accountId !== null) return
    let cancelled = false
    void Promise.all([guestProfileId ? storage.readProfileLists(guestProfileId) : storage.readLists(), guestProfileId ? storage.readProfileArchives(guestProfileId) : storage.readArchives()]).then(([rows, snapshots]) => {
      if (!cancelled) {
        setLocalLists(rows.sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt)))
        setArchives(snapshots.sort((a, b) => b.completedAt - a.completedAt))
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
  async function completeLocalList() {
    if (accountId !== null || !list || changingList || shopping.busy || shopping.loading) return
    if (!rows.length) { setListError('Пустой список нельзя завершить.'); return }
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
  const visibleLists = accountId === null && localLists !== null ? localLists : lists
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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // Guest remains the default until a verified auth session is available.
  const itemStore = useMemo(() => accountId === null ? (guestProfileId ? profileItemStore(storage, guestProfileId) : itemStoreForAccount(storage, null)) : cloudAwareItemStore(storage, accountId, onQueued), [storage, accountId, guestProfileId, onQueued])
  const shopping = useShopping(itemStore, refreshRevision)
  const rows = itemsForList(shopping.items, active)
  const remaining = rows.filter(item => !item.purchased).length
  const list = visibleLists.find(list => list.id === active)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await shopping.add(active, name)) setName('')
  }
  async function saveEdit(event: FormEvent, item: typeof shopping.items[number]) {
    event.preventDefault()
    if (await shopping.rename(item, editingName)) { setEditingId(null); setEditingName('') }
  }
  return <main className={`shopping-e4 content-${contentSize}`}>
    <header><div className="app-topbar"><button type="button" className="settings-trigger" aria-label="Настройки" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}>☰</button><div className="brand">ПОКУПКИ · E4 (разработка)</div>{headerActions}</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></header>
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
      <button type="button" onClick={() => setSettingsOpen(false)}>Закрыть</button>
    </section>}
    {accountId === null && <div className="section-switch" aria-label="Разделы приложения"><button type="button" aria-pressed={!showArchive} onClick={() => setShowArchive(false)}>Активные списки</button><button type="button" aria-pressed={showArchive} onClick={() => setShowArchive(true)}>Архив ({archives.length})</button></div>}
    {!showArchive && <nav className={`lists-grid ${cardSize}`} aria-label="Списки покупок">
      {visibleLists.map(list => <button key={list.id} aria-pressed={active === list.id} onClick={() => { setActive(list.id); setName('') }}><span aria-hidden="true">{list.symbol}</span>{list.name}</button>)}
      {accountId === null && <button type="button" className="create-list-tile" onClick={() => { setNewListName(''); setNewListKind('permanent'); setNewListDialog(true) }}><span aria-hidden="true">＋</span>Новый список</button>}
    </nav>}
    {accountId === null && newListDialog && <div className="account-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setNewListDialog(false) }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="new-list-title">
        <div className="account-dialog-heading"><h2 id="new-list-title">Новый список</h2><button type="button" aria-label="Закрыть создание списка" onClick={() => setNewListDialog(false)}>×</button></div>
        <form onSubmit={event => void createLocalList(event)}>
          <label htmlFor="new-list-name">Название списка</label>
          <input id="new-list-name" autoFocus value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} required disabled={creatingList || localLists === null}/>
          <label htmlFor="new-list-kind">Тип списка</label>
          <select id="new-list-kind" value={newListKind} onChange={event => setNewListKind(event.target.value as 'permanent' | 'oneoff')}>
            <option value="permanent">Постоянный</option><option value="oneoff">Разовый</option>
          </select>
          <button disabled={creatingList || localLists === null || !newListName.trim()}>Создать</button>
          <button type="button" onClick={() => setNewListDialog(false)}>Отмена</button>
        </form>
      </section>
    </div>}
    {!showArchive && accountId === null && list && <div className="list-toolbar" aria-label="Управление списком"><button type="button" disabled={changingList} onClick={() => { const name = window.prompt('Новое название списка', list.name); if (name !== null) void updateLocalList('rename', list.id, name) }}>Переименовать список</button><button type="button" disabled={changingList} onClick={() => void updateLocalList('kind', list.id, ('kind' in list && list.kind === 'oneoff') ? 'permanent' : 'oneoff')}>Тип: {'kind' in list && list.kind === 'oneoff' ? 'разовый' : 'постоянный'}</button><button type="button" disabled={changingList || shopping.busy || shopping.loading || rows.length === 0} onClick={() => void completeLocalList()}>Завершить список</button></div>}
    {listError && <p role="alert" className="error">{listError}</p>}
    {showArchive && accountId === null ? <section aria-label="Архив покупок"><h2>Завершённые списки</h2>{archives.length === 0 ? <p>Архив пока пуст.</p> : archives.map(snapshot => <article key={snapshot.id} className="archive-entry"><h3>{snapshot.name}</h3><p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {snapshot.items.length} товаров</p><ul>{snapshot.items.map(item => <li key={item.id}>{item.name}{item.quantity ? ` — ${item.quantity} ${item.unit ?? ''}` : ''}</li>)}</ul></article>)}</section> : <section aria-labelledby="list-title">
      <div className="section-heading"><h2 id="list-title">{list?.name ?? 'Списки покупок'}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить?{accountId === null ? " (можно несколько строк)" : ""}</label><div className="input-row">{accountId === null ? <textarea id="item-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, молоко 2 л" rows={2} disabled={shopping.loading || shopping.busy}/> : <input id="item-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, молоко" maxLength={120} autoComplete="off" disabled={shopping.loading || shopping.busy}/> }<button className="add" disabled={shopping.loading || shopping.busy || !name.trim()} aria-label="Добавить товар">+</button></div></form>
      {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}{item.quantity ? ` · ${item.quantity} ${item.unit ?? ''}` : ''}</span></label>{editingId === item.id ? <form onSubmit={event => void saveEdit(event, item)}><label htmlFor={`edit-${item.id}`}>Новое название</label><input id={`edit-${item.id}`} value={editingName} maxLength={120} onChange={event => setEditingName(event.target.value)} disabled={shopping.busy}/><button type="submit" disabled={shopping.busy || !editingName.trim()}>Сохранить</button><button type="button" onClick={() => setEditingId(null)} disabled={shopping.busy}>Отмена</button></form> : <button type="button" aria-label={`Переименовать ${item.name}`} disabled={shopping.busy} onClick={() => { setEditingId(item.id); setEditingName(item.name) }}>Изменить</button>}<button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно идти домой!</p>}
    </section>}
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
