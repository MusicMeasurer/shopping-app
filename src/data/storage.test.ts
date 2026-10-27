import 'fake-indexeddb/auto'
import { it, expect } from 'vitest'
import { createStorage } from './storage'
import { createItem } from '../domain/shopping'
it('persists both lists, purchases and deletion across database connections', async () => {
  const name = `test-${crypto.randomUUID()}`
  const first = createStorage(name)
  const food = createItem('groceries', 'Молоко')
  const household = createItem('household', 'Мыло')
  await first.save(food); await first.save(household); await first.close()
  const second = createStorage(name)
  expect(await second.read()).toHaveLength(2)
  await second.save({ ...food, purchased: true }); await second.remove(household.id); await second.close()
  const third = createStorage(name)
  expect(await third.read()).toEqual([{ ...food, purchased: true }])
  await third.close()
})
