import { describe, expect, it, vi } from 'vitest'
import { createCloudList } from './e4-cloud-list-create'

const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const operation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const listId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const receipt = { operation_id: operation, list_id: listId, owner_id: account,
  name: 'Trip', kind: 'oneoff', position: 0, revision: 0 }
const mock = (data: unknown, error: unknown = null) => ({ rpc: vi.fn().mockResolvedValue({ data, error }) })

describe('E4 cloud list creation adapter', () => {
  it('sends only owner-derived RPC parameters and verifies the full receipt', async () => {
    const client = mock(receipt)
    expect(await createCloudList(client as never, account, operation, ' Trip ', 'oneoff'))
      .toEqual({ id: listId, ownerId: account, name: 'Trip', kind: 'oneoff', position: 0, revision: 0 })
    expect(client.rpc).toHaveBeenCalledWith('create_e4_list', {
      p_operation: operation, p_name: 'Trip', p_kind: 'oneoff',
    })
  })
  it('rejects malformed requests without network access', async () => {
    const client = mock(receipt)
    await expect(createCloudList(client as never, 'invalid', operation, 'Trip', 'oneoff')).rejects.toThrow()
    await expect(createCloudList(client as never, account, operation, '   ', 'oneoff')).rejects.toThrow()
    await expect(createCloudList(client as never, account, operation, 'Trip', 'invalid' as never)).rejects.toThrow()
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('rejects foreign, stale, mismatched or incomplete server receipts', async () => {
    for (const changed of [
      { owner_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { operation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
      { revision: 1 }, { kind: 'permanent' }, { name: 'Other' },
      { position: -1 }, { list_id: null },
    ]) {
      await expect(createCloudList(mock({ ...receipt, ...changed }) as never, account, operation, 'Trip', 'oneoff'))
        .rejects.toThrow()
    }
  })
  it('propagates server errors', async () => {
    await expect(createCloudList(mock(null, new Error('denied')) as never, account, operation, 'Trip', 'oneoff'))
      .rejects.toThrow('denied')
  })
})
