import { expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCloudArchive } from './cloud-archive'
import { fetchRemoteItems } from './remote-snapshot'

it('reads archived transfers beyond API row limits, including a single large archive', async () => {
  const completions = Array.from({ length: 501 }, (_, i) => ({ id: String(i), source_list_id: 'list', source_list_name: 'Archive', completed_at: '2026-01-01T00:00:00Z' }))
  const archived = Array.from({ length: 1201 }, (_, i) => ({ completion_id: '0', ordinal: i, name: 'Item ' + i, quantity: 1, unit: 'шт.' }))
  const client = { from(table: string) {
    let selected = table === 'e4_archive_completions' ? completions : archived
    const query = {
      select() { return query }, order() { return query },
      in(_column: string, ids: string[]) { selected = archived.filter(row => ids.includes(row.completion_id)); return query },
      range(from: number, to: number) { return Promise.resolve({ data: selected.slice(from, to + 1), error: null }) },
    }
    return query
  } } as unknown as SupabaseClient
  const snapshots = await fetchCloudArchive(client)
  expect(snapshots).toHaveLength(501)
  expect(snapshots[0].items).toHaveLength(1201)
  expect(snapshots[0].items[1200].name).toBe('Item 1200')
})

it('supports stable bounded reads for transfer item hydration', async () => {
  const listId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const rows = Array.from({ length: 1101 }, (_, i) => ({ id: String(i), list_id: listId, name: 'Milk', purchased: false, version: 1, created_at: '2026-01-01T00:00:00Z' }))
  const orders: string[] = []
  const query = { select() { return query }, eq() { return query }, is() { return query },
    order(column: string) { orders.push(column); return query }, range(from: number, to: number) { return Promise.resolve({ data: rows.slice(from, to + 1), error: null }) } }
  const client = { from() { return query } } as unknown as SupabaseClient
  const first = await fetchRemoteItems(client, listId, false, { from: 0, to: 499 })
  const last = await fetchRemoteItems(client, listId, false, { from: 1000, to: 1499 })
  expect(first).toHaveLength(500)
  expect(last).toHaveLength(101)
  expect(last[100].id).toBe('1100')
  expect(orders).toEqual(['created_at', 'id', 'created_at', 'id'])
})
