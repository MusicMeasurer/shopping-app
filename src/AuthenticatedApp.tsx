import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'
import { SiriSetup } from './SiriSetup'
import { lists, type ListId } from './domain/shopping'
import { fetchOwnedCloudLists, type OwnedCloudList } from './data/owned-cloud-lists'
import { bindVerifiedOwnedList } from './data/verified-list-binding'
import { createAccountSync } from './data/account-sync'
import type { Storage } from './data/storage'
import { createAuthController } from './data/auth-controller'
import { createSignOutGuard } from './data/signout-guard'
import { verifiedAccountId } from './data/verified-account'
import type { AuthView } from './data/auth-view'
import type { SessionCandidate } from './data/auth-scope'

type Controller = ReturnType<typeof createAuthController>

export function AuthenticatedApp({ storage, client }: { storage: Storage; client: SupabaseClient | null }) {
  const [view, setView] = useState<AuthView>(client ? { status: 'checking' } : { status: 'guest' })
  const [controller, setController] = useState<Controller | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cloudLists, setCloudLists] = useState<OwnedCloudList[]>([])
  const [cloudBindings, setCloudBindings] = useState<Record<string, string>>({})
  const [cloudLoading, setCloudLoading] = useState(false)
  const [selectedLocal, setSelectedLocal] = useState<ListId>('groceries')
  const [selectedRemote, setSelectedRemote] = useState('')
  const [cloudPreview, setCloudPreview] = useState<string | null>(null)
  const [deletionReview, setDeletionReview] = useState<{ accountId: string; localListId: ListId; remoteListId: string; items: { id: string; name: string }[] } | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const [cloudMappingRevision, setCloudMappingRevision] = useState(0)
  const [cloudRefreshStatus, setCloudRefreshStatus] = useState('')
  const currentAccount = view.status === 'account' ? view.accountId : null
  const offlineAccount = view.status === 'offline-account' ? view.accountId : null
  const workspaceAccount = currentAccount ?? offlineAccount
  useEffect(() => {
    if (!currentAccount || !client) { setVerifiedEmail(''); return }
    let cancelled = false
    void client.auth.getUser().then(({ data, error }) => {
      if (!cancelled && !error && data.user?.id === currentAccount) setVerifiedEmail(data.user.email ?? '')
    }).catch(() => {})
    return () => { cancelled = true }
  }, [currentAccount, client])
  useEffect(() => {
    if (view.status === 'account') { setAccountDialogOpen(false); setPassword('') }
  }, [view.status])
  const [readyAccount, setReadyAccount] = useState<string | null>(null)
  const [profileError, setProfileError] = useState('')
  // The account ID is only trusted after a fresh server verification. Keep
  // account-scoped UI unmounted until its local profile exists durably.
  useEffect(() => {
    if (!workspaceAccount || !client) { setReadyAccount(null); setProfileError(''); return }
    if (offlineAccount) {
      let cancelled = false
      setReadyAccount(null)
      setProfileError('')
      void storage.readLocalProfiles().then(registry => {
        if (cancelled) return
        if (!registry?.profiles.some(p => p.cloudAccountId === offlineAccount)) throw new Error('No verified local binding')
        setReadyAccount(offlineAccount)
      }).catch(() => { if (!cancelled) setProfileError('Локальный профиль не подтверждён. Доступ заблокирован.') })
      return () => { cancelled = true }
    }
    if (!currentAccount) return
    let cancelled = false
    setReadyAccount(null)
    setProfileError('')
    void (async () => {
      if (await verifiedAccountId(client) !== currentAccount) throw new Error('Account verification changed')
      if (!await storage.readGuestCutoverOwner()) {
        await storage.migrateLegacyGuestToProfile()
        await storage.markGuestCutoverReady()
      }
      if (await verifiedAccountId(client) !== currentAccount) throw new Error('Account verification changed')
      await storage.ensureVerifiedAccountProfile(currentAccount)
      if (!cancelled && await verifiedAccountId(client) === currentAccount) setReadyAccount(currentAccount)
    })().catch(() => {
      if (!cancelled) setProfileError('Не удалось безопасно открыть локальный профиль аккаунта. Покупки сохранены; повторите открытие.')
    })
    return () => { cancelled = true }
  }, [client, currentAccount, offlineAccount, workspaceAccount, storage])
  const activeAccount = useRef<string | null>(null)
  // A verified session is not enough: the account workspace must have a
  // durable local profile before any background sync or refresh may run.
  activeAccount.current = readyAccount === currentAccount ? currentAccount : null
  const automaticFlushRunning = useRef(false)
  const flushRequested = useRef(false)
  const onQueued = useCallback(() => {
    if (!client || !currentAccount || readyAccount !== currentAccount) return
    flushRequested.current = true
    if (automaticFlushRunning.current) return
    const accountId = currentAccount
    automaticFlushRunning.current = true
    void (async () => {
      try {
        if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId) return
        do {
          flushRequested.current = false
          const mappings = await storage.readAccountListMappings(accountId)
          for (const mapping of mappings) {
          if (activeAccount.current !== accountId) return
          if (!lists.some(list => list.id === mapping.localListId)) continue
          await createAccountSync(storage, client, {
            accountId, localListId: mapping.localListId as ListId,
            remoteListId: mapping.remoteListId,
            isActive: () => activeAccount.current === accountId,
          }).flush()
          }
        } while (flushRequested.current && activeAccount.current === accountId)
      } catch {
        // Durable queue remains available for explicit retry.
      } finally {
        automaticFlushRunning.current = false
        if (activeAccount.current !== accountId) flushRequested.current = false
      }
    })()
  }, [client, currentAccount, readyAccount, storage])

  // A browser restart can leave durable operations queued without a new edit.
  // Resume only after the account becomes active; onQueued verifies the server
  // identity before accessing account-scoped mappings and pending operations.
  useEffect(() => {
    if (currentAccount && readyAccount === currentAccount && client) onQueued()
  }, [currentAccount, readyAccount, client, onQueued])

  // Retry durable account edits when connectivity returns; never sync guest data.
  useEffect(() => {
    if (!currentAccount || readyAccount !== currentAccount || !client) return
    const retry = () => onQueued()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [client, currentAccount, readyAccount, onQueued])

  // Subscriptions are effects, not render-time side effects. React StrictMode
  // may mount, dispose and mount again during development.
  useEffect(() => {
    if (!client) {
      setView({ status: 'guest' })
      setController(null)
      return
    }
    setView({ status: 'checking' })
    const guard = createSignOutGuard(window.localStorage)
    if (guard.isPending()) setError('Предыдущий выход не завершён. Повторите выход из аккаунта.')
    const next = createAuthController({
      getSession: async () => {
        const result = await client.auth.getSession()
        return { data: { session: result.data.session as SessionCandidate | null }, error: result.error }
      },
      onAuthStateChange: callback => client.auth.onAuthStateChange((event, session) => callback(event, session as SessionCandidate | null)),
      signInWithPassword: credentials => client.auth.signInWithPassword(credentials),
      signOut: () => client.auth.signOut(),
    }, setView, guard, async () => verifiedAccountId(client), async session => {
      if (navigator.onLine || guard.isPending()) return null
      const id = session.user?.id?.toLowerCase()
      const registry = await storage.readLocalProfiles()
      return registry?.profiles.some(profile => profile.cloudAccountId === id) ? id : null
    })
    setController(next)
    void next.initialize()
    return () => {
      next.dispose()
      setController(null)
    }
  }, [client, storage])

  // On reconnect, revalidate the server identity before allowing cloud access.
  useEffect(() => {
    if (!offlineAccount || !controller) return
    const recheck = () => {
      if (navigator.onLine) {
        setView({ status: 'checking' })
        void controller.initialize()
      }
    }
    window.addEventListener('online', recheck)
    return () => window.removeEventListener('online', recheck)
  }, [offlineAccount, controller])

  // Account changes invalidate all cloud discovery and selection state.
  useEffect(() => {
    setCloudLists([])
    setCloudRefreshStatus('')
    setCloudBindings({})
    setSelectedRemote('')
    setCloudPreview(null)
    setDeletionReview(null)
  }, [view.status === 'account' ? view.accountId : null])

  // Read-only cloud refresh for verified, bound lists. Never apply remote
  // deletions or overwrite local edits without explicit user review.
  useEffect(() => {
    if (!client || !currentAccount || readyAccount !== currentAccount) return
    const accountId = currentAccount
    let disposed = false
    let running = false
    async function refresh() {
      if (!client || disposed || running || document.visibilityState === 'hidden' || !navigator.onLine) return
      running = true
      let imported = 0
      let failed = false
      try {
        if (activeAccount.current !== accountId || await verifiedAccountId(client) !== accountId) return
        const mappings = await storage.readAccountListMappings(accountId)
        for (const mapping of mappings) {
          if (disposed || activeAccount.current !== accountId) return
          if (!lists.some(list => list.id === mapping.localListId)) continue
          try {
            imported += await createAccountSync(storage, client, {
              accountId,
              localListId: mapping.localListId as ListId,
              remoteListId: mapping.remoteListId,
              isActive: () => !disposed && activeAccount.current === accountId,
            }).importRemoteOnly()
          } catch {
            // Keep processing other bound lists, but never import conflicting
            // items from this list or hide the error from the account owner.
            if (disposed || activeAccount.current !== accountId) return
            failed = true
          }
        }
      } catch {
        // Identity, mapping, or network errors outside a single list.
        failed = true
      } finally {
        if (!disposed && activeAccount.current === accountId) {
          if (imported > 0) setWorkspaceRevision(value => value + 1)
          if (failed) setCloudRefreshStatus(imported > 0
            ? 'Получено новых покупок: ' + imported + '. Один из облачных списков требует ручной проверки.'
            : 'Автоматическая загрузка приостановлена. Проверьте облачный список вручную.')
          else if (imported > 0) setCloudRefreshStatus('Получено новых покупок из облака: ' + imported)
        }
        running = false
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    const onOnline = () => void refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    void refresh()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [client, currentAccount, readyAccount, storage, cloudMappingRevision])

  async function loadCloudLists() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    setCloudLoading(true)
    setError('')
    try {
      const [remote, mappings] = await Promise.all([
        fetchOwnedCloudLists(client, accountId),
        storage.readAccountListMappings(accountId),
      ])
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setCloudLists(remote)
      setCloudBindings(Object.fromEntries(mappings.map(row => [row.localListId, row.remoteListId])))
      setCloudMappingRevision(value => value + 1)
      setSelectedRemote('')
    } catch {
      setError('Не удалось проверить облачные списки. Повторите загрузку.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function bindCloudList(event: FormEvent) {
    event.preventDefault()
    if (!client || view.status !== 'account' || !selectedRemote || cloudLoading) return
    const accountId = view.accountId
    setCloudLoading(true)
    setError('')
    try {
      await bindVerifiedOwnedList(storage, client, accountId, selectedLocal, selectedRemote,
        () => view.status === 'account' && view.accountId === accountId)
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setCloudBindings(current => ({ ...current, [selectedLocal]: selectedRemote }))
      setCloudMappingRevision(value => value + 1)
      setSelectedRemote('')
    } catch {
      setError('Не удалось привязать список. Проверьте аккаунт и выбранный список.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function flushCloudQueue() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const remoteListId = cloudBindings[selectedLocal]
    if (!remoteListId) return
    setCloudLoading(true)
    setError('')
    try {
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      const sync = createAccountSync(storage, client, {
        accountId, remoteListId, localListId: selectedLocal,
        isActive: () => view.status === 'account' && view.accountId === accountId,
      })
      const count = await sync.flush()
      if ((await verifiedAccountId(client)) !== accountId) throw new Error('Account changed')
      setError(count === 0 ? 'Нет подготовленных изменений.' : 'Отправлено изменений: ' + count)
    } catch {
      setError('Отправка не завершена. Неподтверждённые изменения остаются в очереди.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function compareCloudList() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const result = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).preview()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setCloudPreview('Только просмотр: новых в облаке — ' + result.remoteOnly.length +
        ', расхождений — ' + result.conflicts.length +
        ', ожидают отправки — ' + result.pendingCount + '. Локальные покупки не изменены.')
    } catch {
      setCloudPreview('Сравнение не удалось. Локальные покупки не изменены.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function compareCloudDeletions() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    setDeletionReview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const result = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).previewDeletions()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setDeletionReview({ accountId, localListId, remoteListId, items: result.reviewItems })
      setCloudPreview('Удаления в облаке: подтверждённые версии — ' +
        result.confirmedDeletions.length + ', конфликты — ' + result.conflicts.length +
        ', без известной версии — ' + result.unknownVersions.length +
        '. Ничего не удалено.')
    } catch {
      setCloudPreview('Проверка удалений не удалась. Локальные покупки не изменены.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function confirmCloudDeletions() {
    const review = deletionReview
    if (!client || !review || view.status !== 'account' || cloudLoading ||
        review.accountId !== view.accountId || review.localListId !== selectedLocal ||
        review.remoteListId !== cloudBindings[selectedLocal] || !review.items.length) return
    const names = review.items.map(item => item.name).join(', ')
    if (!window.confirm('Удалить с этого устройства ' + review.items.length +
      ' товаров, уже удалённых в облаке? ' + names)) return
    setCloudLoading(true)
    setDeletionReview(null)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== review.accountId) throw new Error('Account changed')
      const count = await createAccountSync(storage, client, {
        accountId: review.accountId, localListId: review.localListId, remoteListId: review.remoteListId,
        isActive: () => activeAccount.current === review.accountId,
      }).applyConfirmedDeletions(review.items.map(item => item.id))
      if (activeAccount.current !== review.accountId) throw new Error('Account changed')
      setWorkspaceRevision(value => value + 1)
      setCloudPreview('Подтверждённых удалений применено: ' + count + '.')
    } catch {
      setCloudPreview('Удаления не применены: состояние изменилось или проверка не пройдена. Повторите сравнение.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function importCloudItems() {
    if (!client || view.status !== 'account' || cloudLoading) return
    const accountId = view.accountId
    const localListId = selectedLocal
    const remoteListId = cloudBindings[localListId]
    if (!remoteListId) return
    setCloudLoading(true)
    setCloudPreview(null)
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const count = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).importRemoteOnly()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
      setWorkspaceRevision(value => value + 1)
      setCloudPreview('Импортировано новых покупок: ' + count + '.')
    } catch {
      setCloudPreview('Импорт остановлен: есть конфликт или ошибка проверки. Существующие покупки не перезаписаны.')
    } finally {
      setCloudLoading(false)
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault()
    if (!controller || busy) return
    setBusy(true)
    setError('')
    try {
      await controller.signIn(email.trim(), password)
      setPassword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }
  async function signOut() {
    if (!controller || busy) return
    setBusy(true)
    setError('')
    try {
      await controller.signOut()
      setAccountDialogOpen(false)
      setVerifiedEmail('')
    } catch {
      setError('Не удалось завершить выход на сервере. Проверьте подключение.')
    } finally {
      setBusy(false)
    }
  }
  if (workspaceAccount && (readyAccount !== workspaceAccount || profileError)) return <main>
    {profileError ? <p role="alert">{profileError}</p> : <p role="status">Подготавливаем локальный профиль аккаунта…</p>}
    {profileError && <button type="button" onClick={() => window.location.reload()}>Повторить открытие</button>}
  </main>
  if (view.status === 'checking') return <main>
    <p role="status">{error ? 'Аккаунт заблокирован до завершения выхода.' : 'Проверяем аккаунт…'}</p>
    {error && <><p role="alert">{error}</p><button disabled={busy || !controller} onClick={() => void signOut()}>Повторить выход</button></>}
  </main>
  return <>
    {client && view.status === 'offline-account' && <p role="status">Локальный профиль: нет сети. Облако недоступно до повторной проверки аккаунта.</p>}
    {client && accountDialogOpen && <div className="account-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAccountDialogOpen(false) }}>
      <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
        <div className="account-dialog-heading"><h2 id="account-dialog-title">{view.status === 'account' || view.status === 'offline-account' ? 'Мой аккаунт' : 'Вход в аккаунт'}</h2><button type="button" aria-label="Закрыть окно аккаунта" onClick={() => setAccountDialogOpen(false)}>×</button></div>
        {view.status === 'account' ? <><p className="account-full-email">{verifiedEmail || 'Аккаунт подтверждён'}</p><button type="button" disabled={busy} onClick={() => void signOut()}>Выйти</button></> :
          view.status === 'offline-account' ? <p role="status">Локальный профиль доступен без сети. Для проверки аккаунта и выхода подключитесь к интернету.</p> :
          <form onSubmit={signIn}>
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
            <label htmlFor="auth-password">Пароль</label>
            <input id="auth-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
            <button disabled={busy || !controller}>Войти</button>
            <p>Без входа покупки сохраняются только на этом устройстве.</p>
          </form>}
        {error && <p role="alert">{error}</p>}
      </section>
    </div>}
    {client && view.status === 'account' && <section aria-label="Облачные списки">
      <h2>Облачные списки</h2>
      {cloudRefreshStatus && <p role="status">{cloudRefreshStatus}</p>}
      <p>Привязка не переносит существующие покупки. Новые изменения в привязанном списке отправляются автоматически при доступной сети.</p>
      <button type="button" disabled={cloudLoading} onClick={() => void loadCloudLists()}>
        {cloudLoading ? 'Проверяем…' : 'Загрузить мои облачные списки'}
      </button>
      {cloudLists.length > 0 && <form onSubmit={event => void bindCloudList(event)}>
        <label htmlFor="local-cloud-list">Локальный список</label>
        <select id="local-cloud-list" value={selectedLocal} disabled={cloudLoading}
          onChange={event => { setSelectedLocal(event.target.value as ListId); setSelectedRemote(''); setCloudPreview(null); setDeletionReview(null) }}>
          {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <label htmlFor="remote-cloud-list">Облачный список</label>
        <select id="remote-cloud-list" value={selectedRemote} disabled={cloudLoading || !!cloudBindings[selectedLocal]}
          onChange={event => setSelectedRemote(event.target.value)}>
          <option value="">Выберите список</option>
          {cloudLists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
        </select>
        <button disabled={cloudLoading || !selectedRemote || !!cloudBindings[selectedLocal]}>Привязать</button>
      </form>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void compareCloudList()}>Сравнить с облаком</button>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void compareCloudDeletions()}>Проверить удаления в облаке</button>}
      {cloudPreview && <p role="status">{cloudPreview}</p>}
      {deletionReview && deletionReview.accountId === currentAccount && deletionReview.localListId === selectedLocal && deletionReview.remoteListId === cloudBindings[selectedLocal] && deletionReview.items.length > 0 && <div>
        <p>Найдены удалённые в облаке товары. Проверьте названия перед применением:</p>
        <ul>{deletionReview.items.map(item => <li key={item.id}>{item.name}</li>)}</ul>
        <button type="button" disabled={cloudLoading} onClick={() => void confirmCloudDeletions()}>Подтвердить удаление с устройства</button>
        <button type="button" disabled={cloudLoading} onClick={() => setDeletionReview(null)}>Отмена</button>
      </div>}
      {cloudPreview?.startsWith('Только просмотр:') && <button type="button" disabled={cloudLoading}
        onClick={() => void importCloudItems()}>Импортировать только новые покупки</button>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void flushCloudQueue()}>Отправить подготовленные изменения</button>}
      {cloudBindings[selectedLocal] && <SiriSetup key={currentAccount + ':' + cloudBindings[selectedLocal]} cloudUrl={import.meta.env.VITE_SUPABASE_URL} client={client} accountId={currentAccount!} listId={cloudBindings[selectedLocal]} listName={lists.find(list => list.id === selectedLocal)!.name} />}
      {lists.map(list => cloudBindings[list.id] &&
        <p key={list.id}>{list.name}: облачный список привязан (новые изменения отправляются автоматически).</p>)}
    </section>}
    <App storage={storage} accountId={workspaceAccount} onQueued={currentAccount ? onQueued : undefined} refreshRevision={workspaceRevision}
      headerActions={client ? <div className="account-header-control">
        {(currentAccount || offlineAccount) && <span className="account-header-email" title={verifiedEmail || (offlineAccount ? 'Локальный профиль' : 'Аккаунт')}>{verifiedEmail || (offlineAccount ? 'Офлайн' : 'Аккаунт')}</span>}
        <button type="button" className="account-header-button" aria-label={workspaceAccount ? 'Открыть аккаунт' : 'Войти в аккаунт'} aria-pressed={!!workspaceAccount} onClick={() => { setError(''); setAccountDialogOpen(true) }}>
          <span aria-hidden="true">{workspaceAccount ? '●' : '○'}</span><span>{workspaceAccount ? 'Аккаунт' : 'Войти'}</span>
        </button>
      </div> : undefined} />
  </>
}
