import { lists } from './domain/shopping'

export const defaultListSymbol = '🛒'
const symbols = [
  [defaultListSymbol, 'Корзина'], [lists[0].symbol, 'Зелень'], [lists[1].symbol, 'Метла'],
  ['🍎', 'Яблоко'], ['🧴', 'Флакон'], ['🐾', 'Лапы'], ['🧰', 'Инструменты'],
  ['🎁', 'Подарок'], ['🎒', 'Рюкзак'], ['🪴', 'Растение'], ['💊', 'Лекарства'],
]

export function ListSymbolPicker({ value, onChange, disabled }: {
  value: string
  onChange: (symbol: string) => void
  disabled?: boolean
}) {
  const options = symbols.some(([symbol]) => symbol === value)
    ? symbols : [...symbols, [value, 'Текущая пиктограмма']]
  return <fieldset className="list-symbol-picker" disabled={disabled}>
    <legend>Пиктограмма списка</legend>
    {options.map(([symbol, name]) => <button type="button" key={symbol}
      aria-label={name} aria-pressed={value === symbol} onClick={() => onChange(symbol)}>
      <span aria-hidden="true">{symbol}</span>
    </button>)}
  </fieldset>
}
