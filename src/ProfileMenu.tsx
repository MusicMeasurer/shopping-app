import { useEffect, useRef, useState, type ReactNode } from 'react'

export type ProfileMode = 'local' | 'linked' | 'offline' | 'cloud'

const statusLabels: Record<ProfileMode, string> = {
  local: 'Локальный профиль',
  linked: 'Локальная копия аккаунта',
  offline: 'Нет связи',
  cloud: 'В облаке',
}

export function ProfileBadge({ mode }: { mode: ProfileMode }) {
  return <span className="profile-badge" data-mode={mode} title={statusLabels[mode]}>
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="7" r="3.5" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </svg>
    <span aria-hidden="true" className="profile-sync">
      {mode === 'cloud' ? '↻' : mode === 'local' ? '∕' : 'Ⅱ'}
    </span>
    <span className="sr-only">{statusLabels[mode]}</span>
  </span>
}

export function ProfileMenu({ name, mode, open, onToggle, onClose, onRename, children }: {
  name: string
  mode: ProfileMode
  open: boolean
  onToggle: () => void
  onClose: () => void
  onRename?: () => void
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [available, setAvailable] = useState<number>()
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const indicator = mode === 'cloud' && !online ? 'offline' : mode
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

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
      aria-label={name + ' · ' + statusLabels[indicator] + ' · ' + (mode === 'cloud' || mode === 'offline' ? 'Открыть аккаунт' : 'Войти в аккаунт')}
      onClick={onToggle}>
      <ProfileBadge mode={indicator} />
      <span className="profile-button-name" title={name}>{name}</span>
      <span aria-hidden="true">▾</span>
    </button>
    {open && <section id="profile-menu" className="profile-menu account-dialog" role="dialog" tabIndex={0}
      aria-label={mode === 'cloud' || mode === 'offline' ? 'Мой аккаунт' : 'Вход в аккаунт'}
      style={{ maxHeight: available }}>
      <header className="profile-menu-heading">
        <ProfileBadge mode={indicator} />
        <div><h2 className="account-full-email">{name}</h2><p>{statusLabels[indicator]}</p></div>
        {onRename && <button type="button" aria-label="Изменить имя профиля" onClick={onRename}>✎</button>}
        <button type="button" aria-label="Закрыть окно аккаунта" onClick={() => { onClose(); trigger.current?.focus() }}>×</button>
      </header>
      {children}
    </section>}
  </div>
}
