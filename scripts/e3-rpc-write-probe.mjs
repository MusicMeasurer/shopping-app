// Destructive integration probe: disposable Supabase lab ONLY.
// Companion IndexedDB-to-RPC integration is exercised by the e3-lab workflow.
// Creates a uniquely named item and soft-deletes it via the authenticated RPC.
// Secrets are provided only by the GitHub Actions e3-lab environment.
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'

const env = process.env
for (const key of ['E3_LAB_URL', 'E3_LAB_PUBLISHABLE_KEY', 'E3_USER_A_EMAIL',
  'E3_USER_A_PASSWORD', 'E3_USER_B_EMAIL', 'E3_USER_B_PASSWORD']) {
  assert.ok(env[key], 'Missing required environment variable: ' + key)
}
const url = new URL(env.E3_LAB_URL)
assert.equal(url.protocol, 'https:')
assert.equal(url.hostname, 'gmrqeubhotjpmtwokfeq.supabase.co', 'Disposable lab only')
assert.match(env.E3_LAB_PUBLISHABLE_KEY, /^sb_publishable_/)

async function login(email, password) {
  const client = createClient(env.E3_LAB_URL, env.E3_LAB_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error('Test login failed: ' + error.message)
  const { data, error: identityError } = await client.auth.getUser()
  if (identityError || !data.user) throw new Error('Server identity verification failed')
  return { client, id: data.user.id }
}
const a = await login(env.E3_USER_A_EMAIL, env.E3_USER_A_PASSWORD)
const b = await login(env.E3_USER_B_EMAIL, env.E3_USER_B_PASSWORD)
assert.notEqual(a.id, b.id)
const { data: lists, error: listError } = await a.client.from('shopping_lists').select('id,owner_id')
if (listError) throw listError
const { data: otherLists, error: otherError } = await b.client.from('shopping_lists').select('id,owner_id')
if (otherError) throw otherError
const owned = lists.find(row => row.owner_id === a.id) || otherLists.find(row => row.owner_id === b.id)
assert.ok(owned, 'No owned disposable test list')
const owner = owned.owner_id === a.id ? a : b
const outsider = owned.owner_id === a.id ? b : a
const itemId = crypto.randomUUID()
const operationId = crypto.randomUUID()
const name = 'E3_SYNC_PROBE_' + itemId
const add = {
  p_operation: operationId, p_list: owned.id, p_action: 'add',
  p_item: itemId, p_name: name, p_purchased: false, p_expected_version: null,
}
async function rpc(client, args) {
  return client.rpc('apply_item_change', args)
}
let added = false
let version
try {
  const first = await rpc(owner.client, add)
  if (first.error) throw first.error
  added = true
  assert.equal(first.data.operation_id, operationId)
  version = first.data.item_version
  assert.ok(Number.isSafeInteger(version))
  const replay = await rpc(owner.client, add)
  if (replay.error) throw replay.error
  assert.deepEqual(replay.data, first.data, 'Idempotent replay must return original receipt')

  const changedPayload = await rpc(owner.client, { ...add, p_name: name + '_changed' })
  assert.ok(changedPayload.error, 'Operation ID reuse with different payload must fail')

  const outsiderWrite = await rpc(outsider.client, {
    ...add, p_operation: crypto.randomUUID(), p_action: 'update',
    p_expected_version: version, p_name: name + '_outsider',
  })
  assert.ok(outsiderWrite.error, 'Outsider update must fail')

  const stale = await rpc(owner.client, {
    ...add, p_operation: crypto.randomUUID(), p_action: 'update',
    p_expected_version: version + 99, p_name: name + '_stale',
  })
  assert.ok(stale.error, 'Stale version must fail')

  const update = await rpc(owner.client, {
    ...add, p_operation: crypto.randomUUID(), p_action: 'update',
    p_expected_version: version, p_name: name, p_purchased: true,
  })
  if (update.error) throw update.error
  assert.equal(update.data.item_version, version + 1)
  version = update.data.item_version

  const { data: visible, error: readError } = await owner.client.from('shopping_items')
    .select('id,purchased,version').eq('id', itemId)
  if (readError) throw readError
  assert.equal(visible.length, 1)
  assert.equal(visible[0].purchased, true)
  assert.equal(visible[0].version, version)
  console.log('PASS: authenticated add, idempotent replay, payload mismatch, outsider denial, version conflict, update')
} finally {
  if (added) {
    // Always attempt cleanup, even after a failed assertion.
    const { data: rows, error } = await owner.client.from('shopping_items')
      .select('version').eq('id', itemId)
    if (error) throw error
    if (rows.length) {
      const deleted = await rpc(owner.client, {
        p_operation: crypto.randomUUID(), p_list: owned.id, p_action: 'delete',
        p_item: itemId, p_name: null, p_purchased: null, p_expected_version: rows[0].version,
      })
      if (deleted.error) throw deleted.error
      const { data: after, error: afterError } = await owner.client.from('shopping_items')
        .select('id').eq('id', itemId)
      if (afterError) throw afterError
      assert.equal(after.length, 0, 'Soft-deleted probe must be invisible')
      console.log('PASS: versioned delete and cleanup')
    }
  }
}
// Do not print tokens, passwords, emails, or account IDs.
