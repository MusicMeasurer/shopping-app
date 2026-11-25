import { useState } from 'react'
import { exportSyncLog } from './data/sync-diagnostics'

export function SyncDiagnosticsControl() {
  const [status, setStatus] = useState('')
  const [fallback, setFallback] = useState('')
  async function copy() {
    const log = exportSyncLog()
    try {
      await navigator.clipboard.writeText(log)
      setFallback('')
      setStatus('Журнал диагностики скопирован.')
    } catch {
      setFallback(log)
      setStatus('Автокопирование недоступно. Выделите и скопируйте журнал вручную.')
    }
  }
  return <div>
    <button type="button" onClick={() => void copy()}>Копировать журнал диагностики</button>
    {status && <p role="status">{status}</p>}
    {fallback && <textarea aria-label="Журнал диагностики" readOnly value={fallback}
      rows={6} onFocus={event => event.currentTarget.select()} />}
  </div>
}
