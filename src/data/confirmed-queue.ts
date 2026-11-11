/**
 * Drain one account's durable queue in order. Never acknowledge an operation
 * before the server confirms it. Stop on the first error (including conflicts):
 * later operations may depend on the failed one.
 *
 * Caller must bind all three callbacks to the same server-verified account.
 * A fresh queue read on every iteration allows safe resumption after a crash.
 */
export async function drainConfirmedQueue<T extends { operationId: string }>(
  readPending: () => Promise<T[]>,
  send: (operation: T) => Promise<unknown>,
  acknowledge: (operationId: string) => Promise<void>,
  canContinue: () => boolean = () => true,
): Promise<number> {
  let completed = 0
  const processed = new Set<string>()
  while (canContinue()) {
    const pending = await readPending()
    const next = pending.find(operation => !processed.has(operation.operationId))
    if (!next) break
    if (!next.operationId.trim()) throw new Error('Missing operation ID')
    if (!canContinue()) break
    await send(next)
    // A sign-out during the request must not acknowledge an operation under
    // an account that is no longer active; retrying is safe via idempotency.
    if (!canContinue()) break
    await acknowledge(next.operationId)
    processed.add(next.operationId)
    completed++
  }
  return completed
}
