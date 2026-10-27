import { describe, it, expect } from 'vitest'
import { createItem, itemsForList } from './shopping'
describe('shopping domain', () => {
  it('trims names and rejects blank or oversized names', () => {
    expect(createItem('groceries', ' Молоко ').name).toBe('Молоко')
    expect(() => createItem('groceries', '  ')).toThrow()
    expect(() => createItem('groceries', 'я'.repeat(121))).toThrow()
  })
  it('keeps lists separate and purchased items last', () => {
    const first = { ...createItem('groceries', 'Молоко'), purchased: true, createdAt: 1 }
    const second = { ...createItem('groceries', 'Хлеб'), createdAt: 2 }
    expect(itemsForList([first, createItem('household', 'Мыло'), second], 'groceries')).toEqual([second, first])
  })
})
