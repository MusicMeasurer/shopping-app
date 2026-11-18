import { describe, it, expect } from 'vitest'
import { createItem, createItemBatch, itemsForList, parseItems, sortShoppingItems } from './shopping'
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

describe('shopping item sort', () => {
  const list = 'groceries'
  const names = (items: { name: string }[]) => items.map(item => item.name)
  const batch = createItemBatch(list, parseItems('Мясо 2 кг\nФасоль 1 уп.\nМорковь 5 шт.\nМука 1 кг\nЯйца 10 шт.'), [], 10)

  it('preserves the order within the newest batch, even if the clock did not advance', () => {
    const newer = createItemBatch(list, parseItems('Чай\nСахар'), batch, 10)
    expect(names(sortShoppingItems([...batch, ...newer], 'recent'))).toEqual([
      'Чай', 'Сахар', 'Мясо', 'Фасоль', 'Морковь', 'Мука', 'Яйца',
    ])
    expect(names(sortShoppingItems(newer, 'name-desc'))).toEqual(['Чай', 'Сахар'])
    expect(names(sortShoppingItems(newer, 'name-asc'))).toEqual(['Сахар', 'Чай'])
  })

  it('keeps units in alphabetical order and sorts quantities within each group in either direction', () => {
    expect(names(sortShoppingItems(batch, 'quantity-asc'))).toEqual(['Мука', 'Мясо', 'Фасоль', 'Морковь', 'Яйца'])
    expect(names(sortShoppingItems(batch, 'quantity-desc'))).toEqual(['Мясо', 'Мука', 'Фасоль', 'Яйца', 'Морковь'])
  })

  it('places unspecified quantities and units last, breaking quantity ties by name', () => {
    const entries = createItemBatch(list, [
      { name: 'Яблоки', quantity: 2, unit: 'шт.' },
      { name: 'Апельсины', quantity: 2, unit: 'ШТ' },
      { name: 'Виноград', unit: 'шт' },
      { name: 'Груши', quantity: 1 },
    ], [], 10)
    expect(names(sortShoppingItems(entries, 'quantity-desc'))).toEqual(['Апельсины', 'Яблоки', 'Виноград', 'Груши'])
  })
})
