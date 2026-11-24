import type { SyncNotice } from '../data/sync-event-fate'

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
