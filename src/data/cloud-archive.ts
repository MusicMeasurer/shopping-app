import type { SupabaseClient } from '@supabase/supabase-js'

/** Immutable purchased-item snapshots; never infer a purchase from an active checkbox. */
export interface CloudArchiveCompletion {
  id: string
  sourceListId: string
  sourceListName: string
  completedAt: string
  items: Array<{ name: string; quantity: number | null; unit: string | null; ordinal: number }>
}

/**
 * Read-only archive adapter for E4. The database enforces owner-scoped RLS.
 * Never accept an arbitrary ownerId: the authenticated session is the identity.
 */
export async function fetchCloudArchive(client: SupabaseClient): Promise<CloudArchiveCompletion[]> {
  const { data: completions, error: completionError } = await client
    .from('e4_archive_completions')
    .select('id,source_list_id,source_list_name,completed_at')
    .order('completed_at', { ascending: false })
  if (completionError) throw new Error('Не удалось загрузить облачный архив', { cause: completionError })
  if (!completions?.length) return []
  const ids = completions.map(row => row.id as string)
  const { data: items, error: itemError } = await client
    .from('e4_archive_items')
    .select('completion_id,ordinal,name,quantity,unit')
    .in('completion_id', ids)
    .order('ordinal', { ascending: true })
  if (itemError) throw new Error('Не удалось загрузить позиции облачного архива', { cause: itemError })
  const byCompletion = new Map<string, CloudArchiveCompletion['items']>()
  for (const item of items ?? []) {
    const id = item.completion_id as string
    const rows = byCompletion.get(id) ?? []
    rows.push({
      name: item.name as string,
      quantity: item.quantity == null ? null : Number(item.quantity),
      unit: item.unit as string | null,
      ordinal: item.ordinal as number,
    })
    byCompletion.set(id, rows)
  }
  return completions.map(row => ({
    id: row.id as string,
    sourceListId: row.source_list_id as string,
    sourceListName: row.source_list_name as string,
    completedAt: row.completed_at as string,
    items: byCompletion.get(row.id as string) ?? [],
  }))
}
