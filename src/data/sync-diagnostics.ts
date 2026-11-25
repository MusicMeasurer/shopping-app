/** Temporary, lab-only, local diagnostics. Never store identifiers, payloads,
 * messages, URLs, credentials or response bodies. No network or sync control. */
export const syncDiagnosticsEnabled = import.meta.env.VITE_SYNC_DIAGNOSTICS === 'true' &&
  import.meta.env.VITE_SUPABASE_URL === 'https://gmrqeubhotjpmtwokfeq.supabase.co'
export const syncDiagnosticKey = 'shopping-app:sync-diagnostics:v1'
const stages = ['online','offline','visible','hidden','pageshow','manual','request','recovery',
  'session','session-read','identity','deletion-check','push','queue','batch-claim','batch-send',
  'receipt-validate','receipt-store','batch-rejected','list-work','pull','feed-read','feed-store','archive','profile-pending'] as const
const outcomes = ['start','ok','error','timeout','rejected','cancelled','skipped','queued','deferred','waiting'] as const
const codes = ['session_not_found','refresh_token_not_found','refresh_token_already_used','bad_jwt',
  'request_timeout','unexpected_failure','PGRST202','P0002','42501','23505','57014'] as const
type Stage = typeof stages[number]
type Outcome = typeof outcomes[number]
type Fields = { span?: number; elapsedMs?: number; count?: number; pending?: boolean; status?: number; code?: typeof codes[number] }
type TraceEvent = Fields & { at: number; stage: Stage; outcome: Outcome }
type TraceStorage = Pick<Storage, 'getItem' | 'setItem'>
const limit = 320
const retention = 7 * 24 * 60 * 60 * 1000
const allowed = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.some(candidate => candidate === value)
const numeric = (value: unknown, max: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max

function errorFields(error: unknown): Fields {
  try {
    if (!error || typeof error !== 'object') return {}
    const row = error as { code?: unknown; status?: unknown }
    return { ...(allowed(codes, row.code) ? { code: row.code } : {}),
      ...(numeric(row.status, 599) && row.status >= 400 ? { status: row.status } : {}) }
  } catch { return {} }
}

export function createSyncDiagnostics(enabled: boolean, getStorage: () => TraceStorage, now = Date.now) {
  let memory: TraceEvent[] = []
  let memoryOnly = false
  let sequence = 0
  function sanitize(value: unknown, at: number): TraceEvent | undefined {
    if (!value || typeof value !== 'object') return
    const row = value as Partial<TraceEvent>
    if (!numeric(row.at, 8_640_000_000_000_000) || row.at < at - retention || row.at > at + 60_000 ||
      !allowed(stages, row.stage) || !allowed(outcomes, row.outcome)) return
    // Rebuild each record from the closed schema, including on export.
    return { at: row.at, stage: row.stage, outcome: row.outcome,
      ...(numeric(row.span, Number.MAX_SAFE_INTEGER) ? { span: row.span } : {}),
      ...(numeric(row.elapsedMs, retention) ? { elapsedMs: row.elapsedMs } : {}),
      ...(numeric(row.count, 1_000_000) ? { count: row.count } : {}),
      ...(typeof row.pending === 'boolean' ? { pending: row.pending } : {}),
      ...errorFields(row) }
  }
  function clean(rows: unknown, at: number): TraceEvent[] {
    return Array.isArray(rows) ? rows.slice(-limit).flatMap(row => {
      const event = sanitize(row, at)
      return event ? [event] : []
    }) : []
  }
  function read(at: number): TraceEvent[] {
    if (!enabled) return []
    if (!memoryOnly) {
      try { memory = clean(JSON.parse(getStorage().getItem(syncDiagnosticKey) ?? '[]'), at) }
      catch { memoryOnly = true }
    }
    return clean(memory, at)
  }
  function mark(stage: Stage, outcome: Outcome, fields: Fields = {}) {
    if (!enabled) return
    try {
      const at = now()
      const event = sanitize({ ...fields, at, stage, outcome }, at)
      if (!event) return
      memory = [...read(at), event].slice(-limit)
      if (!memoryOnly) try { getStorage().setItem(syncDiagnosticKey, JSON.stringify(memory)) }
      catch { memoryOnly = true }
    } catch { /* Diagnostics must never interrupt shopping or authentication. */ }
  }
  function begin(stage: Stage, fields: Fields = {}) {
    if (!enabled) return (_outcome: Outcome, _fields?: Fields) => {}
    const started = now()
    // Correlation number for a local timing span only, never an account/item ID.
    const span = sequence = Math.max(sequence + 1, started * 1000)
    mark(stage, 'start', { ...fields, span })
    let closed = false
    return (outcome: Outcome, end: Fields = {}) => {
      if (closed) return
      closed = true
      mark(stage, outcome, { ...end, span, elapsedMs: Math.max(0, now() - started) })
    }
  }
  function exportLog(): string {
    const events = read(now()).map(({ at, ...row }) => ({ at: new Date(at).toISOString(), ...row }))
    return JSON.stringify({ version: 1, persistent: enabled && !memoryOnly, events }, null, 2)
  }
  return { mark, begin, exportLog }
}
const diagnostics = createSyncDiagnostics(syncDiagnosticsEnabled, () => localStorage)
export const markSync = diagnostics.mark
export const beginSync = diagnostics.begin
export const exportSyncLog = diagnostics.exportLog

/** Observe a promise without replacing its result, exception or timeout. */
export async function traceSync<T>(stage: Stage, action: () => PromiseLike<T>,
  fields: Fields = {}, accepted: (value: T) => boolean = () => true): Promise<T> {
  if (!syncDiagnosticsEnabled) return await action()
  const finish = beginSync(stage, fields)
  try {
    const value = await action()
    const ok = accepted(value)
    finish(ok ? 'ok' : 'rejected', ok ? {} : errorFields((value as { error?: unknown } | null)?.error))
    return value
  } catch (error) {
    finish('error', errorFields(error))
    throw error
  }
}
