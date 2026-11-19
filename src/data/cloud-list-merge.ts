import type { SupabaseClient } from '@supabase/supabase-js'
import { ListMergeConflict, planListMerge, type ListMergeSnapshot, type MergeChoice, type MergeList } from '../domain/list-merge'
import type { Item } from '../domain/shopping'

type BoundList = { localListId: string; remoteListId: string }
type CloudSnapshot = ListMergeSnapshot & { sourceRevision: number; targetRevision: number }
type RemoteList = { id: string; name: string; kind: 'permanent' | 'oneoff'; revision: number }
type RemoteItem = { id: string; list_id: string; name: string; purchased: boolean; created_at: string; quantity: number | null; unit: string | null }

function previewList(row: RemoteList, expected: BoundList): MergeList {
  if (row?.id !== expected.remoteListId || typeof row.name !== 'string' ||
      (row.kind !== 'permanent' && row.kind !== 'oneoff') || !Number.isSafeInteger(row.revision) || row.revision < 0)
    throw new Error('Один из личных списков недоступен.')
  return { id: expected.localListId, name: row.name, kind: row.kind }
}

export async function previewCloudListMerge(client: Pick<SupabaseClient, 'rpc'>, source: BoundList, target: BoundList): Promise<CloudSnapshot> {
  const { data, error } = await client.rpc('preview_e4_list_merge', { p_source: source.remoteListId, p_target: target.remoteListId })
  if (error?.code === 'PGRST202') throw new Error('Объединение облачных списков станет доступно после обновления сервера.')
  if (error) throw new Error('Не удалось загрузить предварительный результат.')
  if (!data || !Array.isArray(data.items)) throw new Error('Объединение доступно для личных списков одного профиля.')
  return {
    source: previewList(data.source, source), target: previewList(data.target, target),
    sourceRevision: data.source.revision, targetRevision: data.target.revision,
    items: (data.items as RemoteItem[]).map((item): Item => {
      const listId = item.list_id === source.remoteListId ? source.localListId : item.list_id === target.remoteListId ? target.localListId : undefined
      if (!listId || !Number.isFinite(Date.parse(item.created_at))) throw new Error('Не удалось прочитать позиции списков.')
      return { id: item.id, listId, name: item.name, purchased: item.purchased, createdAt: Date.parse(item.created_at),
        quantity: item.quantity ?? undefined, unit: item.unit ?? undefined }
    }),
  }
}

export async function applyCloudListMerge(client: Pick<SupabaseClient, 'rpc'>, snapshot: ListMergeSnapshot,
  source: BoundList, target: BoundList, choices: ReadonlyMap<string, MergeChoice>, operationId: string) {
  const { sourceRevision, targetRevision } = snapshot as CloudSnapshot
  if (!Number.isSafeInteger(sourceRevision) || !Number.isSafeInteger(targetRevision))
    throw new ListMergeConflict()
  const p_items = planListMerge(snapshot, choices).map(item => ({
    id: item.id, name: item.name, purchased: item.purchased, quantity: item.quantity ?? null, unit: item.unit ?? null,
  }))
  const { data, error } = await client.rpc('merge_e4_personal_lists', {
    p_operation: operationId, p_source: source.remoteListId, p_target: target.remoteListId,
    p_source_revision: sourceRevision, p_target_revision: targetRevision, p_items,
  })
  if (error?.code === '40001' || error?.code === '42501') throw new ListMergeConflict()
  if (error?.code === '22023') throw new Error('Проверьте названия, количество и единицы измерения.')
  if (error || data?.operation_id !== operationId || data?.source_id !== source.remoteListId || data?.target_id !== target.remoteListId)
    throw new Error('Объединение не подтверждено. Проверьте результат повторно.')
}
