import type { SupabaseClient } from '@supabase/supabase-js'

/** Immutable purchased-item snapshots; never infer a purchase from an active checkbox. */
export interface CloudArchiveCompletion {
  id: string
  operationId?: string
  pending?: boolean
  sourceListId: string
  sourceListName: string
  completedAt: string
  items: Array<{ name: string; quantity: number | null; unit: string | null; ordinal: number }>
}

/**
 * Read-only archive adapter for E4. The database enforces owner-scoped RLS.
 * Never accept an arbitrary ownerId: the authenticated session is the identity.
 */
export async function fetchCloudArchive(client: SupabaseClient, paginate = true): Promise<CloudArchiveCompletion[]> {
  const readCompletions = () => client
    .from('e4_archive_completions')
    .select('id,source_list_id,source_list_name,completed_at,operation_id')
    .order('completed_at', { ascending: false })
  let { data: completions, error: completionError } = await (paginate ? readCompletions().order('id').range(0, 499) : readCompletions())
  if (paginate && !completionError && completions?.length === 500) {
    for (let from = 500; ; from += 500) {
      const page = await readCompletions().order('id').range(from, from + 499)
      if (page.error) { completionError = page.error; break }
      completions.push(...(page.data ?? []))
      if ((page.data?.length ?? 0) < 500) break
    }
  }
  if (completionError) throw new Error('Не удалось загрузить облачный архив', { cause: completionError })
  if (!completions?.length) return []
  const ids = completions.map(row => row.id as string)
  const readItems = (batch: string[]) => client.from('e4_archive_items')
    .select('completion_id,ordinal,name,quantity,unit').in('completion_id', batch).order('ordinal', { ascending: true })
  let { data: items, error: itemError } = paginate ? { data: [] as { completion_id: string; ordinal: number; name: string; quantity: number | null; unit: string | null }[], error: null as unknown } : await readItems(ids)
  if (paginate) {
    for (let offset = 0; offset < ids.length; offset += 100) {
      for (let from = 0; ; from += 500) {
        const page = await readItems(ids.slice(offset, offset + 100)).order('completion_id').range(from, from + 499)
        if (page.error) { itemError = page.error; break }
        items!.push(...(page.data ?? []))
        if ((page.data?.length ?? 0) < 500) break
      }
      if (itemError) break
    }
  }
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
    operationId: row.operation_id as string,
    sourceListId: row.source_list_id as string,
    sourceListName: row.source_list_name as string,
    completedAt: row.completed_at as string,
    items: byCompletion.get(row.id as string) ?? [],
  }))
}
