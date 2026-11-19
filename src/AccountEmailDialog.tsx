import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceDialog } from './WorkspaceDialog'

export type AccountEmailMode = 'register' | 'recover'
const minPasswordLength = 12
const passwordHelp = 'Не менее 12 символов.'

export function AccountEmailDialog({ mode, initialEmail, createClient, onDismiss, onCompleted }: {
  mode: AccountEmailMode
  initialEmail: string
  createClient: () => SupabaseClient | null
  onDismiss: () => void
  onCompleted: (email: string, message: string) => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [recoveryVerified, setRecoveryVerified] = useState(false)
  const [client, setClient] = useState<SupabaseClient | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const registering = mode === 'register'
  const title = registering ? 'Регистрация аккаунта' : 'Восстановление доступа'
  const showPassword = registering ? !codeSent : recoveryVerified

  function dismiss() {
    if (busy) return
    if (recoveryVerified && client) void client.auth.signOut({ scope: 'local' }).catch(() => {})
    onDismiss()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (showPassword && (password.length < minPasswordLength || password !== confirmation)) {
      setError(password.length < minPasswordLength ? 'Пароль должен содержать не менее 12 символов.' : 'Пароли не совпадают.')
      return
    }
    setError('')
    setBusy(true)
    const address = email.trim()
    try {
      const isolated = client ?? createClient()
      if (!isolated) throw new Error('Cloud configuration is missing')
      if (!client) setClient(isolated)
      if (!codeSent) {
        if (registering) {
          const { data, error: issue } = await isolated.auth.signUp({ email: address, password })
          if (issue && issue.code !== 'user_already_exists' && issue.code !== 'email_exists') throw issue
          if (data.session) {
            await isolated.auth.signOut({ scope: 'local' })
            setError('Подтверждение почты недоступно. Попробуйте позже.')
            return
          }
        } else {
          const { error: issue } = await isolated.auth.resetPasswordForEmail(address)
          if (issue && issue.code !== 'user_not_found') throw issue
        }
        setEmail(address)
        setPassword('')
        setConfirmation('')
        setCodeSent(true)
      } else if (!recoveryVerified) {
        const { data, error: issue } = await isolated.auth.verifyOtp({
          email: address, token: code.trim(), type: registering ? 'email' : 'recovery',
        })
        if (issue || !data.session) {
          setError('Код неверный или больше не действует. Проверьте письмо или запросите новый код.')
          return
        }
        setCode('')
        if (registering) {
          await isolated.auth.signOut({ scope: 'local' }).catch(() => {})
          onCompleted(address, 'Почта подтверждена. Войдите с паролем, который указали при регистрации.')
        } else {
          setRecoveryVerified(true)
        }
      } else {
        const { error: issue } = await isolated.auth.updateUser({ password })
        if (issue) throw issue
        await isolated.auth.signOut({ scope: 'local' }).catch(() => {})
        onCompleted(address, 'Пароль обновлён. Войдите с новым паролем.')
      }
    } catch (cause) {
      const issue = cause as { code?: string; status?: number }
      if (issue?.status === 429 || issue?.code === 'over_email_send_rate_limit') {
        setError('Слишком много запросов. Подождите и попробуйте снова.')
      } else if (recoveryVerified && (issue?.code === 'weak_password' || issue?.code === 'same_password')) {
        setError('Выберите новый пароль, который отличается от прежнего.')
      } else {
        setError(recoveryVerified ? 'Не удалось обновить пароль. Проверьте соединение и повторите попытку.'
          : codeSent ? 'Не удалось проверить код. Проверьте соединение и повторите попытку.'
          : 'Не удалось запросить письмо. Проверьте соединение и повторите попытку.')
      }
    } finally {
      setBusy(false)
    }
  }

  async function requestAnotherCode() {
    if (!client || busy) return
    setError('')
    setBusy(true)
    try {
      const { error: issue } = registering
        ? await client.auth.resend({ type: 'signup', email })
        : await client.auth.resetPasswordForEmail(email)
      if (issue && issue.code !== 'user_not_found' && issue.code !== 'user_already_exists') throw issue
      setCode('')
    } catch (cause) {
      const issue = cause as { status?: number }
      setError(issue?.status === 429 ? 'Слишком много запросов. Подождите и попробуйте снова.'
        : 'Не удалось запросить новый код. Повторите попытку.')
    } finally {
      setBusy(false)
    }
  }

  return <WorkspaceDialog label={title} className="e4-editor account-email-dialog" onDismiss={dismiss}>
    <h2>{title}</h2>
    <form aria-busy={busy} onSubmit={event => void submit(event)}>
      {!codeSent && <label>Email
        <input type="email" name="email" autoComplete="email" required disabled={busy}
          value={email} onChange={event => setEmail(event.target.value)} />
      </label>}
      {codeSent && !recoveryVerified && <>
        <p>Если для этого адреса можно продолжить, на {email} придёт письмо с кодом.</p>
        {registering && <p>Если аккаунт уже существует, войдите или восстановите доступ.</p>}
        <label>Код из письма
          <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required disabled={busy}
            pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={event => setCode(event.target.value)} />
        </label>
      </>}
      {showPassword && <>
        <label>Новый пароль
          <input name="password" type="password" autoComplete="new-password" minLength={minPasswordLength} required
            aria-describedby="account-password-help" disabled={busy} value={password}
            onChange={event => setPassword(event.target.value)} />
        </label>
        <p id="account-password-help">{passwordHelp}</p>
        <label>Повторите пароль
          <input name="password-confirmation" type="password" autoComplete="new-password" required disabled={busy}
            value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        </label>
      </>}
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {!codeSent ? (registering ? 'Зарегистрироваться' : 'Запросить код') : recoveryVerified ? 'Сохранить пароль' : 'Подтвердить код'}
      </button>
      {codeSent && !recoveryVerified && <button type="button" disabled={busy} onClick={() => void requestAnotherCode()}>Запросить новый код</button>}
      <button type="button" disabled={busy} onClick={dismiss}>Вернуться ко входу</button>
    </form>
  </WorkspaceDialog>
}
