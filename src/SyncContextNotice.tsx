import { useRef } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'
import { syncNoticeText } from './domain/sync-notice-ui'
import type { SyncNotice } from './data/sync-event-fate'

export function SyncContextNotice({ notice, busy, error, onAcknowledge }: {
  notice: SyncNotice; busy: boolean; error: string; onAcknowledge: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const { title, message } = syncNoticeText(notice)
  return <WorkspaceDialog label={title} className="create-dialog" onDismiss={() => {}} initialFocusRef={button}>
    <h2>{title}</h2>
    <p>{message}</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-buttons">
      <button ref={button} type="button" disabled={busy} onClick={onAcknowledge}>Понятно</button>
    </div>
  </WorkspaceDialog>
}
