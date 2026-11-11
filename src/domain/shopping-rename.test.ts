import { describe, expect, it } from 'vitest'
import { createItem, normalizeItemName } from './shopping'

describe('FR-003-03 rename item validation', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeItemName('  Молоко  ')).toBe('Молоко')
  })
  it('rejects empty or overlong names', () => {
    expect(() => normalizeItemName('   ')).toThrow()
    expect(() => normalizeItemName('а'.repeat(121))).toThrow()
  })
  it('does not change existing item ID, purchased state, or list when renamed', () => {
    const item = createItem('groceries', 'Молоко')
    const renamed = { ...item, name: normalizeItemName('  Кефир  ') }
    expect(renamed).toMatchObject({ id: item.id, listId: 'groceries', purchased: item.purchased, createdAt: item.createdAt, name: 'Кефир' })
  })
})
