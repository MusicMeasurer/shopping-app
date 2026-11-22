import { describe, expect, it } from 'vitest'
import { classifyCompletionFailure } from './cloud-completion-failure'
describe('completion failure classification', () => {
  it('pauses only an explicit server revision conflict', () => {
    expect(classifyCompletionFailure(new Error('List revision conflict'))).toBe('revision-conflict')
    expect(classifyCompletionFailure({ message: 'List revision conflict' })).toBe('revision-conflict')
  })
  it('preserves idempotent retry for uncertain transport and authorization errors', () => {
    for (const error of [new Error('Failed to fetch'), new Error('offline'), new Error('List unavailable'), null]) {
      expect(classifyCompletionFailure(error)).toBe('retryable-unknown')
    }
  })
})
