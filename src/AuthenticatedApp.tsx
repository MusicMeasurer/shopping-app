import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'
import type { Storage } from './data/storage'
import { createAuthController } from './data/auth-controller'
import { createSignOutGuard } from './data/signout-guard'
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
    }, setView, guard)
    setController(next)
    void next.initialize()
    return () => {
      next.dispose()
      setController(null)
    }
  }, [client])

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
    <App storage={storage} accountId={view.status === 'account' ? view.accountId : null} />
  </>
}
