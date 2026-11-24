import { describe, expect, it } from 'vitest'
import { anchorCandidates, anchoredOffset } from './viewport-anchor'
const row = (id: string, start: number, end = start + 40) => ({ id, start, end })
describe('stable viewport anchors', () => {
  const rows = [row('a', -60), row('b', -20), row('c', 20), row('d', 60), row('e', 100)]
  it('uses the first partially visible row, then other visible rows and nearby neighbours', () => {
    expect(anchorCandidates(rows, 0, 80).map(x => x.id)).toEqual(['b','c','d','e','a'])
  })
  it('corrects insertion before the same row, independently of its index', () => {
    expect(anchoredOffset(anchorCandidates(rows, 0, 80), [row('new', -20), row('b', 20)], 100, 100, 500)).toBe(140)
  })
  it('preserves a surviving visible neighbour when the original anchor is deleted', () => {
    expect(anchoredOffset(anchorCandidates(rows, 0, 80), [row('c', -20), row('d', 20)], 100, 100, 500)).toBe(60)
  })
  it('does not double-correct native scroll anchoring', () => {
    expect(anchoredOffset(anchorCandidates(rows, 0, 80), [row('b', -20)], 140, 100, 500)).toBe(140)
  })
  it('uses a bounded offset if no anchor survives', () => {
    expect(anchoredOffset(anchorCandidates(rows, 0, 80), [], 60, 100, 75)).toBe(75)
    expect(anchoredOffset([], [], 10, 10, -3)).toBe(0)
  })
  it('does not anchor off-screen rows', () => {
    expect(anchorCandidates(rows, 200, 300)).toEqual([])
  })
})
