import { useState, type ReactNode } from 'react'
import { itemNameKey } from './domain/item-names'

interface PurchaseSnapshot {
  id: string
  name?: string
  sourceListName?: string
  completedAt: string | number
  items: readonly {
    name: string
    quantity?: number | null
    unit?: string | null
  }[]
}

export function PurchaseHistory({ snapshots, children, emptyMessage = 'Архив пока пуст.' }: {
  snapshots: readonly PurchaseSnapshot[] | null
  children?: ReactNode
  emptyMessage?: string
}) {
  const [query, setQuery] = useState('')
  const search = itemNameKey(query)
  const hasPurchases = snapshots?.some(snapshot => snapshot.items.length > 0) ?? false
  const results = snapshots?.flatMap(snapshot => {
    const items = snapshot.items.filter(item => !search || itemNameKey(item.name).includes(search))
    return items.length ? [{ snapshot, items }] : []
  })

  return <section aria-label="Архив покупок">
    <h2>Завершённые списки</h2>
    {children}
    {hasPurchases && <label className="archive-search">
      Поиск в истории покупок
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название товара"/>
    </label>}
    {results && (results.length === 0
      ? <p role="status">{search && hasPurchases ? 'Покупки не найдены.' : emptyMessage}</p>
      : results.map(({ snapshot, items }) => <article className="archive-entry" key={snapshot.id}>
        <h3>{snapshot.sourceListName ?? snapshot.name}</h3>
        <p>{new Date(snapshot.completedAt).toLocaleString('ru-RU')} · {items.length} товаров</p>
        <ul>{items.map((item, index) => {
          const amount = [item.quantity, item.unit].filter(value => value != null && value !== '').join(' ')
          return <li key={index}>{item.name}{amount && ' — ' + amount}</li>
        })}</ul>
      </article>))}
  </section>
}
