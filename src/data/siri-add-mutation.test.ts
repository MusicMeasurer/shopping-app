import { describe, expect, it } from 'vitest'
import { siriAddMutation } from './siri-add-mutation'

const input = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  listId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Хлеб',
}

describe('Siri mutation mapping', () => {
  it('produces only an add operation with stable retry identity', () => {
    const first = siriAddMutation(input)
    expect(first).toEqual({
      kind: 'add', operationId: input.operationId, itemId: input.operationId,
      listId: input.listId, name: 'Хлеб', purchased: false,
    })
    expect(siriAddMutation(input)).toEqual(first)
  })
  it('refuses commands without a selected cloud list', () => {
    expect(() => siriAddMutation({ operationId: input.operationId, name: 'Хлеб' })).toThrow()
  })
})
