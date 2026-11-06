import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cloudLists, setCloudLists] = useState<OwnedCloudList[]>([])
  const [cloudBindings, setCloudBindings] = useState<Record<string, string>>({})
  const [cloudLoading, setCloudLoading] = useState(false)
  const [selectedLocal, setSelectedLocal] = useState<ListId>('groceries')
  const [selectedRemote, setSelectedRemote] = useState('')
  const [cloudPreview, setCloudPreview] = useState<string | null>(null)
  const [workspaceRevision, setWorkspaceRevision] = useState(0)
  const currentAccount = view.status === 'account' ? view.accountId : null
  const activeAccount = useRef(currentAccount)
  activeAccount.current = currentAccount
  const automaticFlushRunning = useRef(false)
  const flushRequested = useRef(false)
  const onQueued = useCallback(() => {
    if (!client || !currentAccount) return
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
  }, [client, currentAccount, storage])

  // Retry durable account edits when connectivity returns; never sync guest data.
  useEffect(() => {
    if (!currentAccount || !client) return
    const retry = () => onQueued()
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [client, currentAccount, onQueued])

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
    }, setView, guard, async () => verifiedAccountId(client))
    setController(next)
    void next.initialize()
    return () => {
      next.dispose()
      setController(null)
    }
  }, [client])

  // Account changes invalidate all cloud discovery and selection state.
  useEffect(() => {
    setCloudLists([])
    setCloudBindings({})
    setSelectedRemote('')
    setCloudPreview(null)
  }, [view.status === 'account' ? view.accountId : null])

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
    try {
      if (await verifiedAccountId(client) !== accountId) throw new Error('Account changed')
      const result = await createAccountSync(storage, client, {
        accountId, localListId, remoteListId,
        isActive: () => activeAccount.current === accountId,
      }).previewDeletions()
      if (activeAccount.current !== accountId) throw new Error('Account changed')
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
    } catch {
      setError('Не удалось завершить выход на сервере. Проверьте подключение.')
    } finally {
      setBusy(false)
    }
  }
  if (view.status === 'checking') return <main>
    <p role="status">{error ? 'Аккаунт заблокирован до завершения выхода.' : 'Проверяем аккаунт…'}</p>
    {error && <><p role="alert">{error}</p><button disabled={busy || !controller} onClick={() => void signOut()}>Повторить выход</button></>}
  </main>
  return <>
    {client && <aside aria-label="Аккаунт">
      {view.status === 'account' ? <div><span>Вы вошли в аккаунт</span> <button disabled={busy} onClick={() => void signOut()}>Выйти</button></div> :
        <form onSubmit={signIn}>
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} />
          <label htmlFor="auth-password">Пароль</label>
          <input id="auth-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} />
          <button disabled={busy || !controller}>Войти</button>
          <p>Без входа покупки сохраняются только на этом устройстве.</p>
        </form>}
      {error && <p role="alert">{error}</p>}
    </aside>}
    {client && view.status === 'account' && <section aria-label="Облачные списки">
      <h2>Облачные списки</h2>
      <p>Привязка не переносит существующие покупки. Новые изменения в привязанном списке отправляются автоматически при доступной сети.</p>
      <button type="button" disabled={cloudLoading} onClick={() => void loadCloudLists()}>
        {cloudLoading ? 'Проверяем…' : 'Загрузить мои облачные списки'}
      </button>
      {cloudLists.length > 0 && <form onSubmit={event => void bindCloudList(event)}>
        <label htmlFor="local-cloud-list">Локальный список</label>
        <select id="local-cloud-list" value={selectedLocal} disabled={cloudLoading}
          onChange={event => { setSelectedLocal(event.target.value as ListId); setSelectedRemote(''); setCloudPreview(null) }}>
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
      {cloudPreview?.startsWith('Только просмотр:') && <button type="button" disabled={cloudLoading}
        onClick={() => void importCloudItems()}>Импортировать только новые покупки</button>}
      {cloudBindings[selectedLocal] && <button type="button" disabled={cloudLoading}
        onClick={() => void flushCloudQueue()}>Отправить подготовленные изменения</button>}
      {lists.map(list => cloudBindings[list.id] &&
        <p key={list.id}>{list.name}: облачный список привязан (новые изменения отправляются автоматически).</p>)}
    </section>}
    <App key={workspaceRevision} storage={storage} accountId={currentAccount} onQueued={onQueued} />
  </>
}
