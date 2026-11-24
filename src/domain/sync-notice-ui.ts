import type { SyncNotice } from '../data/sync-event-fate'
import type { AccountSemanticState, RecoveryCandidate } from '../data/sync-event-state'

export function syncNoticeText(notice: SyncNotice): { title: string; message: string } {
  const subject = (notice.entity === 'list' ? 'Список' : 'Товар') + ' «' + notice.sourceName + '»'
  if (notice.reason === 'merged' && notice.entity === 'list' && notice.targetListName)
    return { title: 'Списки объединены', message: subject + ' объединён со списком «' + notice.targetListName + '» на другом устройстве.' }
  if (notice.reason === 'merged')
    return { title: 'Списки объединены', message: subject + ' исчез при объединении списков на другом устройстве.' }
  if (notice.reason === 'archived')
    return { title: 'Товар в архиве', message: subject + ' перемещён в архив на другом устройстве.' }
  if (notice.reason === 'completed')
    return notice.entity === 'list'
      ? { title: 'Список завершён', message: subject + ' завершён на другом устройстве.' }
      : { title: 'Список завершён', message: subject + ' исчез при завершении списка на другом устройстве.' }
  return { title: notice.entity === 'list' ? 'Список удалён' : 'Товар удалён', message: subject + ' удалён на другом устройстве.' }
}

/** The feed uses remote IDs; the workspace selects local IDs. Never match by name. */
export function localSyncListId(id: string | null, bindings: Readonly<Record<string, string>>,
  available: readonly { id: string }[]): string | null {
  if (id === null) return null
  return available.find(row => (bindings[row.id] ?? row.id) === id)?.id ?? null
}

/** A lost item in a surviving list must not hide the list itself. */
export function lostSyncListId(candidate: RecoveryCandidate | undefined): string | null {
  if (!candidate?.origin.listId) return null
  return candidate.fate.nextListId !== candidate.origin.listId ? candidate.origin.listId : null
}

export function relatedItemText(notice: SyncNotice, itemRemoval?: SyncNotice): string | undefined {
  return notice.entity === 'list' && itemRemoval?.entity === 'item'
    ? syncNoticeText(itemRemoval).message : undefined
}

/** A disconnected workspace cannot finish a server batch. Its already
 * available local lists remain usable, without consuming any durable notice. */
export function deferListFallback(enabled: boolean, loaded: boolean,
  state: AccountSemanticState | undefined, navigating: boolean, disconnected: boolean): boolean {
  if (!enabled) return false
  if (!loaded || state?.presented || state?.pending?.fate.notice || navigating) return true
  if (disconnected) return false
  return !!(state?.pending || (state?.evidence && (!state.evidence.caughtUp || state.ready === false)))
}

export function cachedFallbackList(state: AccountSemanticState | undefined,
  bindings: Readonly<Record<string, string>>, available: readonly { id: string }[]): string | null {
  const candidates = [state?.pending?.fate.nextListId, state?.context?.listId, ...(state?.activity ?? [])]
  for (const id of candidates) {
    const local = localSyncListId(id ?? null, bindings, available)
    if (local !== null) return local
  }
  return available[0]?.id ?? null
}
