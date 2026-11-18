import { describe, expect, it } from 'vitest'
import { parseSiriAddRequest } from './siri-add-request'

const valid = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  listId: '550e8400-e29b-41d4-a716-446655440001',
  name: '  Молоко  ',
}

describe('Siri add-item request', () => {
  it('normalizes a valid explicit target', () => {
    expect(parseSiriAddRequest(valid)).toEqual({ ...valid, name: 'Молоко' })
  })
  it('never guesses the list or operation identifier', () => {
    expect(() => parseSiriAddRequest({ name: 'Молоко' })).toThrow()
    expect(() => parseSiriAddRequest({ ...valid, listId: '' })).toThrow()
    expect(() => parseSiriAddRequest({ ...valid, operationId: 'same' })).toThrow()
  })
  it('rejects malformed and extra input', () => {
    for (const payload of [null, [], { ...valid, name: ' ' }, { ...valid, name: 'a'.repeat(121) }, { ...valid, name: 'a\nb' }, { ...valid, userId: 'spoof' }]) {
      expect(() => parseSiriAddRequest(payload)).toThrow()
    }
  })
})
