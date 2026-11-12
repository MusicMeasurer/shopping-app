import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCloudArchive } from './cloud-archive'

function fakeClient(completions: unknown[] | null, items: unknown[] | null, errorAt?: 'completions' | 'items') {
  const first = {
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue({ data: completions, error: errorAt === 'completions' ? new Error('blocked') : null }),
    }),
  }
  const second = {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: items, error: errorAt === 'items' ? new Error('blocked') : null }),
      }),
    }),
  }
  const from = vi.fn((table: string) => table === 'e4_archive_completions' ? first : second)
  return { client: { from } as unknown as SupabaseClient, from, first, second }
}

describe('cloud archive read adapter', () => {
  it('returns immutable completion snapshots grouped by completion id', async () => {
    const { client, from } = fakeClient([
      { id: 'a', source_list_id: 'l', source_list_name: 'Продукты', completed_at: '2026-11-12T00:00:00Z' },
      { id: 'b', source_list_id: 'l', source_list_name: 'Продукты', completed_at: '2026-11-11T00:00:00Z' },
    ], [
      { completion_id: 'a', ordinal: 0, name: 'Молоко', quantity: '2.000', unit: 'л' },
      { completion_id: 'b', ordinal: 0, name: 'Хлеб', quantity: null, unit: null },
    ])
    expect(await fetchCloudArchive(client)).toEqual([
      { id: 'a', sourceListId: 'l', sourceListName: 'Продукты', completedAt: '2026-11-12T00:00:00Z', items: [{ name: 'Молоко', quantity: 2, unit: 'л', ordinal: 0 }] },
      { id: 'b', sourceListId: 'l', sourceListName: 'Продукты', completedAt: '2026-11-11T00:00:00Z', items: [{ name: 'Хлеб', quantity: null, unit: null, ordinal: 0 }] },
    ])
    expect(from).toHaveBeenCalledTimes(2)
  })
  it('does not request item records for empty archive', async () => {
    const { client, from } = fakeClient([], [])
    expect(await fetchCloudArchive(client)).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
  })
  it('fails closed when archive query is denied', async () => {
    const { client } = fakeClient(null, null, 'completions')
    await expect(fetchCloudArchive(client)).rejects.toThrow('Не удалось загрузить облачный архив')
  })
  it('does not return partial archive when item query fails', async () => {
    const { client } = fakeClient([{ id: 'a' }], null, 'items')
    await expect(fetchCloudArchive(client)).rejects.toThrow('Не удалось загрузить позиции')
  })
})
