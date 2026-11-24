export type AxisAnchor = { id: string; start: number; end: number }

/** Prefer the first intersecting stable row, then other visible rows,
 * then nearest surviving neighbours. No names or array indices are identities. */
export function anchorCandidates(rows: readonly AxisAnchor[], start: number, end: number): AxisAnchor[] {
  const visible = rows.filter(row => row.end > start && row.start < end)
  if (!visible.length) return []
  const first = rows.indexOf(visible[0]), last = rows.indexOf(visible[visible.length - 1])
  const neighbours: AxisAnchor[] = []
  for (let distance = 1; first - distance >= 0 || last + distance < rows.length; distance++) {
    if (last + distance < rows.length) neighbours.push(rows[last + distance])
    if (first - distance >= 0) neighbours.push(rows[first - distance])
  }
  return [...visible, ...neighbours]
}

/** Return only the missing correction: native anchoring may already have
 * preserved the row. Clamp to scroll range without trying to recreate it. */
export function anchoredOffset(candidates: readonly AxisAnchor[], current: readonly AxisAnchor[],
  offset: number, previousOffset: number, maximum: number): number {
  const byId = new Map(current.map(row => [row.id, row]))
  const anchor = candidates.find(row => byId.has(row.id))
  const target = anchor ? offset + byId.get(anchor.id)!.start - anchor.start : previousOffset
  return Math.min(Math.max(0, maximum), Math.max(0, target))
}
