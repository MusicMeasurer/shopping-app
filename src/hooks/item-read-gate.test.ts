import { describe, expect, it } from 'vitest'
import { ItemReadGate } from './item-read-gate'

describe('item cache refresh gate', () => {
  function ready() {
    const gate = new ItemReadGate()
    expect(gate.finishRead(gate.startRead())).toBe(true)
    return gate
  }
  it('blocks only initial and explicitly requested reads, not ordinary background refreshes', () => {
    const gate = new ItemReadGate()
    expect(gate.blocking).toBe(true)
    expect(gate.startWrite()).toBe(false)
    expect(gate.finishRead(gate.startRead())).toBe(true)
    const refresh = gate.startRead()
    expect(gate.blocking).toBe(false)
    expect(gate.finishRead(refresh)).toBe(true)
    const explicit = gate.startRead(true)
    expect(gate.blocking).toBe(true)
    expect(gate.startWrite()).toBe(false)
    expect(gate.finishRead(explicit)).toBe(true)
    expect(gate.blocking).toBe(false)
  })
  it('accepts only the most recent read, including when a blocking read is superseded', () => {
    const gate = ready()
    const first = gate.startRead(true)
    const latest = gate.startRead()
    expect(gate.finishRead(first)).toBe(false)
    expect(gate.blocking).toBe(true)
    expect(gate.finishRead(latest)).toBe(true)
    expect(gate.finishRead(first)).toBe(false)
    expect(gate.blocking).toBe(false)
  })
  it('invalidates the read started before a write and requests a fresh snapshot', () => {
    const gate = ready()
    const stale = gate.startRead()
    expect(gate.startWrite()).toBe(true)
    expect(gate.startWrite()).toBe(false)
    expect(gate.finishRead(stale)).toBe(false)
    expect(gate.finishWrite()).toBe(true)
    expect(gate.finishRead(gate.startRead())).toBe(true)
  })
  it('invalidates reads still running at commit and reconciles those completed during the write', () => {
    const gate = ready()
    expect(gate.startWrite()).toBe(true)
    expect(gate.finishRead(gate.startRead())).toBe(true)
    const inFlight = gate.startRead()
    expect(gate.finishWrite()).toBe(true)
    expect(gate.finishRead(inFlight)).toBe(false)
    expect(gate.finishRead(gate.startRead())).toBe(true)
  })
  it('adds no redundant read when a mutation did not overlap a refresh', () => {
    const gate = ready()
    expect(gate.startWrite()).toBe(true)
    expect(gate.finishWrite()).toBe(false)
    expect(gate.startWrite()).toBe(true)
    expect(gate.finishWrite()).toBe(false)
  })
  it('ignores a late read from a disposed effect', () => {
    const gate = ready()
    const previous = gate.startRead()
    gate.invalidateRead()
    expect(gate.finishRead(previous)).toBe(false)
    expect(gate.finishRead(gate.startRead())).toBe(true)
  })
})
