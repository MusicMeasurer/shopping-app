// E3 draft: not deployed. Requires reviewed 020_siri_add_REVIEW_ONLY.sql.
// Deploy with JWT verification disabled ONLY for this endpoint; it authenticates
// a separately scoped Shortcut token, never a Supabase user session.
import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'Expected JSON' }, 415)
  }
  const length = Number(request.headers.get('content-length') || 0)
  if (length > 4096) return json({ error: 'Request too large' }, 413)
  const auth = request.headers.get('authorization') || ''
  const match = /^Bearer ([0-9a-f]{64})$/.exec(auth)
  if (!match) return json({ error: 'Unauthorized' }, 401)
  let input: unknown
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 4096) return json({ error: 'Request too large' }, 413)
    input = JSON.parse(raw)
  } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return json({ error: 'Invalid request' }, 400)
  const data = input as Record<string, unknown>
  if (Object.keys(data).some(key => !['operationId', 'listId', 'name'].includes(key)) ||
      typeof data.operationId !== 'string' || !uuid.test(data.operationId) ||
      typeof data.listId !== 'string' || !uuid.test(data.listId) ||
      typeof data.name !== 'string' || !data.name.trim() ||
      data.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(data.name)) {
    return json({ error: 'Invalid request' }, 400)
  }
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Unavailable' }, 503)
  try {
    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: receipt, error } = await client.rpc('siri_add_item', {
      p_token: match[1], p_operation: data.operationId,
      p_list: data.listId, p_name: data.name.trim(),
    })
    if (error) {
      // Avoid leaking credential, SQL errors, or whether a list exists.
      return json({ error: 'Not authorized or unable to add item' }, 403)
    }
    return json({ ok: true, receipt }, 200)
  } catch {
    return json({ error: 'Service temporarily unavailable' }, 503)
  }
})
