import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ProfileMode = 'local' | 'linked' | 'offline' | 'cloud'

const statusLabels: Record<ProfileMode, string> = {
  local: 'Локальный профиль',
  linked: 'Локальная копия аккаунта',
  offline: 'Нет связи',
  cloud: 'В облаке',
}

export type ProfileSyncState = 'local' | 'syncing' | 'synced' | 'waiting' | 'offline' | 'error'

const syncLabels: Record<ProfileSyncState, string> = {
  local: 'Локальные данные',
  syncing: 'Синхронизация…',
  synced: 'Синхронизировано',
  waiting: 'Требуется синхронизация',
  offline: 'Нет связи',
  error: 'Ошибка синхронизации',
}

export function DeleteProfileButton({ name, disabled, onDelete }: { name: string; disabled?: boolean; onDelete: () => void }) {
  return <button type="button" className="profile-delete" aria-label={`Удалить локальный профиль «${name}»`}
    disabled={disabled} onClick={onDelete}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
    </svg>
  </button>
}

export function ProfileTransferPreference({ checked, disabled, onChange, children }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; children: ReactNode
}) {
  const [pointerFocus, setPointerFocus] = useState(false)
  return <label className="profile-transfer-preference" data-pointer-focus={pointerFocus || undefined}
    onPointerDownCapture={() => setPointerFocus(true)}>
    <input type="checkbox" checked={checked} disabled={disabled}
      onBlur={() => setPointerFocus(false)} onKeyDown={() => setPointerFocus(false)}
      onChange={event => onChange(event.currentTarget.checked)} />
    {children}
  </label>
}

export function ProfileBadge({ mode, compact = false }: { mode: ProfileMode; compact?: boolean }) {
  return <span className="profile-badge" data-mode={mode} title={statusLabels[mode]}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="7" r="3.5" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </svg>
    {!compact && <span aria-hidden="true" className="profile-sync">
      {mode === 'cloud' ? '↻' : mode === 'local' ? '∕' : 'Ⅱ'}
    </span>}
    <span className="sr-only">{statusLabels[mode]}</span>
  </span>
}

export function ProfileMenu({ name, mode, syncState, open, onToggle, onClose, onRename, deleteCurrent, children }: {
  name: string
  mode: ProfileMode
  syncState: ProfileSyncState
  deleteCurrent?: ReactNode
  open: boolean
  onToggle: () => void
  onClose: () => void
  onRename?: () => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [available, setAvailable] = useState<number>()
  const syncLabel = syncLabels[syncState]
  const status = <span className="profile-status" data-sync={syncState}>
    {syncState === 'synced' && <span aria-hidden="true">✓ </span>}{syncLabel}
  </span>

  useEffect(() => {
    if (!open) return
    const viewport = window.visualViewport
    function resize() {
      const button = trigger.current?.getBoundingClientRect()
      if (button) setAvailable(Math.max(100, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - button.bottom - 16))
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target) &&
          !(event.target instanceof Element && event.target.closest('dialog[open]'))) onClose()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]')) return
      onClose()
      trigger.current?.focus()
    }
    resize()
    viewport?.addEventListener('resize', resize)
    viewport?.addEventListener('scroll', resize)
    window.addEventListener('resize', resize)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      viewport?.removeEventListener('resize', resize)
      viewport?.removeEventListener('scroll', resize)
      window.removeEventListener('resize', resize)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, onClose])

  return <div ref={root} className="profile-menu-anchor">
    <button ref={trigger} type="button" className="profile-menu-trigger" aria-expanded={open}
      data-profile-mode={mode}
      aria-controls={open ? 'profile-menu' : undefined} aria-haspopup="dialog"
      aria-label={name + ' · ' + statusLabels[mode] + ' · ' + syncLabel + ' · ' + (mode === 'cloud' || mode === 'offline' ? 'Открыть аккаунт' : 'Войти в аккаунт')}
      onClick={onToggle}>
      <ProfileBadge mode={mode} compact />
      <span className="profile-button-details"><span className="profile-button-name" title={name}>{name}</span>{status}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {open && <section id="profile-menu" className="profile-menu account-dialog" role="dialog" tabIndex={0}
      aria-label={mode === 'cloud' || mode === 'offline' ? 'Мой аккаунт' : 'Вход в аккаунт'}
      style={{ maxHeight: available }}>
      <header className="profile-menu-heading">
        <ProfileBadge mode={mode} compact />
        <div><h2 className="account-full-email">{name}</h2>{status}</div>
        {onRename && <button type="button" aria-label="Изменить имя профиля" onClick={onRename}>✎</button>}
        {deleteCurrent}
        <button type="button" aria-label="Закрыть окно аккаунта" onClick={() => { onClose(); trigger.current?.focus() }}>×</button>
      </header>
      {children}
    </section>}
  </div>
}
