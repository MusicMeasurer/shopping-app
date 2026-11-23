import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { accountDeletionApi } from '../data/account-deletion'
import type { Storage } from '../data/storage'

export function useAccountDeletion(client: SupabaseClient | null, storage: Storage) {
  const api = useMemo(() => client ? accountDeletionApi(client) : null, [client])
  const [booting, setBooting] = useState(!!api)
  const [deleted, setDeleted] = useState<ReadonlySet<string>>(new Set())
  const [revision, setRevision] = useState(0)
  const [activeRemoved, setActiveRemoved] = useState(false)
  const [cleanupError, setCleanupError] = useState(false)
  const cleaning = useRef(new Map<string, Promise<void>>())
  const channel = useRef<BroadcastChannel>(null)

  const remove = useCallback((account: string) => {
    const running = cleaning.current.get(account)
    if (running) return running
    setDeleted(previous => previous.has(account) ? previous : new Set([...previous, account]))
    const task = (async () => {
      try {
        await storage.rememberDeletedAccount(account)
        const profiles = await storage.readLocalProfiles()
        if (profiles?.profiles.some(profile => profile.id === profiles.activeProfileId && profile.cloudAccountId === account))
          setActiveRemoved(true)
        channel.current?.postMessage(account)
        await storage.purgeDeletedAccount(account)
        try {
          for (const field of ['card-size', 'list', 'archive'])
            localStorage.removeItem('shopping-workspace:' + account + ':' + field)
        } catch { /* unavailable storage cannot expose a workspace */ }
        channel.current?.postMessage(account)
        setRevision(value => value + 1)
        setCleanupError(false)
      } catch {
        setCleanupError(true)
        return
      }
      if (!navigator.onLine || !api) return
      try {
        await api.acknowledge(account, await storage.readInstallationIdentity())
        await storage.acknowledgeDeletedAccount(account)
      } catch { /* retry the acknowledgment when connectivity returns */ }
    })().finally(() => cleaning.current.delete(account))
    cleaning.current.set(account, task)
    return task
  }, [api, storage])

  const check = useCallback(async (account: string, strict = false) => {
    if (await storage.isDeletedAccount(account)) return true
    if (!api || !navigator.onLine) return false
    const removed = strict ? await api.isDeleted(account) : await api.isDeleted(account).catch(() => false)
    if (!removed) return false
    await remove(account)
    return true
  }, [api, remove, storage])

  const sweep = useCallback(async () => {
    const [registry, markers] = await Promise.all([storage.readLocalProfiles(), storage.readAccountDeletions()])
    if (markers.length) setDeleted(previous => new Set([...previous, ...markers.map(row => row.accountId)]))
    const pending = markers.filter(marker => !marker.acknowledged)
    const linked = registry?.profiles.flatMap(row => row.cloudAccountId ? [row.cloudAccountId] : []) ?? []
    await Promise.allSettled([
      ...pending.map(row => remove(row.accountId)),
      ...linked.filter(account => !markers.some(row => row.accountId === account)).map(account => check(account)),
    ])
  }, [check, remove, storage])

  useEffect(() => {
    if (!api) return
    const sync = () => void sweep().catch(() => setCleanupError(true))
    let active = true
    void sweep().catch(() => setCleanupError(true)).finally(() => {
      if (active) setBooting(false)
    })
    window.addEventListener('online', sync)
    return () => { active = false; window.removeEventListener('online', sync) }
  }, [api, sweep])

  useEffect(() => {
    if (!api || typeof BroadcastChannel === 'undefined') return
    const connection = new BroadcastChannel('shopping-account-deletions')
    channel.current = connection
    connection.onmessage = event => {
      if (typeof event.data !== 'string') return
      const account = event.data
      void storage.isDeletedAccount(account).then(confirmed => {
        if (!confirmed) return
        setDeleted(previous => previous.has(account) ? previous : new Set([...previous, account]))
        setRevision(value => value + 1)
      }).catch(() => {})
    }
    return () => { channel.current = null; connection.close() }
  }, [api, storage])

  const watch = useCallback((account: string) => {
    if (!client || !api) return
    const subscription = client.channel('account-deletion:' + account, { config: { private: true } })
      .on('broadcast', { event: 'account_deleted' }, () => void check(account).catch(() => {}))
      .subscribe(status => {
        if (status === 'SUBSCRIBED') void check(account).catch(() => {})
      })
    return () => { void client.removeChannel(subscription) }
  }, [api, check, client])

  return { api, booting, deleted, revision, activeRemoved, clearActiveRemoved: () => setActiveRemoved(false), cleanupError, check, remove, sweep, watch }
}
