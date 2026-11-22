import { useRef, useState } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'
import { hasItemName, type ItemNameDecision } from './domain/item-names'
import { validateName, type Item } from './domain/shopping'

export function ItemNameConflictDialog({ group, items, available, onResolve, onDismiss }: {
  group: Item[]
  items: Item[]
  available: boolean
  onResolve: (decision: ItemNameDecision) => Promise<void>
  onDismiss: () => void
}) {
  const [editing, setEditing] = useState<Item>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const attempt = useRef<{ key: string; id: string }>(null)
  const pair = group.slice(0, 2)

  async function resolve(keep: Item, change: Item, rawName?: string) {
    if (!available || busy) return
    setError('')
    try {
      const name = rawName === undefined ? undefined : validateName(rawName)
      if (name !== undefined && hasItemName(items, change.listId, name, change.id)) {
        setError('Товар с таким названием уже есть в списке.')
        return
      }
      const key = JSON.stringify([keep, change, name])
      if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() }
      setBusy(true)
      await onResolve({ operationId: attempt.current.id, keep, change, name })
      onDismiss()
    } catch {
      setError('Не удалось сохранить решение. Дождитесь синхронизации и проверьте товары ещё раз.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceDialog label="Совпадение названий" className="e4-editor item-name-dialog"
    onDismiss={() => { if (!busy) onDismiss() }}>
    <h2>Совпадение названий</h2>
    <p>{group.length === 2 ? 'Оставьте одну позицию или переименуйте одну из них.' :
      `Позиций с таким названием: ${group.length}. Разрешите совпадение по две позиции за раз.`}</p>
    <div className="item-name-pair">{pair.map((item, index) => <section key={item.id} aria-label={`Позиция ${index + 1}`}>
      <strong>{item.name}</strong>
      <p>{item.quantity ?? 'Количество не указано'}{item.unit ? ` ${item.unit}` : ''} · {item.purchased ? 'Куплено' : 'Не куплено'}</p>
      <button type="button" disabled={!available || busy} onClick={() => void resolve(item, pair[1 - index])}>
        Оставить эту позицию
      </button>
      <button type="button" disabled={!available || busy} onClick={() => { setEditing(item); setName(item.name); setError('') }}>
        Переименовать
      </button>
    </section>)}</div>
    {editing && <form onSubmit={event => {
      event.preventDefault()
      const other = pair.find(item => item.id !== editing.id)
      if (other) void resolve(other, editing, name)
    }}>
      <label htmlFor="conflict-item-name">Новое название</label>
      <input id="conflict-item-name" value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} />
      <button type="submit" disabled={!available || busy || !name.trim()}>Сохранить название</button>
    </form>}
    {!available && <p>Чтобы разрешить совпадение в облачном списке, подключитесь к интернету и войдите в аккаунт.</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={onDismiss}>Позже</button>
  </WorkspaceDialog>
}
