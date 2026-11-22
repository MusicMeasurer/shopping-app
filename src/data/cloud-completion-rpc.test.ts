import { describe, expect, it, vi } from 'vitest'
import { sendCloudCompletion } from './cloud-completion-rpc'
const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const listId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const archiveId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const request = { operationId, listId, expectedRevision: 3, mode: 'marked_only' as const }
const valid = { operation_id: operationId, list_id: listId, revision: 5, item_count: 2, archive_id: archiveId, kind: 'permanent', mode: 'marked_only' }
function client(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) }
}
describe('cloud completion RPC adapter', () => {
  it('sends the expected idempotent operation and validates the receipt', async () => {
    const c = client(valid)
    expect(await sendCloudCompletion(c as never, request)).toEqual({
      operationId, listId, revision: 5, itemCount: 2, archiveId, kind: 'permanent', mode: 'marked_only',
    })
    expect(c.rpc).toHaveBeenCalledWith('complete_e4_list', {
      p_operation: operationId, p_list: listId, p_expected_revision: 3, p_mode: 'marked_only',
    })
  })
  it('rejects malformed input without a server call', async () => {
    const c = client(valid)
    await expect(sendCloudCompletion(c as never, { ...request, operationId: 'invalid' })).rejects.toThrow()
    expect(c.rpc).not.toHaveBeenCalled()
  })
  it('rejects mismatched or partial receipts', async () => {
    for (const value of [
      null, {}, { ...valid, operation_id: listId }, { ...valid, revision: 3 },
      { ...valid, archive_id: 'invalid' }, { ...valid, item_count: 0 },
    ]) {
      await expect(sendCloudCompletion(client(value) as never, request)).rejects.toThrow()
    }
  })
  it('rejects inconsistent archive presence for all/none purchased', async () => {
    await expect(sendCloudCompletion(client({ ...valid, mode: 'all_purchased', archive_id: null }) as never,
      { ...request, mode: 'all_purchased' })).rejects.toThrow('Неподтверждённый')
    await expect(sendCloudCompletion(client({ ...valid, mode: 'none_purchased' }) as never,
      { ...request, mode: 'none_purchased' })).rejects.toThrow('Неподтверждённый')
  })
  it('propagates server conflicts rather than fabricating a receipt', async () => {
    await expect(sendCloudCompletion(client(null, new Error('List revision conflict')) as never, request))
      .rejects.toThrow('List revision conflict')
  })
})
