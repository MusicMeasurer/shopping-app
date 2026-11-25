import './SyncIndicatorPreview.css'

const states = [
  ['waiting', 'Ожидание синхронизации'],
  ['running', 'Выполняется синхронизация'],
  ['error', 'Ошибка синхронизации'],
  ['success', 'Успешная синхронизация'],
] as const

type PreviewState = typeof states[number][0]

// Visual prototype only. Keep the complete static SVG intact: CSS animates
// the entire icon, never an individual path, stroke or viewBox.
function PreviewIcon({ state }: { state: PreviewState }) {
  return <svg aria-hidden="true" className="sync-preview-icon" data-state={state}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    {state === 'running' ? <>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
      <path d="M8 16H3v5"/>
    </> : <>
      <circle cx="12" cy="12" r="9"/>
      {state === 'waiting' && <path d="M12 6v6l4 2"/>}
      {state === 'error' && <path d="M12 6.5v6.5M12 16.7v.3"/>}
      {state === 'success' && <path d="m7.7 12 3 3 5.8-6"/>}
    </>}
  </svg>
}

export function SyncIndicatorPreview() {
  return <div className="sync-preview" role="group" aria-label="Предварительный просмотр индикаторов">
    <p className="sync-preview-title">Демонстрация индикаторов</p>
    {states.map(([state, label]) => <div className="sync-preview-row" key={state}>
      <PreviewIcon state={state}/><span>{label}</span>
    </div>)}
    <p className="sync-preview-note">Пример анимаций, не состояние данных. Успех повторяется для просмотра.</p>
  </div>
}
