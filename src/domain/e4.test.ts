import { describe, it, expect } from 'vitest'
import { createItem, parseItems, validateName, itemsForList } from './shopping'
describe('E4 domain', () => {
  it('accepts dynamic list IDs', () => {
    const item = createItem('custom-123', ' Кофе ')
    expect(item.listId).toBe('custom-123')
    expect(itemsForList([item], 'custom-123')).toEqual([item])
  })
  it('parses multiline input without inventing quantities', () => {
    expect(parseItems(' Молоко \n\n Хлеб\r\n Соль ')).toEqual([{ name: 'Молоко' }, { name: 'Хлеб' }, { name: 'Соль' }])
  })
  it('extracts explicit quantities and units, retaining ambiguous text verbatim', () => {
    expect(parseItems('Молоко 2 л\nМука 1,5 кг\nЯйца 10 шт\nСахар 2\nКофе 200г\nВода 0 л')).toEqual([
      { name: 'Молоко', quantity: 2, unit: 'л' },
      { name: 'Мука', quantity: 1.5, unit: 'кг' },
      { name: 'Яйца', quantity: 10, unit: 'шт' },
      { name: 'Сахар 2' },
      { name: 'Кофе 200г' },
      { name: 'Вода 0 л' },
    ])
  })
  it('rejects empty and oversized entries', () => {
    expect(() => parseItems('\n  ')).toThrow()
    expect(() => parseItems('Молоко\n' + 'я'.repeat(121))).toThrow()
    expect(validateName(' Сахар ')).toBe('Сахар')
  })
})
