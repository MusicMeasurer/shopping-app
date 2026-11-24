// Real read-only RPC compatibility; only the pinned disposable lab.
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readSyncEventBatch } from './sync-event-feed'
import { accumulateSyncEvidence } from './sync-event-fate'
import { parseAccountFeedChange } from './account-feed'

const env = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

describe.skipIf(env.E3_LAB_URL === undefined)('real semantic feed RPC on disposable lab', () => {
  it('reads the same account snapshot and delta as legacy, denies foreign access', async () => {
    const { E3_LAB_URL: url, E3_LAB_PUBLISHABLE_KEY: key, E3_USER_A_EMAIL: email,
      E3_USER_A_PASSWORD: password, E3_USER_B_EMAIL: emailB, E3_USER_B_PASSWORD: passwordB } = env
    if (!url || !key || !email || !password || !emailB || !passwordB) throw new Error('Missing lab configuration')
    expect(url).toBe('https://gmrqeubhotjpmtwokfeq.supabase.co')
    expect(key).toMatch(/^sb_publishable_/)
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    const a = createClient(url, key, options), b = createClient(url, key, options)
    try {
      const loginA = await a.auth.signInWithPassword({ email, password })
      const loginB = await b.auth.signInWithPassword({ email: emailB, password: passwordB })
      if (loginA.error) throw loginA.error
      if (loginB.error) throw loginB.error
      const accountId = loginA.data.user?.id, foreignId = loginB.data.user?.id
      if (!accountId || !foreignId || accountId === foreignId) throw new Error('Distinct lab accounts required')
      const initial = await readSyncEventBatch(a, accountId, undefined, () => true)
      if (initial.kind !== 'snapshot') throw new Error('Expected real account snapshot')
      expect(initial.changes.some(change => change.entity === 'list' && change.metadata !== null)).toBe(true)
      const head = BigInt(initial.position)
      const from = String(head > 100n ? head - 100n : 0n)
      const next = await readSyncEventBatch(a, accountId, from, () => true)
      if (next.kind !== 'delta') throw new Error('Expected real account delta')
      expect(next.events.length).toBeGreaterThan(0)
      expect(BigInt(next.through)).toBeGreaterThanOrEqual(head)
      const legacy = await a.rpc('pull_e4_account_changes', { p_account: accountId, p_after: from, p_limit: 200 })
      if (legacy.error) throw legacy.error
      expect(Array.isArray(legacy.data)).toBe(true)
      const rows = (legacy.data as Record<string, unknown>[]).filter(row => BigInt(String(row.event_position)) <= BigInt(next.through))
      expect(rows.map(row => ({ position: String(row.event_position), change: parseAccountFeedChange(row, accountId) })))
        .toEqual(next.events.slice(0, rows.length).map(({ position, change }) => ({ position, change })))
      expect(accumulateSyncEvidence(undefined, next).position).toBe(next.through)
      await expect(readSyncEventBatch(a, foreignId, '0', () => true)).rejects.toMatchObject({ code: '42501' })
      const foreign = await readSyncEventBatch(b, foreignId, undefined, () => true)
      expect(foreign).toMatchObject({ kind: 'snapshot', accountId: foreignId })
    } finally {
      await Promise.allSettled([a.auth.signOut({ scope: 'local' }), b.auth.signOut({ scope: 'local' })])
    }
  }, 30_000)
})
