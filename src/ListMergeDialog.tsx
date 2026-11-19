import { useRef, useState } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'
import { ListMergeConflict, mergeGroups, planListMerge, type ListMergeActions, type ListMergeSnapshot, type MergeChoice, type MergeList } from './domain/list-merge'
import { listKindLabels } from './ListIndicators'
import type { Item } from './domain/shopping'

type Phase = 'pick' | 'preview' | 'retry'
function describe(item: Item) {
  return [item.name, [item.quantity, item.unit].filter(value => value !== undefined).join(' '),
    item.purchased ? 'куплено' : 'к покупке'].filter(Boolean).join(' · ')
}

export function ListMergeDialog({ source, targets, actions, onDismiss, onMerged }: {
  source: MergeList
  targets: MergeList[]
  actions: ListMergeActions
  onDismiss(): void
  onMerged(targetId: string): void
}) {
  const [targetId, setTargetId] = useState('')
  const [snapshot, setSnapshot] = useState<ListMergeSnapshot>()
  const [choices, setChoices] = useState(new Map<string, MergeChoice>())
  const [phase, setPhase] = useState<Phase>('pick')
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const operation = useRef('')
  const [error, setError] = useState('')
  const groups = snapshot ? mergeGroups(snapshot.items) : new Map<string, Item[]>()
  let preview: Item[] | undefined
  let validation = ''
  if (snapshot) {
    try { preview = planListMerge(snapshot, choices) }
    catch (cause) { validation = (cause as Error).message }
  }

  function choose(key: string, change: (previous: MergeChoice) => MergeChoice) {
    setChoices(previous => new Map(previous).set(key, change(previous.get(key) ?? { keepId: '', renamed: {} })))
  }
  async function load() {
    const current = await actions.read(source.id, targetId)
    setSnapshot(current)
    setChoices(new Map())
    operation.current = crypto.randomUUID()
    setPhase('preview')
  }
  async function run(action: () => Promise<void>) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Операция со списками не удалась.') }
    finally { locked.current = false; setBusy(false) }
  }
  async function confirm() {
    if (!snapshot || !preview) return
    try {
      await actions.apply(snapshot, choices, operation.current)
      onMerged(snapshot.target.id)
    } catch (cause) {
      if (cause instanceof ListMergeConflict) {
        setPhase('pick')
        setSnapshot(undefined)
        await load()
      } else {
        setPhase('retry')
      }
      throw cause
    }
  }

  return <WorkspaceDialog label="Объединить списки" className="create-dialog list-merge"
    onDismiss={() => { if (!busy) onDismiss() }}>
    <h2>Объединить списки</h2>
    {phase === 'pick' ? <>
      <p>Исходный список — «{source.name}».</p>
      <label>Список-получатель
        <select value={targetId} onChange={event => setTargetId(event.target.value)} disabled={busy}>
          <option value="">Выбрать список</option>
          {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || !targetId} onClick={() => void run(load)}>Посмотреть результат</button>
    </> : snapshot && <>
      <p>«{snapshot.source.name}» исчезнет из активных списков. Останется «{snapshot.target.name}» ({listKindLabels[snapshot.target.kind].toLowerCase()}).</p>
      {phase === 'preview' && [...groups].filter(([, group]) => group.length > 1).map(([key, group], index) => {
        const choice = choices.get(key)
        const keep = group.find(item => item.id === choice?.keepId)
        return <fieldset key={key} disabled={busy}>
          <legend>{group[0].name}</legend>
          {group.map(item => <div key={item.id}>
            <label><input type="radio" name={'merge-item-' + index} checked={choice?.keepId === item.id}
              onChange={() => choose(key, previous => ({ ...previous, keepId: item.id, custom: undefined }))}/>
              {item.listId === source.id ? snapshot.source.name : snapshot.target.name} — {describe(item)}</label>
            {item.listId === source.id && keep && keep.id !== item.id && <>
              <label><input type="checkbox" checked={!!choice && Object.hasOwn(choice.renamed, item.id)}
                onChange={event => {
                  const enabled = event.target.checked
                  choose(key, previous => {
                    const renamed = { ...previous.renamed }
                    if (enabled) renamed[item.id] = ''
                    else delete renamed[item.id]
                    return { ...previous, renamed }
                  })
                }}/>Сохранить переносимую позицию под новым именем</label>
              {choice && Object.hasOwn(choice.renamed, item.id) && <label>Новое имя
                <input value={choice.renamed[item.id]} maxLength={120}
                  onChange={event => choose(key, previous => ({ ...previous, renamed: { ...previous.renamed, [item.id]: event.target.value } }))}/>
              </label>}
            </>}
          </div>)}
          {keep && <label><input type="checkbox" checked={!!choice?.custom}
            onChange={event => choose(key, previous => ({ ...previous, custom: event.target.checked
              ? { quantity: keep.quantity, unit: keep.unit, purchased: keep.purchased } : undefined }))}/>Задать итоговые параметры</label>}
          {choice?.custom && <>
            <label>Количество<input type="number" min="0.001" step="any" value={choice.custom.quantity ?? ''}
              onChange={event => choose(key, previous => ({ ...previous, custom: { ...previous.custom!,
                quantity: event.target.value === '' ? undefined : Number(event.target.value) } }))}/></label>
            <label>Единица измерения<input maxLength={30} value={choice.custom.unit ?? ''}
              onChange={event => choose(key, previous => ({ ...previous, custom: { ...previous.custom!, unit: event.target.value || undefined } }))}/></label>
            <label><input type="checkbox" checked={choice.custom.purchased}
              onChange={event => choose(key, previous => ({ ...previous, custom: { ...previous.custom!, purchased: event.target.checked } }))}/>Куплено</label>
          </>}
        </fieldset>
      })}
      {preview?.length ? <ul>{preview.map(item => <li key={item.id}>{describe(item)}</li>)}</ul> : null}
      {validation && <p role="status">{validation}</p>}
      <div className="dialog-buttons">
        {phase === 'preview' && <button type="button" disabled={busy} onClick={() => setPhase('pick')}>Назад</button>}
        <button type="button" disabled={busy || !preview} onClick={() => void run(confirm)}>
          {phase === 'retry' ? 'Проверить результат' : 'Объединить'}
        </button>
      </div>
    </>}
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={onDismiss}>{phase === 'retry' ? 'Закрыть' : 'Отмена'}</button>
  </WorkspaceDialog>
}
