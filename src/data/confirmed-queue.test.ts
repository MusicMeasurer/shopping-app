import { describe, expect, it, vi } from 'vitest'
import { drainConfirmedQueue } from './confirmed-queue'

type Op = { operationId: string }
const one: Op = { operationId: 'one' }
const two: Op = { operationId: 'two' }

function queue(initial: Op[]) {
  let pending = [...initial]
  const read = vi.fn(async () => [...pending])
  const ack = vi.fn(async (id: string) => { pending = pending.filter(op => op.operationId !== id) })
  return { read, ack, get pending() { return pending } }
}
describe('confirmed queue draining', () => {
  it('sends in order and acknowledges only after each successful send', async () => {
    const q = queue([one, two])
    const calls: string[] = []
    const send = vi.fn(async (op: Op) => {
      calls.push('send:' + op.operationId)
      expect(q.pending).toContain(op)
    })
    const ack = async (id: string) => { calls.push('ack:' + id); await q.ack(id) }
    expect(await drainConfirmedQueue(q.read, send, ack)).toBe(2)
    expect(calls).toEqual(['send:one', 'ack:one', 'send:two', 'ack:two'])
    expect(q.pending).toEqual([])
  })
  it('keeps the failed operation and all following operations queued', async () => {
    const q = queue([one, two])
    const send = vi.fn(async () => { throw new Error('Version conflict') })
    await expect(drainConfirmedQueue(q.read, send, q.ack)).rejects.toThrow('Version conflict')
    expect(q.pending).toEqual([one, two])
    expect(q.ack).not.toHaveBeenCalled()
  })
  it('does not acknowledge after an account switch during an in-flight request', async () => {
    const q = queue([one])
    let active = true
    expect(await drainConfirmedQueue(q.read, async () => { active = false }, q.ack, () => active)).toBe(0)
    expect(q.pending).toEqual([one])
  })
  it('can resume safely after a partial success', async () => {
    const q = queue([one, two])
    let attempts = 0
    await expect(drainConfirmedQueue(q.read, async () => {
      attempts++
      if (attempts === 2) throw new Error('offline')
    }, q.ack)).rejects.toThrow('offline')
    expect(q.pending).toEqual([two])
    expect(await drainConfirmedQueue(q.read, async () => {}, q.ack)).toBe(1)
    expect(q.pending).toEqual([])
  })
})
