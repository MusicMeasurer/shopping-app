import { useState, type FormEvent } from 'react'
import { itemsForList, type Item } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { Storage } from './data/storage'
export function App({ storage }: { storage: Storage }) {
  const [active, setActive] = useState('groceries')
  const [name, setName] = useState('')
  const [newListName, setNewListName] = useState('')
  const [kind, setKind] = useState<'permanent' | 'oneoff'>('permanent')
  const [showArchive, setShowArchive] = useState(false)
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
    if (list && await shopping.add(list.id, name)) setName('')
  }
  async function createList(event: FormEvent) {
    event.preventDefault()
    const id = await shopping.createList(newListName, kind)
    if (id) { setActive(id); setNewListName(''); setShowArchive(false) }
  }
  function startEdit(item: Item) {
    setEditing(item); setEditName(item.name); setEditQuantity(item.quantity?.toString() ?? ''); setEditUnit(item.unit ?? '')
  }
  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (editing && await shopping.edit(editing, editName, editQuantity.trim() ? Number(editQuantity) : undefined, editUnit)) setEditing(null)
  }
  return <main>
    <header><div className="brand">ПОКУПКИ · E4 (разработка)</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></header>
    <nav aria-label="Списки покупок">{shopping.lists.map(row => <button key={row.id} aria-pressed={!showArchive && list?.id === row.id} onClick={() => { setActive(row.id); setName(''); setShowArchive(false) }}><span aria-hidden="true">{row.symbol}</span>{row.name}</button>)}</nav>
    <div className="e4-actions"><button type="button" aria-pressed={showArchive} onClick={() => setShowArchive(value => !value)}>Архив ({shopping.archives.length})</button></div>
    {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
    {showArchive ? <section aria-label="Архив покупок"><h2>Завершённые списки</h2>{shopping.archives.length === 0 ? <p>Архив пока пуст.</p> : [...shopping.archives].reverse().map(snapshot => <article className="archive-entry" key={snapshot.id}><h3>{snapshot.name}</h3><p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {snapshot.items.length} товаров</p><ul>{snapshot.items.map(item => <li key={item.id}>{item.name}{item.quantity ? ` — ${item.quantity} ${item.unit ?? ''}` : ''}</li>)}</ul></article>)}</section> : list && <section aria-labelledby="list-title">
      <div className="section-heading"><h2 id="list-title">{list.name}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>
      <div className="e4-actions"><label htmlFor="active-list-kind">Тип текущего списка</label><select id="active-list-kind" value={list.kind} disabled={shopping.busy || shopping.loading} onChange={event => void shopping.changeListKind(list, event.target.value as 'permanent' | 'oneoff')}><option value="permanent">Постоянный</option><option value="oneoff">Разовый</option></select></div>
      <div className="e4-actions"><button disabled={shopping.busy} onClick={() => { const next = window.prompt('Новое название списка', list.name); if (next !== null) void shopping.renameList(list, next) }}>Переименовать</button><button disabled={shopping.busy} onClick={async () => { if (window.confirm('Завершить список и перенести товары в архив?')) { const ok = await shopping.completeList(list); if (ok && list.kind === 'oneoff') setActive('') } }}>Завершить список</button><button disabled={shopping.busy} onClick={async () => { if (window.confirm('Удалить список и активные товары? Архив сохранится.')) { const ok = await shopping.deleteList(list.id); if (ok) setActive('') } }}>Удалить список</button></div>
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить? (можно несколько строк)</label><div className="input-row"><textarea id="item-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, молоко" rows={2} disabled={shopping.loading || shopping.busy}/><button className="add" disabled={shopping.loading || shopping.busy || !name.trim()} aria-label="Добавить товар">+</button></div></form>
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}{item.quantity ? ` · ${item.quantity} ${item.unit ?? ''}` : ''}</span></label><button className="e4-small" disabled={shopping.busy} onClick={() => startEdit(item)} aria-label={`Изменить ${item.name}`}>✎</button><button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно завершить список!</p>}
    </section>}
    {editing && <section className="e4-editor" aria-label="Редактирование товара"><h2>Изменить товар</h2><form onSubmit={saveEdit}><label htmlFor="edit-name">Название</label><input id="edit-name" value={editName} onChange={event => setEditName(event.target.value)} maxLength={120}/><label htmlFor="edit-quantity">Количество</label><input id="edit-quantity" type="number" min="0.001" step="any" value={editQuantity} onChange={event => setEditQuantity(event.target.value)}/><label htmlFor="edit-unit">Единица измерения</label><input id="edit-unit" value={editUnit} onChange={event => setEditUnit(event.target.value)} maxLength={30}/><div className="e4-actions"><button disabled={shopping.busy}>Сохранить</button><button type="button" onClick={() => setEditing(null)}>Отмена</button></div></form></section>}
    <section className="e4-create" aria-label="Новый список"><h2>Создать список</h2><form onSubmit={createList}><label htmlFor="new-list">Название списка</label><input id="new-list" value={newListName} onChange={event => setNewListName(event.target.value)} maxLength={120} placeholder="Например, для дачи"/><label htmlFor="list-kind">Тип списка</label><select id="list-kind" value={kind} onChange={event => setKind(event.target.value as 'permanent' | 'oneoff')}><option value="permanent">Постоянный</option><option value="oneoff">Разовый</option></select><button disabled={shopping.busy || shopping.loading || !newListName.trim()}>Создать</button></form></section>
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
