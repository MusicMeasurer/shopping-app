import { describe, expect, it } from 'vitest'
import { normalizeItemName, parseItem, parseItems, validateName } from './shopping'

describe('E3/E4 shared input contracts', () => {
  it('retains E3 trimming and validation', () => {
    expect(normalizeItemName('  Молоко  ')).toBe('Молоко')
    expect(validateName('  ')).toThrow()
    expect(validateName('x'.repeat(121))).toThrow()
  })
  it('parses quantity and units with comma or dot', () => {
    expect(parseItem('Молоко 2 л')).toEqual({ name: 'Молоко', quantity: 2, unit: 'л' })
    expect(parseItem('Сахар 1,5 кг')).toEqual({ name: 'Сахар', quantity: 1.5, unit: 'кг' })
    expect(parseItem('Хлеб')).toEqual({ name: 'Хлеб' })
  })
  it('splits Windows and Unix multiline input without merging products', () => {
    expect(parseItems('Молоко 2 л\r\nХлеб\nЯблоки 3 кг')).toEqual([
      { name: 'Молоко', quantity: 2, unit: 'л' },
      { name: 'Хлеб' },
      { name: 'Яблоки', quantity: 3, unit: 'кг' },
    ])
  })
  it('rejects empty multiline input', () => {
    expect(() => parseItems('\n \r\n')).toThrow()
  })
})
