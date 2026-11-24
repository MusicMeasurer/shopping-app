import { useRef } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'
import { syncNoticeText, relatedItemText } from './domain/sync-notice-ui'
import type { SyncNotice } from './data/sync-event-fate'

export function SyncContextNotice({ notice, itemRemoval, busy, error, onAcknowledge }: {
  notice: SyncNotice; itemRemoval?: SyncNotice; busy: boolean; error: string; onAcknowledge: () => void
}) {
  const button = useRef<HTMLButtonElement>(null)
  const { title, message } = syncNoticeText(notice)
  const itemMessage = relatedItemText(notice, itemRemoval)
  return <WorkspaceDialog label={title} className="create-dialog" onDismiss={() => {}} initialFocusRef={button}>
    <h2>{title}</h2>
    <p>{message}</p>
    {itemMessage && <p>{itemMessage}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-buttons">
      <button ref={button} type="button" disabled={busy} onClick={onAcknowledge}>Понятно</button>
    </div>
  </WorkspaceDialog>
}
