/**
 * Short-lived, account-independent Auth diagnostics for Safari investigations.
 * NEVER persist account IDs, email addresses, passwords, tokens, list data,
 * arbitrary Error.message or backend response bodies here.
 */
const traceKey = 'shopping-app:auth-stage-trace:v1'
const allowedStages = [
  'initialize', 'auth_event', 'auth_event_signed_out', 'identity_check',
  'identity_verified', 'identity_rejected', 'identity_unavailable',
  'credentials_requested', 'credentials_accepted', 'credentials_rejected',
  'session_recheck', 'session_confirmed', 'session_interrupted',
  'linked_session_set', 'local_profile_selected', 'profile_open_start',
  'profile_open_ready', 'profile_open_failed', 'merge_sync_start',
  'merge_sync_complete', 'merge_sync_failed', 'signout_requested',
] as const

export type AuthStage = typeof allowedStages[number]
type Record = { at: string; stage: AuthStage; code?: string }

function safeCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return
  const issue = cause as { code?: unknown; status?: unknown }
  if (typeof issue.code === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(issue.code)) return issue.code
  if (typeof issue.status === 'number' && Number.isInteger(issue.status) &&
      issue.status >= 400 && issue.status <= 599) return 'http_' + issue.status
  return
}

function read(): Record[] {
  try {
    const rows: unknown = JSON.parse(sessionStorage.getItem(traceKey) ?? '[]')
    if (!Array.isArray(rows)) return []
    return rows.filter((v): v is Record => {
      if (!v || typeof v !== 'object') return false
      const row = v as Partial<Record>
      return typeof row.at === 'string' &&
        allowedStages.some(stage => stage === row.stage) &&
        (row.code === undefined ||
          (typeof row.code === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(row.code)))
    }).slice(-35)
  } catch { return [] }
}

export function markAuthStage(stage: AuthStage, cause?: unknown): void {
  try {
    const code = safeCode(cause)
    sessionStorage.setItem(traceKey, JSON.stringify([
      ...read(), { at: new Date().toISOString(), stage, ...(code ? { code } : {}) },
    ].slice(-35)))
  } catch { /* Browsers can deny storage; diagnostics must never block login. */ }
}

/** User-initiated copy only; output contains no identity or shopping content. */
export function exportAuthStages(): string {
  return JSON.stringify({ version: 1, events: read() }, null, 2)
}
