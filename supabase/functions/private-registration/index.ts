import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

function reply(status: number, result: string) {
  return Response.json({ result }, { status, headers })
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return reply(405, 'invalid')

  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key || Deno.env.get('PRIVATE_REGISTRATION_TRUST_PROXY') !== 'true') return reply(503, 'unavailable')
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const { action, email, code, password } = await request.json()
    if (typeof email !== 'string' || email.length > 254) return reply(400, 'invalid')
    const address = email.trim().toLowerCase()
    if (action === 'request') {
      // Enable only behind a gateway verified to append the real IP as the final hop.
      const source = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
      if (!source) return reply(503, 'unavailable')
      const { data, error } = await client.rpc('enqueue_private_registration', { p_email: address, p_source: source })
      if (error) return reply(503, 'unavailable')
      return data === true ? reply(200, 'accepted') : reply(400, 'invalid')
    }
    if (action !== 'confirm' || typeof code !== 'string' || !/^\d{6}$/.test(code) ||
        typeof password !== 'string' || password.length < 8 || new TextEncoder().encode(password).length > 72)
      return reply(400, 'invalid')

    const { data, error } = await client.rpc('consume_private_registration_code', { p_email: address, p_code: code })
    if (error) return reply(503, 'unavailable')
    if (data !== true) return reply(200, 'invalid')

    // This call is for a verified address only. The DB registration guard and
    // Auth uniqueness still resolve races with deletion and concurrent creation.
    const { error: issue } = await client.auth.admin.createUser({ email: address, password, email_confirm: true })
    return issue ? reply(200, 'invalid') : reply(200, 'created')
  } catch {
    return reply(503, 'unavailable')
  }
})
