// Lab-only Siri pairing exchange. Does not implement one-button onboarding by itself.
// The 64-hex one-use code is exchanged by a neutral Shortcut, never displayed in UI.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})
const codePattern = /^[0-9a-f]{64}$/

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if ((request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() !== 'application/json')
    return json({ error: 'Expected JSON' }, 415)
  if (Number(request.headers.get('content-length') || 0) > 1024)
    return json({ error: 'Request too large' }, 413)
  let data: unknown
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > 1024) return json({ error: 'Request too large' }, 413)
    data = JSON.parse(raw)
  } catch { return json({ error: 'Invalid JSON' }, 400) }
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      typeof (data as Record<string, unknown>).pairingCode !== 'string' ||
      !codePattern.test((data as Record<string, string>).pairingCode))
    return json({ error: 'Invalid request' }, 400)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ error: 'Unavailable' }, 503)
  try {
    const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: credential, error } = await client.rpc('exchange_siri_pairing', {
      p_code: (data as Record<string, string>).pairingCode,
    })
    if (error || !credential) return json({ error: 'Pairing unavailable' }, 403)
    return json({ token: credential.token, listId: credential.list_id }, 200)
  } catch {
    return json({ error: 'Service temporarily unavailable' }, 503)
  }
})
