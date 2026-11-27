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
  'signout_local_requested', 'signout_sdk_success', 'signout_sdk_error', 'signout_timeout', 'signout_failed',
  'identity_joined', 'fetch_start', 'fetch_headers', 'fetch_timeout', 'fetch_aborted', 'fetch_failed',
] as const

export type AuthStage = typeof allowedStages[number]
const endpoints = ['password', 'token', 'user', 'logout', 'verify', 'recover', 'resend', 'installation_status'] as const
export type AuthEndpoint = typeof endpoints[number]
type TransportStage = 'fetch_start' | 'fetch_headers' | 'fetch_timeout' | 'fetch_aborted' | 'fetch_failed'
type Transport = { request: number; endpoint: AuthEndpoint; elapsedMs: number; visibility: 'visible' | 'hidden' | 'unknown'; status?: number }
type Record = { at: string; stage: AuthStage; code?: string } & Partial<Transport>
const maxEvents = 120
let requestSequence = Date.now() * 1000

export function nextAuthRequest(): number { return ++requestSequence }

function safeTransport(row: Partial<Record>): Partial<Transport> {
  const { request, endpoint, elapsedMs, visibility, status } = row
  if (typeof request !== 'number' || !Number.isSafeInteger(request) || request < 1 ||
      !endpoints.some(value => value === endpoint) ||
      typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 ||
      (visibility !== 'visible' && visibility !== 'hidden' && visibility !== 'unknown')) return {}
  return { request, endpoint, elapsedMs, visibility,
    ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}) }
}

function safeCode(cause: unknown): string | undefined {
  if (!cause || typeof cause !== 'object') return
  const issue = cause as { code?: unknown; status?: unknown; name?: unknown }
  if (typeof issue.code === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(issue.code)) return issue.code
  if (typeof issue.status === 'number' && Number.isInteger(issue.status) &&
      issue.status >= 400 && issue.status <= 599) return 'http_' + issue.status
  if (issue.name === 'TimeoutError') return 'timeout'
  if (issue.name === 'AbortError') return 'aborted'
  if (issue.name === 'AuthRetryableFetchError') return 'transport_or_timeout'
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
    }).slice(-maxEvents).map(row => ({ at: row.at, stage: row.stage,
      ...(row.code ? { code: row.code } : {}), ...safeTransport(row) }))
  } catch { return [] }
}

export function markAuthStage(stage: AuthStage, cause?: unknown): void {
  try {
    const code = safeCode(cause)
    sessionStorage.setItem(traceKey, JSON.stringify([
      ...read(), { at: new Date().toISOString(), stage, ...(code ? { code } : {}) },
    ].slice(-maxEvents)))
  } catch { /* Browsers can deny storage; diagnostics must never block login. */ }
}

/** Transport metadata only: no URL, query, headers, body or account identifiers. */
export function markAuthTransport(stage: TransportStage, fields: Omit<Transport, 'visibility'>): void {
  try {
    const visibility = typeof document === 'undefined' ? 'unknown'
      : document.visibilityState === 'visible' ? 'visible' : 'hidden'
    sessionStorage.setItem(traceKey, JSON.stringify([
      ...read(), { at: new Date().toISOString(), stage, ...safeTransport({ ...fields, visibility }) },
    ].slice(-maxEvents)))
  } catch { /* diagnostics cannot affect Auth */ }
}

/** User-initiated copy only; output contains no identity or shopping content. */
export function exportAuthStages(): string {
  return JSON.stringify({ version: 1, events: read() }, null, 2)
}
