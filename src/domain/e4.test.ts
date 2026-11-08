import { describe, it, expect } from 'vitest'
import { createItem, parseItems, validateName, itemsForList } from './shopping'
describe('E4 domain', () => {
  it('accepts dynamic list IDs', () => {
    const item = createItem('custom-123', ' Кофе ')
    expect(item.listId).toBe('custom-123')
    expect(itemsForList([item], 'custom-123')).toEqual([item])
  })
  it('parses multiline input without inventing quantities', () => {
    expect(parseItems(' Молоко \n\n Хлеб\r\n Соль ')).toEqual(['Молоко', 'Хлеб', 'Соль'])
  })
  it('rejects empty and oversized entries', () => {
    expect(() => parseItems('\n  ')).toThrow()
    expect(() => parseItems('Молоко\n' + 'я'.repeat(121))).toThrow()
    expect(validateName(' Сахар ')).toBe('Сахар')
  })
})
