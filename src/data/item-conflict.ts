import type { Item } from '../domain/shopping'

type Field = 'name' | 'purchased' | 'amount'
export type EditTimes = Partial<Record<Field, number>>

export function recordEditTimes(previous: Item, next: Item, times: EditTimes = {}, now = Date.now()): EditTimes {
  return {
    ...times,
    ...(previous.name !== next.name ? { name: now } : {}),
    ...(previous.purchased !== next.purchased ? { purchased: now } : {}),
    ...(previous.quantity !== next.quantity || previous.unit !== next.unit ? { amount: now } : {}),
  }
}

export function mergeItemEdit(base: Item, local: Item, cloud: Item, times: EditTimes, cloudTimes: EditTimes): Item {
  const preferLocal = (field: Field, cloudChanged: boolean) =>
    times[field] !== undefined && (!cloudChanged || times[field] > (cloudTimes[field] ?? Infinity))
  const amount = preferLocal('amount', base.quantity !== cloud.quantity || base.unit !== cloud.unit) ? local : cloud
  return {
    ...cloud,
    name: preferLocal('name', base.name !== cloud.name) ? local.name : cloud.name,
    purchased: preferLocal('purchased', base.purchased !== cloud.purchased) ? local.purchased : cloud.purchased,
    quantity: amount.quantity,
    unit: amount.unit,
  }
}

export interface ItemDeletionConflict {
  operationId: string
  localListId: Item['listId']
  remoteListId: string
  item: Item
  remoteVersion: number
  deleted: 'local' | 'cloud'
}
