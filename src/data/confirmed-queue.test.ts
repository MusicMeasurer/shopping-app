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
  it('does not send when account is already inactive', async () => {
    const q = queue([one])
    const send = vi.fn(async () => {})
    expect(await drainConfirmedQueue(q.read, send, q.ack, () => false)).toBe(0)
    expect(q.read).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(q.pending).toEqual([one])
  })
  it('does not send after the account becomes inactive during queue read', async () => {
    const q = queue([one])
    let active = true
    const send = vi.fn(async () => {})
    const read = async () => { active = false; return q.read() }
    expect(await drainConfirmedQueue(read, send, q.ack, () => active)).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(q.pending).toEqual([one])
  })
  it('rejects missing operation identifiers without sending or acknowledging', async () => {
    const q = queue([{ operationId: '  ' }])
    const send = vi.fn(async () => {})
    await expect(drainConfirmedQueue(q.read, send, q.ack)).rejects.toThrow('Missing operation ID')
    expect(send).not.toHaveBeenCalled()
    expect(q.ack).not.toHaveBeenCalled()
  })
  it('does not acknowledge a server operation if receipt persistence fails', async () => {
    const q = queue([one])
    const send = vi.fn(async () => {})
    const commit = vi.fn(async () => { throw new Error('Storage unavailable') })
    await expect(drainConfirmedQueue(q.read, send, commit)).rejects.toThrow('Storage unavailable')
    expect(q.pending).toEqual([one])
    expect(send).toHaveBeenCalledTimes(1)
    expect(q.ack).not.toHaveBeenCalled()
  })
  it('does not reprocess an operation if acknowledgement leaves it visible temporarily', async () => {
    const q = queue([one])
    const send = vi.fn(async () => {})
    const acknowledge = vi.fn(async () => {})
    expect(await drainConfirmedQueue(q.read, send, acknowledge)).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledTimes(1)
  })

})
