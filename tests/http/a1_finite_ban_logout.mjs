// A1 stage 4: real managed Auth, one disposable account only.
// The operator stages a tombstone with a short future retry_at and calls the
// installed revoke_account in one transaction. No public registration, mail,
// global worker changes, secret/API response logging, or persistent sessions.
import { createClient } from '@supabase/supabase-js'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = 'https://gmrqeubhotjpmtwokfeq.supabase.co'
const EMAIL = 'a1-stage4-20261127@example.com'
const sha = value => createHash('sha256').update(value).digest('hex')
const check = (ok, label) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label)
  if (!ok) throw new Error('test assertion failed')
}
const sessionData = client => client.auth.getSession()
const clients = []
let staged = false
let completed = false

async function main() {
  const marker = JSON.parse(readFileSync('tests/http/a1-stage4-start.json', 'utf8'))
  const pin = marker.accountSha256
  const key = process.env.E3_LAB_PUBLISHABLE_KEY ?? ''
  const password = process.env.E3_USER_D_PASSWORD ?? ''
  const protectedEmails = ['E3_USER_A_EMAIL', 'E3_USER_B_EMAIL', 'E3_USER_C_EMAIL']
    .map(name => (process.env[name] ?? '').trim().toLowerCase())
  check(process.env.E3_LAB_URL === BASE && key.startsWith('sb_publishable_'), 'pinned laboratory only')
  check(/^[a-f0-9]{64}$/.test(pin) && password.length >= 16 &&
    protectedEmails.every(Boolean) && !protectedEmails.includes(EMAIL), 'disposable identity and secret preconditions')
  const locked = JSON.parse(readFileSync('package-lock.json','utf8'))
  check(locked.packages['node_modules/@supabase/auth-js'].version === '2.119.0' &&
    locked.packages['node_modules/@supabase/supabase-js'].version === '2.119.0', 'SDK version pinned')
  const network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== BASE) throw new Error('unexpected network target')
    return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) })
  }
  const settings = await network(BASE + '/auth/v1/settings', { headers: { apikey: key } })
  check(settings.status === 200 && (await settings.json()).disable_signup === true, 'public signup disabled')
  const logoutResponses = []
  const make = (observe = false) => createClient(BASE, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      const response = await network(input, init)
      if (observe && url.pathname === '/auth/v1/logout') {
        logoutResponses.push({ status: response.status, scope: url.searchParams.get('scope'),
          at: new Date().toISOString() })
      }
      return response
    } }
  })
  const anon = make()
  const sessions = []
  const proofs = []
  for (let i=0; i<2; i++) {
    const client = make(i===0)
    clients.push(client)
    const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password })
    check(!error && !!data.session && !!data.user && sha(data.user.id) === pin, 'login and UUID pin '+(i+1))
    const { data: verified, error: verifyError } = await client.auth.getUser()
    check(!verifyError && !!verified.user && sha(verified.user.id) === pin &&
      verified.user.email?.toLowerCase() === EMAIL, 'server identity '+(i+1))
    const jwt = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString('utf8'))
    check(jwt.sub === verified.user.id && typeof jwt.session_id === 'string' &&
      jwt.exp > Date.now()/1000 + 420, 'token lifetime and identity '+(i+1))
    sessions.push({ access: data.session.access_token, refresh: data.session.refresh_token,
      sid: jwt.session_id, exp: jwt.exp })
    const proof = { p_account: verified.user.id, p_device: randomUUID(), p_proof: randomUUID() }
    const register = await client.rpc('register_account_deletion_installation', proof)
    check(!register.error && register.data === true, 'installation proof registered '+(i+1))
    const state = await anon.rpc('account_deletion_installation_status', proof)
    check(!state.error && state.data === 'active', 'installation initially active '+(i+1))
    proofs.push(proof)
  }
  check(sessions[0].sid !== sessions[1].sid, 'two independent sessions')
  console.log('READY_FOR_SCOPED_SQL_FIXTURE; waiting at most 5 minutes')
  const deadline = Date.now()+300000
  while(Date.now()<deadline) {
    const state = await anon.rpc('account_deletion_installation_status', proofs[0])
    check(!state.error && (state.data === 'active' || state.data === 'deleted'), 'installation status valid')
    if(state.data === 'deleted') { staged = true; break }
    await sleep(2500)
  }
  check(staged, 'committed deletion marker observed')
  check(sessions.every(s => s.exp > Date.now()/1000), 'old JWTs not expired')
  const { data: before, error: beforeError } = await sessionData(clients[0])
  check(!beforeError && before.session?.access_token === sessions[0].access, 'SDK still holds the original local session')
  const started = new Date().toISOString()
  const result = await clients[0].auth.signOut({ scope: 'local' })
  const ended = new Date().toISOString()
  // An actual request is the experiment's required observation, not an
  // assertion that every SDK retry must send a fixed number of requests.
  console.log('SDK logout interval '+started+' .. '+ended)
  for(const record of logoutResponses) console.log('SDK logout HTTP '+record.status+' '+record.at)
  check(logoutResponses.some(r=>r.scope==='local') &&
    logoutResponses.every(r=>r.scope==='local' && [200,204,401,403,404].includes(r.status)),
    'real local Auth logout observed without HTTP 500')
  check(!result.error, 'first SDK logout succeeds')
  const after = await sessionData(clients[0])
  check(!after.error && after.data.session === null, 'SDK session cleared')
  const second = sessions[1]
  const guarded = await network(BASE+'/rest/v1/shopping_lists?select=id&limit=1',
    { headers: { apikey:key, Authorization:'Bearer '+second.access } })
  const guardBody = await guarded.json().catch(()=>null)
  check([401,403].includes(guarded.status) && guardBody?.code==='42501', 'old JWT rejected by API guard')
  const refresh = await network(BASE+'/auth/v1/token?grant_type=refresh_token', {
    method:'POST', headers:{ apikey:key, 'Content-Type':'application/json' },
    body:JSON.stringify({refresh_token:second.refresh}) })
  const refreshed = await refresh.json().catch(()=>null)
  check([400,401,403].includes(refresh.status) && !refreshed?.access_token, 'old refresh cannot issue a token')
  const newLogin = await make().auth.signInWithPassword({email:EMAIL,password})
  check(!!newLogin.error && !newLogin.data.session, 'new login denied during block')
  for (const proof of proofs) {
    const ack = await anon.rpc('acknowledge_account_deletion_installation',proof)
    check(!ack.error && ack.data===true, 'test installation cleanup acknowledged')
  }
  completed = true
}

try { await main() }
catch { console.error('A1 test failed; details suppressed to protect credentials'); process.exitCode = 1 }
finally {
  // Before staging, revoke only sessions created by this run. Once staged,
  // the existing worker owns cleanup; do not make further logout requests
  // that could contaminate the observation window.
  if (!staged) {
    for (const client of clients) {
      try { await client.auth.signOut({scope:'local'}) } catch {}
    }
  }
  console.log(completed ? 'A1 HTTP/SDK assertions passed; independent SQL timing and worker cleanup still required'
    : 'A1 not accepted; operator must verify scoped cleanup')
}
