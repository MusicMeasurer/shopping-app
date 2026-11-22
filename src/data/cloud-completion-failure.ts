/**
 * Only explicit server revision conflicts are terminal for automatic retry.
 * Offline/timeouts and ambiguous transport failures must preserve the UUID:
 * the server might already have committed the operation.
 */
export type CompletionFailure = 'revision-conflict' | 'retryable-unknown'
export function classifyCompletionFailure(error: unknown): CompletionFailure {
  const message = error instanceof Error ? error.message :
    error && typeof error === 'object' && 'message' in error &&
    typeof error.message === 'string' ? error.message : ''
  return /\bList revision conflict\b/i.test(message) ? 'revision-conflict' : 'retryable-unknown'
}
