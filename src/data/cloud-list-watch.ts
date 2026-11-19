import type { SupabaseClient } from '@supabase/supabase-js'

const FALLBACK_INTERVAL_MS = 45_000
const SAFETY_INTERVAL_MS = 120_000
const COALESCE_MS = 150

/** Broadcast is a hint. Always read the current revisions through the account API. */
export function watchCloudListChanges(
  client: Pick<SupabaseClient, 'channel' | 'removeChannel'>,
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
  const channel = client.channel('shopping-lists:' + accountId, { config: { private: true } })
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

  return () => {
    closed = true
    clearInterval(interval)
    clearTimeout(pending)
    void client.removeChannel(channel)
  }
}
