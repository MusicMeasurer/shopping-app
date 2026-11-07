import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrollSiriCredential, listSiriCredentials, revokeSiriCredential } from './data/siri-credential'

/** An explicit, account-scoped one-time enrollment. No secret is persisted. */
export function SiriSetup({ client, accountId, listId, listName }: {
  client: SupabaseClient
  accountId: string
  listId: string
  listName: string
}) {
  const [enrollment, setEnrollment] = useState<{ credentialId: string; token: string | null } | null>(null)
  const [credentials, setCredentials] = useState<{ credentialId: string; expiresAt: string; revokedAt: string | null }[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    setEnrollment(null)
    setMessage('')
    setCredentials([])
    let cancelled = false
    void listSiriCredentials(client, listId).then(rows => { if (!cancelled) setCredentials(rows) }).catch(() => { if (!cancelled) setMessage('Не удалось загрузить выданные ключи Siri.') })
    return () => { cancelled = true }
  }, [client, accountId, listId])
  async function enroll() {
    if (busy || enrollment || !window.confirm('Создать отдельный ключ Siri для списка «' + listName + '»? Он будет показан только один раз.')) return
    setBusy(true)
    setMessage('')
    try {
      const result = await enrollSiriCredential(client, listId)
      setEnrollment({ credentialId: result.credentialId, token: result.token })
      setCredentials(await listSiriCredentials(client, listId))
      setMessage('Ключ действует до 90 дней. Добавьте его в личную команду Apple Shortcuts и затем скройте.')
    } catch {
      setMessage('Не удалось подключить Siri. Проверьте облачный список и авторизацию.')
    } finally {
      setBusy(false)
    }
  }
  async function revoke(credentialId: string) {
    if (busy || !window.confirm('Отозвать этот ключ? Команда Siri с ним перестанет работать.')) return
    setBusy(true)
    try {
      const revoked = await revokeSiriCredential(client, credentialId)
      if (!revoked) throw new Error('Credential already revoked')
      if (enrollment?.credentialId === credentialId) setEnrollment(null)
      setCredentials(await listSiriCredentials(client, listId))
      setMessage('Ключ отозван.')
    } catch {
      setMessage('Не удалось подтвердить отзыв ключа. Повторите попытку.')
    } finally {
      setBusy(false)
    }
  }
  return <section aria-label="Подключение Siri">
    <h3>Siri · {listName}</h3>
    <p>Для привязанного облачного списка. Команда iPhone будет добавлять товары напрямую в облако, не открывая приложение.</p>
    {!enrollment ? <button type="button" disabled={busy} onClick={() => void enroll()}>
      {busy ? 'Подключаем…' : 'Создать ключ для Siri'}
    </button> : <div>
      <p>Скопируйте ключ в заголовок Authorization вашей команды Apple Shortcuts. Не отправляйте его другим людям.</p>
      {enrollment.token && <><label htmlFor="siri-key-once">Ключ (показывается только сейчас)</label>
      <input id="siri-key-once" readOnly type="password" value={enrollment.token} autoComplete="off" />
      <button type="button" disabled={busy} onClick={() => void navigator.clipboard.writeText(enrollment.token!).then(
        () => setMessage('Ключ скопирован. Удалите его из буфера обмена после настройки.'),
        () => setMessage('Не удалось скопировать ключ. Проверьте разрешение браузера.'),
      )}>Скопировать ключ</button>
      <button type="button" disabled={busy} onClick={() => { setEnrollment(current => current ? { ...current, token: null } : null); setMessage('Ключ скрыт. Его можно отозвать ниже, пока эта страница открыта.') }}>Скрыть ключ</button></>}

    </div>}
    <h4>Выданные ключи</h4>
    {credentials.filter(row => !row.revokedAt && Date.parse(row.expiresAt) > Date.now()).length === 0 ? <p>Нет действующих ключей.</p> : <ul>{credentials.filter(row => !row.revokedAt && Date.parse(row.expiresAt) > Date.now()).map(row => <li key={row.credentialId}>Действует до {new Date(row.expiresAt).toLocaleDateString('ru-RU')} <button type="button" disabled={busy} onClick={() => void revoke(row.credentialId)}>Отозвать</button></li>)}</ul>}
    {message && <p role="status">{message}</p>}
  </section>
}
