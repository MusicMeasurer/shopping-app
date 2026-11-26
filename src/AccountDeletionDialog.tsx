import { useRef, useState, type FormEvent } from 'react'
import { WorkspaceDialog } from './WorkspaceDialog'
import type { AccountDeletionApi, DeletionChallenge } from './data/account-deletion'

export function AccountDeletionDialog({ api, email, account, checkDeleted, onClose, onDeleted }: {
  api: AccountDeletionApi
  email: string
  account: string
  checkDeleted: (account: string) => Promise<boolean>
  onClose: () => void
  onDeleted: (account: string) => void
}) {
  const [remind, setRemind] = useState(false)
  const [challenge, setChallenge] = useState<DeletionChallenge | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cancelButton = useRef<HTMLButtonElement>(null)

  function close() {
    if (busy) return
    if (challenge) void api.cancel(challenge.id).catch(() => { /* the code expires on the server */ })
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!challenge) {
        const next = await api.start(remind)
        if (next.status === 'wait') setError('Новый код можно запросить через минуту.')
        else setChallenge(next)
        return
      }
      const result = await api.confirm(challenge.id, code)
      if (result === 'deleted') onDeleted(account)
      else if (result === 'expired') {
        setChallenge(null)
        setCode('')
        setError('Код больше не действует. Запросите новый.')
      } else setError('Код неверный. Проверьте письмо и повторите ввод.')
    } catch {
      if (challenge && await checkDeleted(account).catch(() => false)) {
        onDeleted(account)
        return
      }
      setError('Не удалось получить ответ сервера. Проверьте подключение и повторите действие.')
    } finally { setBusy(false) }
  }

  return <WorkspaceDialog label="Удаление облачного аккаунта" className="e4-editor account-deletion-dialog"
    onDismiss={close} initialFocusRef={cancelButton}>
    <form onSubmit={event => void submit(event)}>
      <h2>Удалить аккаунт?</h2>
      {challenge ? <>
        <p>Введите шестизначный код из письма на {email}. Код действует 10 минут.</p>
        <label htmlFor="account-deletion-code">Код подтверждения</label>
        <input id="account-deletion-code" autoComplete="one-time-code" inputMode="numeric" maxLength={6}
          value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/[^0-9]/g, ''))} />
      </> : <>
        <p>Ваши личные списки, архив покупок и локальная копия будут удалены без возможности восстановления. На всех устройствах потребуется выйти из этого аккаунта.</p>
        <label><input type="checkbox" disabled={busy} checked={remind}
          onChange={event => setRemind(event.target.checked)} /> Напомнить мне по почте, если останутся устройства без подтверждения очистки</label>
      </>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-buttons">
        <button type="button" disabled={busy} ref={cancelButton} onClick={close}>Отмена</button>
        <button type="submit" disabled={busy || (!!challenge && code.length !== 6)}>
          {challenge ? 'Удалить аккаунт безвозвратно' : 'Отправить код'}
        </button>
      </div>
    </form>
  </WorkspaceDialog>
}
