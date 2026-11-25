import { useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WorkspaceDialog } from './WorkspaceDialog'
import { accountEmailErrorMessage } from './data/account-email-error'

export type AccountEmailMode = 'register' | 'recover'
const emailCodeLength = 6
const emailCodePattern = `[0-9]{${emailCodeLength}}`
const emailCodeHelp = `Введите код из ${emailCodeLength} цифр.`
const minPasswordLength = 8
const passwordHelp = `Не менее ${minPasswordLength} символов.`

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

  async function registrationRequest(isolated: SupabaseClient, action: 'request' | 'confirm', address: string) {
    const body = action === 'request' ? { action, email: address } : { action, email: address, code, password }
    const { data, error: issue } = await isolated.functions.invoke('private-registration', { body })
    if (issue) {
      if (issue.context instanceof Response) throw { status: issue.context.status }
      throw issue
    }
    return data?.result
  }

  function dismiss() {
    if (busy) return
    if (recoveryVerified && client) void client.auth.signOut({ scope: 'local' }).catch(() => {})
    onDismiss()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (showPassword && (password.length < minPasswordLength || password !== confirmation)) {
      setError(password.length < minPasswordLength ? `Пароль должен содержать не менее ${minPasswordLength} символов.` : 'Пароли не совпадают.')
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
          if (await registrationRequest(isolated, 'request', address) !== 'accepted')
            throw new Error('Registration request failed')
        } else {
          const { error: issue } = await isolated.auth.resetPasswordForEmail(address)
          if (issue && issue.code !== 'user_not_found') throw issue
        }
        setEmail(address)
        if (!registering) {
          setPassword('')
          setConfirmation('')
        }
        setCodeSent(true)
      } else if (!recoveryVerified) {
        const invalidCode = 'Код неверный или больше не действует. Проверьте письмо или запросите новый код.'
        if (registering) {
          if (await registrationRequest(isolated, 'confirm', address) !== 'created') {
            setError(invalidCode)
            return
          }
          setPassword('')
          setConfirmation('')
          onCompleted(address, 'Почта подтверждена. Войдите с паролем, который указали при регистрации.')
        } else {
          const { data, error: issue } = await isolated.auth.verifyOtp({ email: address, token: code, type: 'recovery' })
          if (issue && (issue.status === 0 || (issue.status ?? 0) >= 500)) throw issue
          if (issue || !data.session) {
            setError(invalidCode)
            return
          }
          setRecoveryVerified(true)
        }
        setCode('')
      } else {
        const { error: issue } = await isolated.auth.updateUser({ password })
        if (issue) throw issue
        await isolated.auth.signOut({ scope: 'local' }).catch(() => {})
        onCompleted(address, 'Пароль обновлён. Войдите с новым паролем.')
      }
    } catch (cause) {
      const action = recoveryVerified ? 'password' : codeSent ? 'verify' : registering ? 'register' : 'recover'
      setError(accountEmailErrorMessage(cause, action))
    } finally {
      setBusy(false)
    }
  }

  async function requestAnotherCode() {
    if (!client || busy) return
    setError('')
    setBusy(true)
    try {
      if (registering) {
        if (await registrationRequest(client, 'request', email) !== 'accepted')
          throw new Error('Registration request failed')
      } else {
        const { error: issue } = await client.auth.resetPasswordForEmail(email)
        if (issue && issue.code !== 'user_not_found') throw issue
      }
      setCode('')
    } catch (cause) {
      setError(accountEmailErrorMessage(cause, 'resend'))
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
        {registering
          ? <p>Проверьте почту и введите код подтверждения.</p>
          : <p>Если для этого адреса можно продолжить, на {email} придёт письмо с кодом.</p>}
        <label>Код из письма
          <input name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required disabled={busy}
            aria-describedby="account-email-code-help" pattern={emailCodePattern} value={code}
            onInvalid={event => {
              event.preventDefault()
              event.currentTarget.focus()
              setError(emailCodeHelp)
            }}
            onChange={event => { setCode(event.target.value.trim()); setError('') }} />
        </label>
        <p id="account-email-code-help">{emailCodeLength} цифр.</p>
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
