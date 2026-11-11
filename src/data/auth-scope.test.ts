import { describe, expect, it } from 'vitest'
import { accountIdFromSessionCandidate } from './auth-scope'

const id = '123e4567-e89b-42d3-a456-426614174000'
describe('local auth session scope guard', () => {
  it('keeps guests separate', () => {
    expect(accountIdFromSessionCandidate(null)).toBeNull()
  })
  it('accepts a well-shaped, unexpired session candidate', () => {
    expect(accountIdFromSessionCandidate({ user: { id }, access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) + 600 })).toBe(id)
  })
  it('rejects malformed identifiers and missing credentials', () => {
    expect(accountIdFromSessionCandidate({ user: { id: '../guest' }, access_token: 'test-token' })).toBeNull()
    expect(accountIdFromSessionCandidate({ user: { id }, access_token: '' })).toBeNull()
  })
  it('rejects expired session candidates', () => {
    expect(accountIdFromSessionCandidate({ user: { id }, access_token: 'test-token', expires_at: Math.floor(Date.now() / 1000) - 10 })).toBeNull()
  })
})
