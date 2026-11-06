/**
 * A persisted sign-out intent prevents restoring an account after a failed
 * or interrupted sign-out. This is a UI privacy guard, not token revocation.
 */
export interface SignOutGuard {
  isPending(): boolean
  markPending(): void
  clear(): void
}

export function createSignOutGuard(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): SignOutGuard {
  const key = 'shopping-app:signout-pending:v1'
  return {
    // If browser storage cannot be read, fail closed rather than reveal an account.
    isPending: () => {
      try {
        return storage.getItem(key) === '1'
      } catch {
        return true
      }
    },
    markPending: () => storage.setItem(key, '1'),
    clear: () => storage.removeItem(key),
  }
}
