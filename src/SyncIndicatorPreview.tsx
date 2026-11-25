import './SyncIndicatorPreview.css'
import { SyncIndicatorIcon } from './SyncIndicator'

const states = [
  ['waiting', 'Ожидание синхронизации'],
  ['running', 'Выполняется синхронизация'],
  ['error', 'Ошибка синхронизации'],
  ['success', 'Успешная синхронизация'],
] as const


export function SyncIndicatorPreview() {
  return <div className="sync-preview" role="group" aria-label="Предварительный просмотр индикаторов">
    <p className="sync-preview-title">Демонстрация индикаторов</p>
    {states.map(([state, label]) => <div className="sync-preview-row" key={state}>
      <SyncIndicatorIcon state={state} preview/><span>{label}</span>
    </div>)}
    <p className="sync-preview-note">Пример анимаций, не состояние данных. Успех повторяется для просмотра.</p>
  </div>
}
