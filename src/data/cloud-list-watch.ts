import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

const FALLBACK_INTERVAL_MS = 45_000
const SAFETY_INTERVAL_MS = 120_000
const COALESCE_MS = 150
type ChannelClient = Pick<SupabaseClient, 'channel' | 'removeChannel'>
const closingChannels = new WeakMap<ChannelClient, Map<string, Promise<void>>>()

/** Broadcast is a hint. Always read the current revisions through the account API. */
export function watchCloudListChanges(
  client: ChannelClient,
  accountId: string,
  refresh: () => void,
): () => void {
  let closed = false
  let pending: ReturnType<typeof setTimeout> | undefined
  let interval: ReturnType<typeof setInterval>
  let subscribed = false
  const schedule = () => {
    if (closed || pending !== undefined) return
    pending = setTimeout(() => {
      pending = undefined
      refresh()
    }, COALESCE_MS)
  }
  const arm = (delay: number) => {
    clearInterval(interval)
    interval = setInterval(schedule, delay)
  }
  arm(FALLBACK_INTERVAL_MS)
  const topic = 'shopping-lists:' + accountId
  let closing = closingChannels.get(client)
  if (!closing) {
    closing = new Map()
    closingChannels.set(client, closing)
  }
  const previousClose = closing.get(topic)
  let channel: RealtimeChannel | undefined
  const join = () => {
    if (closed) return
    channel = client.channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'list_revision' }, schedule)
      .subscribe(status => {
        if (closed) return
        const connected = status === 'SUBSCRIBED'
        if (connected !== subscribed) {
          subscribed = connected
          arm(connected ? SAFETY_INTERVAL_MS : FALLBACK_INTERVAL_MS)
        }
        // A successful join may have followed a disconnect with missed signals.
        if (connected) schedule()
      })
  }
  // Supabase reuses channels by topic until an asynchronous unsubscribe closes
  // them. A replacement effect must wait before registering its own listener.
  if (previousClose) void previousClose.then(join)
  else join()

  return () => {
    closed = true
    clearInterval(interval)
    clearTimeout(pending)
    if (channel && closing) {
      const pendingClose = client.removeChannel(channel).then(() => {}, () => {})
      closing.set(topic, pendingClose)
      void pendingClose.then(() => {
        if (closing.get(topic) === pendingClose) closing.delete(topic)
      })
    }
  }
}
