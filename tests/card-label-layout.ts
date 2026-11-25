import { expect, type Locator } from '@playwright/test'

/** Compare relative geometry, not viewport coordinates (the rail may scroll). */
async function geometry(card: Locator) {
  return card.evaluate(button => {
    const label = button.querySelector<HTMLElement>('.list-name')!
    const slot = button.querySelector<HTMLElement>('.list-name-wrap')!
    const symbol = button.querySelector<HTMLElement>('.list-symbol')!
    const menu = button.parentElement!.querySelector<HTMLElement>('.menu-anchor')!
    const controls = button.parentElement!.querySelector<HTMLElement>('.list-rail-controls')
    const bounds = button.getBoundingClientRect(), text = label.getBoundingClientRect()
    const row = slot.getBoundingClientRect(), icon = symbol.getBoundingClientRect()
    const menuRect = menu.getBoundingClientRect()
    const style = getComputedStyle(label)
    const lineHeight = parseFloat(style.lineHeight)
    return {
      font: parseFloat(style.fontSize), lineHeight, height: text.height,
      top: text.top - bounds.top, bottom: bounds.bottom - text.bottom,
      left: text.left - bounds.left, cardHeight: bounds.height,
      centered: Math.abs((text.top + text.bottom) - (row.top + row.bottom)) < 2,
      inside: text.top >= row.top - 1 && text.bottom <= row.bottom + 1 &&
        text.left >= row.left - 1 && text.right <= row.right + 1 &&
        text.top >= icon.bottom - 1 && text.top >= menuRect.bottom - 1,
      controlsClear: !controls || text.bottom <= controls.getBoundingClientRect().top + 1,
    }
  })
}

export async function checkStandardCardLabels(first: Locator, second: Locator, expectedLines?: readonly [number, number]) {
  // Click the pictogram: the central error indicator has its own action.
  await first.locator('.list-symbol').click()
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  const before = [await geometry(first), await geometry(second)]
  await second.locator('.list-symbol').click()
  await expect(second).toHaveAttribute('aria-pressed', 'true')
  const after = [await geometry(first), await geometry(second)]
  for (const [i, a] of before.entries()) {
    const b = after[i]
    for (const value of [a, b]) {
      expect(value.font).toBeCloseTo(14.3, 1)
      expect(value.centered).toBe(true)
      expect(value.inside).toBe(true)
      expect(value.controlsClear).toBe(true)
      expect(value.height).toBeGreaterThanOrEqual(value.lineHeight - 1)
      expect(value.height).toBeLessThanOrEqual(2 * value.lineHeight + 1)
      if (expectedLines) expect(Math.abs(value.height - expectedLines[i] * value.lineHeight)).toBeLessThan(1)
    }
    for (const key of ['top', 'bottom', 'left', 'height', 'cardHeight'] as const)
      expect(Math.abs(a[key] - b[key]), 'Selection must not move the label: ' + key).toBeLessThan(1)
  }
}
