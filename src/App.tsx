import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { lists, itemsForList, type ListId } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { ShoppingListRecord, Storage } from './data/storage'
import { itemStoreForAccount } from './data/account-item-store'
import { cloudAwareItemStore } from './data/cloud-aware-item-store'
export function App({ storage, accountId = null, onQueued, refreshRevision = 0 }: { storage: Storage; accountId?: string | null; onQueued?: () => void; refreshRevision?: number }) {
  return <ShoppingWorkspace key={accountId ?? 'guest'} storage={storage} accountId={accountId} onQueued={onQueued} refreshRevision={refreshRevision} />
}

function ShoppingWorkspace({ storage, accountId, onQueued, refreshRevision }: { storage: Storage; accountId: string | null; onQueued?: () => void; refreshRevision: number }) {
  const [active, setActive] = useState<ListId>('groceries')
  const [localLists, setLocalLists] = useState<ShoppingListRecord[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [newListName, setNewListName] = useState('')
  const [creatingList, setCreatingList] = useState(false)
  const [changingList, setChangingList] = useState(false)
  useEffect(() => {
    if (accountId !== null) return
    let cancelled = false
    void storage.readLists().then(rows => { if (!cancelled) setLocalLists(rows.sort((a, b) => (a.position ?? a.createdAt) - (b.position ?? b.createdAt))) }).catch(error => {
      if (!cancelled) setListError(error instanceof Error ? error.message : 'Не удалось загрузить списки')
    })
    return () => { cancelled = true }
  }, [storage, accountId])
  async function updateLocalList(action: 'rename' | 'kind', listId: string, value: string) {
    if (accountId !== null || changingList) return
    setChangingList(true)
    try {
      if (action === 'rename') await storage.renameList(listId, value)
      else await storage.changeListKind(listId, value as ShoppingListRecord['kind'])
      setLocalLists(await storage.readLists())
      setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось изменить список') }
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
    const list: ShoppingListRecord = { id: crypto.randomUUID(), name: trimmed, symbol: '📝', kind: 'oneoff', createdAt: Date.now(), position: localLists.length }
    setCreatingList(true)
    try {
      await storage.saveList(list)
      setLocalLists(previous => previous ? [...previous, list] : [list])
      setActive(list.id)
      setNewListName('')
      setListError(null)
    } catch (error) { setListError(error instanceof Error ? error.message : 'Не удалось создать список') }
    finally { setCreatingList(false) }
  }
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  // Guest remains the default until a verified auth session is available.
  const itemStore = useMemo(() => accountId === null ? itemStoreForAccount(storage, null) : cloudAwareItemStore(storage, accountId, onQueued), [storage, accountId, onQueued])
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
  return <main>
    <header><div className="brand">ПОКУПКИ · v0.0.1</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></header>
    <nav aria-label="Списки покупок">{visibleLists.map(list => <button key={list.id} aria-pressed={active === list.id} onClick={() => { setActive(list.id); setName('') }}><span aria-hidden="true">{list.symbol}</span>{list.name}</button>)}</nav>
    {accountId === null && <form onSubmit={event => void createLocalList(event)}><label htmlFor="new-list-name">Новый разовый список</label><div className="input-row"><input id="new-list-name" value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} disabled={creatingList || localLists === null}/><button disabled={creatingList || localLists === null || !newListName.trim()}>Создать</button></div></form>}
    {accountId === null && list && <div className="list-toolbar" aria-label="Управление списком"><button type="button" disabled={changingList} onClick={() => { const name = window.prompt('Новое название списка', list.name); if (name !== null) void updateLocalList('rename', list.id, name) }}>Переименовать список</button><button type="button" disabled={changingList} onClick={() => void updateLocalList('kind', list.id, ('kind' in list && list.kind === 'oneoff') ? 'permanent' : 'oneoff')}>Тип: {'kind' in list && list.kind === 'oneoff' ? 'разовый' : 'постоянный'}</button></div>}
    {listError && <p role="alert" className="error">{listError}</p>}
    <section aria-labelledby="list-title">
      <div className="section-heading"><h2 id="list-title">{list?.name ?? 'Списки покупок'}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить?</label><div className="input-row"><input id="item-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, молоко" maxLength={120} autoComplete="off" disabled={shopping.loading || shopping.busy}/><button className="add" disabled={shopping.loading || shopping.busy || !name.trim()} aria-label="Добавить товар">+</button></div></form>
      {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}</span></label>{editingId === item.id ? <form onSubmit={event => void saveEdit(event, item)}><label htmlFor={`edit-${item.id}`}>Новое название</label><input id={`edit-${item.id}`} value={editingName} maxLength={120} onChange={event => setEditingName(event.target.value)} disabled={shopping.busy}/><button type="submit" disabled={shopping.busy || !editingName.trim()}>Сохранить</button><button type="button" onClick={() => setEditingId(null)} disabled={shopping.busy}>Отмена</button></form> : <button type="button" aria-label={`Переименовать ${item.name}`} disabled={shopping.busy} onClick={() => { setEditingId(item.id); setEditingName(item.name) }}>Изменить</button>}<button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно идти домой!</p>}
    </section>
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
