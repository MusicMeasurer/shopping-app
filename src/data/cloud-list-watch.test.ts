import 'fake-indexeddb/auto'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { afterEach, expect, it, vi } from 'vitest'
import { watchCloudListChanges } from './cloud-list-watch'
import { createAccountSync } from './account-sync'
import { createStorage } from './storage'

function connect(refresh = vi.fn<() => void>()) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  let broadcast = () => {}
  let status = (_: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED') => {}
  const channel = {
    on: vi.fn((_type, _filter, callback) => { broadcast = callback; return channel }),
    subscribe: vi.fn(callback => { status = callback; return channel }),
  }
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => 'ok') }
  const stop = watchCloudListChanges(client as unknown as SupabaseClient, 'account-a', refresh)
  return { client, channel, broadcast: () => broadcast(), status: (value: Parameters<typeof status>[0]) => status(value), refresh, stop }
}
afterEach(() => vi.useRealTimers())

it('uses a private account channel and coalesces broadcasts', () => {
  const { client, channel, broadcast, status, refresh, stop } = connect()
  expect(client.channel).toHaveBeenCalledWith('shopping-lists:account-a', { config: { private: true } })
  expect(channel.on).toHaveBeenCalledWith('broadcast', { event: 'list_revision' }, expect.any(Function))
  status('SUBSCRIBED')
  broadcast()
  broadcast()
  vi.advanceTimersByTime(200)
  expect(refresh).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(119_799)
  expect(refresh).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(201)
  expect(refresh).toHaveBeenCalledTimes(2)
  stop()
})

it('checks revisions without the channel, catches up on reconnect and stops on cleanup', () => {
  const { client, channel, broadcast, status, refresh, stop } = connect()
  status('TIMED_OUT')
  vi.advanceTimersByTime(20_000)
  status('CHANNEL_ERROR')
  vi.advanceTimersByTime(25_200)
  expect(refresh).toHaveBeenCalledTimes(1)
  status('SUBSCRIBED')
  vi.advanceTimersByTime(200)
  expect(refresh).toHaveBeenCalledTimes(2)
  broadcast()
  stop()
  status('CLOSED')
  vi.advanceTimersByTime(150_000)
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(client.removeChannel).toHaveBeenCalledWith(channel as unknown as RealtimeChannel)
})

it('pulls a newer checkmark into the existing local list when a signal arrives', async () => {
  const storage = createStorage(crypto.randomUUID())
  const remoteListId = crypto.randomUUID()
  const accountId = 'account-a'
  const local = { id: crypto.randomUUID(), listId: 'groceries', name: 'Молоко', purchased: false, createdAt: 1 }
  const remote = { id: local.id, list_id: remoteListId, name: local.name, purchased: true,
    created_at: new Date(local.createdAt).toISOString(), version: 2 }
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ is: () => ({
      order: async () => ({ data: [remote], error: null }),
    }) }) }) }),
  } as unknown as SupabaseClient
  await storage.bindAccountList(accountId, local.listId, remoteListId)
  await storage.importRemoteOnlyBatch(accountId, remoteListId, [{ item: local, version: 1 }])

  const sync = createAccountSync(storage, client, {
    accountId, localListId: local.listId, remoteListId, isActive: () => true,
  })
  let pull: Promise<number> | undefined
  const { broadcast, refresh, stop } = connect(vi.fn(() => {
    pull = sync.importRemoteOnly({ reconcileNames: true })
  }))
  try {
    broadcast()
    vi.advanceTimersByTime(200)
    expect(refresh).toHaveBeenCalledOnce()
    await expect(pull).resolves.toBe(1)
    expect(await storage.readAccountItems(accountId)).toEqual([{ ...local, purchased: true }])
    expect(await storage.readAccountItemVersions(accountId)).toContainEqual(
      expect.objectContaining({ itemId: local.id, version: 2 }),
    )
  } finally {
    stop()
    await storage.close()
  }
})

it('waits for asynchronous removal before subscribing again to the same topic', async () => {
  const { client, stop } = connect()
  let acknowledgeRemoval: (status: string) => void = () => {}
  client.removeChannel.mockImplementationOnce(() => new Promise(resolve => { acknowledgeRemoval = resolve }))
  stop()
  const closeReplacement = watchCloudListChanges(client as unknown as SupabaseClient, 'account-a', vi.fn())
  expect(client.channel).toHaveBeenCalledTimes(1)
  acknowledgeRemoval('ok')
  await vi.advanceTimersByTimeAsync(0)
  expect(client.channel).toHaveBeenCalledTimes(2)
  closeReplacement()
})
