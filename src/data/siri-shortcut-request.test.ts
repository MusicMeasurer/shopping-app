import { describe, expect, it } from 'vitest'
import { createSiriShortcutRequest } from './siri-shortcut-request'

const endpoint = 'https://example.supabase.co/functions/v1/siri-add'
const token = 'b'.repeat(64)
const input = {
  operationId: '550e8400-e29b-41d4-a716-446655440000',
  listId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Молоко',
}

describe('Siri Shortcut HTTPS request', () => {
  it('sends item only in JSON and credential only in authorization header', () => {
    const request = createSiriShortcutRequest(endpoint, token, input)
    expect(request.url).toBe(endpoint)
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe(`Bearer ${token}`)
    expect(JSON.parse(request.body)).toEqual(input)
    expect(request.url).not.toContain(input.name)
    expect(request.url).not.toContain(token)
  })

  it('rejects query credentials, insecure endpoints and unrelated domains', () => {
    for (const url of [
      endpoint + '?token=secret', 'http://example.supabase.co/functions/v1/siri-add',
      'https://example.supabase.co.evil.test/functions/v1/siri-add',
      'https://example.supabase.co/functions/v1/other',
    ]) expect(() => createSiriShortcutRequest(url, token, input)).toThrow()
  })

  it('rejects malformed credential and item', () => {
    expect(() => createSiriShortcutRequest(endpoint, 'bad', input)).toThrow()
    expect(() => createSiriShortcutRequest(endpoint, token, { ...input, name: '' })).toThrow()
  })
})
