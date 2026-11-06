// Read-only real-session isolation gate for the disposable Supabase lab.
// Required environment variables are injected at execution time; never commit credentials.
// The only write attempt must be rejected by RLS/RPC and therefore cannot persist.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const required = [
  'E3_LAB_URL', 'E3_LAB_PUBLISHABLE_KEY',
  'E3_USER_A_EMAIL', 'E3_USER_A_PASSWORD',
  'E3_USER_B_EMAIL', 'E3_USER_B_PASSWORD',
]
for (const key of required) {
  if (!process.env[key]) throw new Error('Missing required environment variable: ' + key)
}
const env = process.env
const expectedHost = 'gmrqeubhotjpmtwokfeq.supabase.co'
const url = new URL(env.E3_LAB_URL)
assert.equal(url.protocol, 'https:', 'HTTPS is required')
assert.equal(url.hostname, expectedHost, 'Only the disposable migration lab is permitted')
assert.match(env.E3_LAB_PUBLISHABLE_KEY, /^sb_publishable_/, 'Publishable key only')

async function login(email, password) {
  const client = createClient(env.E3_LAB_URL, env.E3_LAB_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Test login failed: ' + error.message)
  const { data, error: verifyError } = await client.auth.getUser()
  if (verifyError || !data.user) throw new Error('Server identity verification failed')
  return { client, id: data.user.id }
}
const a = await login(env.E3_USER_A_EMAIL, env.E3_USER_A_PASSWORD)
const b = await login(env.E3_USER_B_EMAIL, env.E3_USER_B_PASSWORD)
assert.notEqual(a.id, b.id, 'Test accounts must be distinct')

const { data: aLists, error: aError } = await a.client.from('shopping_lists').select('id,owner_id')
if (aError) throw aError
const owned = aLists.find(list => list.owner_id === a.id)
assert.ok(owned, 'User A must own a fixture list')

const { data: bLists, error: bError } = await b.client.from('shopping_lists').select('id')
if (bError) throw bError
assert.ok(!bLists.some(list => list.id === owned.id), 'User B can read A list')

const { data: bItems, error: itemError } = await b.client.from('shopping_items').select('id').eq('list_id', owned.id)
if (itemError) throw itemError
assert.equal(bItems.length, 0, 'User B can read A items')

const { error: denied } = await b.client.rpc('apply_item_change', {
  p_operation: crypto.randomUUID(),
  p_list: owned.id,
  p_action: 'add',
  p_item: crypto.randomUUID(),
  p_name: 'forbidden-integration-probe',
  p_purchased: false,
})
assert.ok(denied, 'User B unexpectedly wrote to A list')
assert.match(denied.message, /List unavailable/, 'Unexpected rejection reason')
console.log('PASS: two distinct server-verified users, private list/items, forbidden RPC write')
// Do not print tokens, passwords, emails or user IDs.
