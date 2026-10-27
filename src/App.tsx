import { useState, type FormEvent } from 'react'
import { lists, itemsForList, type ListId } from './domain/shopping'
import { useShopping } from './hooks/useShopping'
import type { Storage } from './data/storage'
export function App({ storage }: { storage: Storage }) {
  const [active, setActive] = useState<ListId>('groceries')
  const [name, setName] = useState('')
  const shopping = useShopping(storage)
  const rows = itemsForList(shopping.items, active)
  const remaining = rows.filter(item => !item.purchased).length
  const list = lists.find(list => list.id === active)!
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await shopping.add(active, name)) setName('')
  }
  return <main>
    <header><div className="brand">ПОКУПКИ · v0.0.1</div><h1>Всё по списку</h1><p>Меньше держать в голове. Больше успевать.</p></header>
    <nav aria-label="Списки покупок">{lists.map(list => <button key={list.id} aria-pressed={active === list.id} onClick={() => { setActive(list.id); setName('') }}><span aria-hidden="true">{list.symbol}</span>{list.name}</button>)}</nav>
    <section aria-labelledby="list-title">
      <div className="section-heading"><h2 id="list-title">{list.name}</h2><span className="count" aria-live="polite">Осталось: {remaining}</span></div>
      <form onSubmit={submit}><label htmlFor="item-name">Что нужно купить?</label><div className="input-row"><input id="item-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, молоко" maxLength={120} autoComplete="off" disabled={shopping.loading || shopping.busy}/><button className="add" disabled={shopping.loading || shopping.busy || !name.trim()} aria-label="Добавить товар">+</button></div></form>
      {shopping.error && <div role="alert" className="error">{shopping.error}<button onClick={() => void shopping.reload()} disabled={shopping.busy || shopping.loading}>Повторить загрузку</button></div>}
      {shopping.loading ? <p role="status">Загружаем покупки…</p> : rows.length === 0 ? <div className="empty"><span aria-hidden="true">✓</span><h3>Здесь начинается ваш список</h3><p>Добавьте первый товар в поле выше.</p></div> : <ul>{rows.map(item => <li key={item.id} className={item.purchased ? 'purchased' : ''}><label className="item"><input type="checkbox" checked={item.purchased} disabled={shopping.busy} onChange={() => void shopping.toggle(item)}/><span>{item.name}</span></label><button className="delete" aria-label={`Удалить ${item.name}`} disabled={shopping.busy} onClick={() => void shopping.remove(item.id)}>×</button></li>)}</ul>}
      {rows.length > 0 && remaining === 0 && <p className="complete" role="status">Всё куплено. Можно идти домой!</p>}
    </section>
    <footer>Списки сохраняются на этом устройстве.<br/>После первого открытия приложение работает без интернета.</footer>
  </main>
}
