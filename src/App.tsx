import { useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { itemsForList, type Item } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { Storage } from './data/storage'
export function App({ storage }: { storage: Storage }) {
  const [active, setActive] = useState('groceries')
  const [cardSize, setCardSize] = useState<'large' | 'standard'>(() => {
    try { return localStorage.getItem('shopping-card-size') === 'standard' ? 'standard' : 'large' } catch { return 'large' }
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  function chooseCardSize(value: 'large' | 'standard') {
    setCardSize(value)
    try { localStorage.setItem('shopping-card-size', value) } catch { /* private browsing */ }
  }
  const [name, setName] = useState('')
  const [newListName, setNewListName] = useState('')
  const [kind, setKind] = useState<'permanent' | 'oneoff'>('permanent')
  const [showArchive, setShowArchive] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const drag = useRef<{ timer: ReturnType<typeof setTimeout> | null, id: string | null, target: string | null, started: boolean, x: number, y: number }>({ timer: null, id: null, target: null, started: false, x: 0, y: 0 })
  const suppressClick = useRef(false)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const [itemError, setItemError] = useState('')
  const [editing, setEditing] = useState<Item | null>(null)
  const [editName, setEditName] = useState('')
  const [editQuantity, setEditQuantity] = useState('')
  const [editUnit, setEditUnit] = useState('')
  const shopping = useShopping(storage)
  const list = shopping.lists.find(row => row.id === active) ?? shopping.lists[0]
  const rows = list ? itemsForList(shopping.items, list.id) : []
  const remaining = rows.filter(item => !item.purchased).length
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!list) return
    const ok = await shopping.add(list.id, name)
    if (ok) { setName(''); setItemError('') }
    else setItemError('Проверьте название: каждый товар должен содержать от 1 до 120 символов.')
  }
  async function createList(event: FormEvent) {
    event.preventDefault()
    const id = await shopping.createList(newListName, kind)
    if (id) { setActive(id); setNewListName(''); setShowArchive(false) }
  }
  async function saveRename(event: FormEvent) {
    event.preventDefault()
    if (list && renameName.trim() && await shopping.renameList(list, renameName)) setRenaming(false)
  }
  function startPress(event: ReactPointerEvent<HTMLDivElement>, id: string) {
    if (shopping.busy || shopping.loading || event.button !== 0 || (event.target as HTMLElement).closest('.menu-anchor')) return
    if (drag.current.timer) clearTimeout(drag.current.timer)
    drag.current = { timer: null, id, target: id, started: false, x: event.clientX, y: event.clientY }
    drag.current.timer = setTimeout(() => {
      drag.current.started = true
      setMenuOpen(false)
      setDraggingId(id)
      setOverId(id)
      if (navigator.vibrate) navigator.vibrate(15)
    }, 380)
  }
  function movePress(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (!state.id) return
    if (!state.started) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 12) {
        if (state.timer) clearTimeout(state.timer)
        drag.current.id = null
      }
      return
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-list-id]')?.dataset.listId
    if (target) { state.target = target; setOverId(target) }
  }
  function finishPress() {
    const state = drag.current
    if (state.timer) clearTimeout(state.timer)
    if (state.started && state.id) {
      suppressClick.current = true
      if (state.target && state.target !== state.id) void shopping.placeList(state.id, state.target)
      window.setTimeout(() => { suppressClick.current = false }, 0)
    }
    drag.current = { timer: null, id: null, target: null, started: false, x: 0, y: 0 }
    setDraggingId(null)
    setOverId(null)
  }
  function startEdit(item: Item) {
    setEditing(item); setEditName(item.name); setEditQuantity(item.quantity?.toString() ?? ''); setEditUnit(item.unit ?? '')
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (editing && await shopping.edit(editing, editName, editQuantity.trim() ? Number(editQuantity) : undefined, editUnit)) setEditing(null)
  }
  return <main>
    <header><button className="settings-trigger" type="button" aria-label="Настройки" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}>☰</button><div className="header-copy"><div className="brand">ПОКУПКИ · E4 (разработка)</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></div></header>
    {settingsOpen && <section className="settings-panel" aria-label="Настройки приложения"><h2>Настройки</h2><fieldset><legend>Размер карточек</legend><label><input type="radio" name="card-size" checked={cardSize === 'standard'} onChange={() => chooseCardSize('standard')}/> Стандартный (3 в ряд)</label><label><input type="radio" name="card-size" checked={cardSize === 'large'} onChange={() => chooseCardSize('large')}/> Крупный (2 в ряд)</label></fieldset><button type="button" onClick={() => setSettingsOpen(false)}>Закрыть</button></section>}
    <nav className={`lists-grid ${cardSize}`} aria-label="Списки покупок">{shopping.lists.map(row => <div className={`list-tile${draggingId === row.id ? ' dragging' : ''}${overId === row.id && draggingId !== row.id ? ' drag-over' : ''}`} data-list-id={row.id} key={row.id} onPointerDown={event => startPress(event, row.id)} onPointerMove={movePress} onPointerUp={finishPress} onPointerCancel={finishPress}><button className="list-select" title={row.name} aria-pressed={!showArchive && list?.id === row.id} onClick={event => { if (suppressClick.current) { event.preventDefault(); return } setActive(row.id); setName(''); setItemError(''); setMenuOpen(false); setShowArchive(false) }}><span className="list-symbol" aria-hidden="true">{row.symbol}</span><span className="list-name">{row.name}</span></button>{!showArchive && list?.id === row.id && <div className="menu-anchor"><button type="button" className="menu-trigger" aria-label="Действия со списком" aria-expanded={menuOpen} aria-haspopup="menu" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setMenuPosition({ top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 340)), left: Math.max(12, Math.min(rect.right - 280, window.innerWidth - 292)) }); setMenuOpen(open => !open) }}><span aria-hidden="true">•••</span></button>{createPortal(<><button type="button" className="menu-dismiss" aria-label="Закрыть меню" style={{ visibility: menuOpen ? 'visible' : 'hidden' }} onClick={() => setMenuOpen(false)}/><div className="list-menu" style={{ top: menuPosition.top, left: menuPosition.left, visibility: menuOpen ? 'visible' : 'hidden', opacity: menuOpen ? 1 : 0, pointerEvents: menuOpen ? 'auto' : 'none' }} role="menu" aria-label="Действия со списком"><button role="menuitem" onClick={() => { setRenameName(list.name); setMenuOpen(false); setRenaming(true) }}><span aria-hidden="true">✎</span> Переименовать</button><div className="menu-caption">ТИП СПИСКА</div><button role="menuitemradio" aria-checked={list.kind === 'oneoff'} onClick={() => { setMenuOpen(false); void shopping.changeListKind(list, 'oneoff') }}><span aria-hidden="true">⌛</span> Разовый <span className="menu-check">{list.kind === 'oneoff' ? '✓' : ''}</span></button><button role="menuitemradio" aria-checked={list.kind === 'permanent'} onClick={() => { setMenuOpen(false); void shopping.changeListKind(list, 'permanent') }}><span aria-hidden="true">∞</span> Постоянный <span className="menu-check">{list.kind === 'permanent' ? '✓' : ''}</span></button><div className="menu-separator"/><button role="menuitem" onClick={async () => { setMenuOpen(false); if (window.confirm('Завершить список и перенести товары в архив?')) { const ok = await shopping.completeList(list); if (ok && list.kind === 'oneoff') setActive('') } }}><span aria-hidden="true">✓</span> Завершить список</button><button role="menuitem" className="danger" onClick={async () => { setMenuOpen(false); if (window.confirm('Удалить список и активные товары? Архив сохранится.')) { const ok = await shopping.deleteList(list.id); if (ok) setActive('') } }}><span aria-hidden="true">▤</span> Удалить список</button></div></>, document.body)}</div>}</div>)}</nav>
    <div className="e4-actions"><button type="button" aria-pressed={showArchive} onClick={() => setShowArchive(value => !value)}>Архив ({shopping.archives.length})</button></div>
    {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
    {showArchive ? <section aria-label="Архив покупок"><h2>Завершённые списки</h2>{shopping.archives.length === 0 ? <p>Архив пока пуст.</p> : shopping.archives.map(snapshot => <article className="archive-entry" key={snapshot.id}><h3>{snapshot.name}</h3><p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {snapshot.items.length} товаров</p><ul>{snapshot.items.map(item => <li key={item.id}>{item.name}{item.quantity ? ` — ${item.quantity} ${item.unit ?? ''}` : ''}</li>)}</ul></article>)}</section> : list && <section aria-labelledby="list-title">
      <div className="section-heading"><h2 id="list-title">{list.name}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить? (можно несколько строк)</label><div className="input-row"><textarea id="item-name" value={name} onChange={event => { setName(event.target.value); setItemError('') }} placeholder="Например, молоко" rows={2} disabled={shopping.loading || shopping.busy}/><button className="add" disabled={shopping.loading || shopping.busy || !name.trim()} aria-label="Добавить товар">+</button></div>{itemError && <p className="field-error" role="alert">{itemError}</p>}</form>
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}{item.quantity ? ` · ${item.quantity} ${item.unit ?? ''}` : ''}</span></label><button className="e4-small" disabled={shopping.busy} onClick={() => startEdit(item)} aria-label={`Изменить ${item.name}`}>✎</button><button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно завершить список!</p>}
    </section>}
    {renaming && <div className="dialog-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="rename-title" className="rename-dialog"><h2 id="rename-title">Переименовать список</h2><form onSubmit={saveRename}><label htmlFor="rename-name">Название списка</label><div className="rename-input"><input id="rename-name" autoFocus maxLength={120} value={renameName} onChange={event => setRenameName(event.target.value)}/><button type="button" aria-label="Очистить название" title="Очистить название" onClick={() => setRenameName('')}>🧹</button></div><div className="dialog-buttons"><button type="button" onClick={() => setRenaming(false)}>Отмена</button><button disabled={shopping.busy || !renameName.trim()}>Сохранить</button></div></form></section></div>}
    {editing && <section className="e4-editor" aria-label="Редактирование товара"><h2>Изменить товар</h2><form onSubmit={saveEdit}><label htmlFor="edit-name">Название</label><input id="edit-name" value={editName} onChange={event => setEditName(event.target.value)} maxLength={120}/><label htmlFor="edit-quantity">Количество</label><input id="edit-quantity" type="number" min="0.001" step="any" value={editQuantity} onChange={event => setEditQuantity(event.target.value)}/><label htmlFor="edit-unit">Единица измерения</label><input id="edit-unit" value={editUnit} onChange={event => setEditUnit(event.target.value)} maxLength={30}/><div className="e4-actions"><button disabled={shopping.busy}>Сохранить</button><button type="button" onClick={() => setEditing(null)}>Отмена</button></div></form></section>}
    <section className="e4-create" aria-label="Новый список"><h2>Создать список</h2><form onSubmit={createList}><label htmlFor="new-list">Название списка</label><input id="new-list" value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} placeholder="Например, для дачи"/><label htmlFor="list-kind">Тип списка</label><select id="list-kind" value={kind} onChange={event => setKind(event.target.value as 'permanent' | 'oneoff')}><option value="permanent">Постоянный</option><option value="oneoff">Разовый</option></select><button disabled={shopping.busy || shopping.loading || !newListName.trim()}>Создать</button></form></section>
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
