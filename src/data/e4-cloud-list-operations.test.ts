import { describe, expect, it, vi } from 'vitest'
import { sendCloudListChange } from './e4-cloud-list-operations'

const list = { id: '223e4567-e89b-42d3-a456-426614174001', ownerId: '123e4567-e89b-42d3-a456-426614174000', name: 'Продукты', kind: 'permanent' as const, position: 0, revision: 4 }
const op = '323e4567-e89b-42d3-a456-426614174002'
function fake(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}
describe('versioned cloud E4 list metadata adapter', () => {
  it('validates rename and checks server revision', async () => {
    const c = fake({ operation_id: op, list_id: list.id, revision: 5, name: 'Дача', kind: 'permanent', position: 0 })
    expect(await sendCloudListChange(c as never, list, op, { action: 'rename', name: ' Дача ' })).toEqual({ ...list, name: 'Дача', revision: 5 })
    expect(c.rpc).toHaveBeenCalledWith('apply_e4_list_metadata', { p_operation: op, p_list: list.id, p_expected_revision: 4, p_name: 'Дача', p_kind: null, p_position: null })
  })
  it('applies kind and reorder only after verified full receipts', async () => {
    const kind = fake({ operation_id: op, list_id: list.id, revision: 5, name: list.name, kind: 'oneoff', position: 0 })
    expect(await sendCloudListChange(kind as never, list, op, { action: 'kind', kind: 'oneoff' }))
      .toEqual({ ...list, kind: 'oneoff', revision: 5 })
    expect(kind.rpc).toHaveBeenCalledWith('apply_e4_list_metadata', {
      p_operation: op, p_list: list.id, p_expected_revision: 4,
      p_name: null, p_kind: 'oneoff', p_position: null,
    })
    const reorder = fake({ operation_id: op, list_id: list.id, revision: 5, name: list.name, kind: list.kind, position: 3 })
    expect(await sendCloudListChange(reorder as never, list, op, { action: 'reorder', position: 3 }))
      .toEqual({ ...list, position: 3, revision: 5 })
    expect(reorder.rpc).toHaveBeenCalledWith('apply_e4_list_metadata', {
      p_operation: op, p_list: list.id, p_expected_revision: 4,
      p_name: null, p_kind: null, p_position: 3,
    })
  })
  it('rejects malformed input before network', async () => {
    const c = fake({})
    await expect(sendCloudListChange(c as never, list, 'invalid', { action: 'kind', kind: 'oneoff' })).rejects.toThrow()
    await expect(sendCloudListChange(c as never, list, op, { action: 'rename', name: ' ' })).rejects.toThrow()
    await expect(sendCloudListChange(c as never, list, op, { action: 'reorder', position: -1 })).rejects.toThrow()
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it('rejects stale, mismatched and malformed receipts', async () => {
    for (const data of [null, {}, { list_id: list.id, revision: 4 }, { list_id: crypto.randomUUID(), revision: 5 },
      { operation_id: op, list_id: list.id, revision: 5, name: 'Продукты', kind: 'permanent', position: 0 },
      { operation_id: op, list_id: list.id, revision: 6, name: 'Новый', kind: 'permanent', position: 0 },
      { operation_id: crypto.randomUUID(), list_id: list.id, revision: 5, name: 'Новый', kind: 'permanent', position: 0 }]) {
      await expect(sendCloudListChange(fake(data) as never, list, op, { action: 'kind', kind: 'oneoff' })).rejects.toThrow()
    }
  })
  it('propagates permission and conflict errors without local success', async () => {
    await expect(sendCloudListChange(fake(null, new Error('List revision conflict')) as never,
      list, op, { action: 'reorder', position: 2 })).rejects.toThrow('List revision conflict')
  })
})
