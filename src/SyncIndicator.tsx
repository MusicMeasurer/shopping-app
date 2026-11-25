import { useMemo } from 'react'
import type { SyncIndicatorState } from './data/list-sync-ledger'
import './SyncIndicatorPreview.css'
export const syncIndicatorLabels: Record<SyncIndicatorState, string> = {
  waiting: 'Ожидание синхронизации',
  running: 'Выполняется синхронизация',
  error: 'Ошибка синхронизации',
  success: 'Успешная синхронизация',
}
// The same intact static SVG artwork is used in every indicator area.
export function SyncIndicatorIcon({ state, preview = false }: { state: SyncIndicatorState; preview?: boolean }) {
  return <svg aria-hidden="true" className={preview ? "sync-preview-icon" : "sync-indicator-icon"} data-state={state}
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

export function SyncIndicator({ state, since, onError, name }: {
  state: SyncIndicatorState; since?: number; onError?: () => void; name: string
}) {
  const label = syncIndicatorLabels[state] + ' — ' + name
  const style = useMemo(() => state === 'success' && since !== undefined ? { animationDelay: '-' + Math.max(0, Date.now() - since) + 'ms' } : undefined, [state, since])
  const artwork = <span className="sync-indicator-artwork" style={style}><SyncIndicatorIcon state={state}/></span>
  return state === 'error' && onError
    ? <button type="button" className="list-card-sync" data-sync-state={state} aria-label={label} title={label}
        onClick={onError}>{artwork}</button>
    : <span role="img" aria-label={label} title={label} className="list-card-sync" data-sync-state={state}>{artwork}</span>
}
