import { useLayoutEffect, useRef, type ComponentProps, type ReactNode, type RefObject } from 'react'

export function WorkspaceDialog({ label, className, onDismiss, children, initialFocusRef, ...inputHandlers }: {
  label: string
  className: string
  onDismiss: () => void
  children: ReactNode
  initialFocusRef?: RefObject<HTMLElement | null>
} & Pick<ComponentProps<'dialog'>, 'onKeyDownCapture' | 'onPointerDownCapture'>) {
  const ref = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = ref.current!
    const viewport = window.visualViewport
    function updateViewport() {
      if (!viewport) return
      dialog.style.setProperty('--visible-height', viewport.height + 'px')
      dialog.style.setProperty('--visible-top', viewport.offsetTop + 'px')
    }
    updateViewport()
    dialog.showModal()
    initialFocusRef?.current?.focus({ preventScroll: true })
    viewport?.addEventListener('resize', updateViewport)
    viewport?.addEventListener('scroll', updateViewport)
    return () => {
      viewport?.removeEventListener('resize', updateViewport)
      viewport?.removeEventListener('scroll', updateViewport)
      dialog.close()
    }
  }, [initialFocusRef])

  return <dialog {...inputHandlers} ref={ref} className={`workspace-dialog ${className}`} aria-label={label}
    onCancel={event => { event.preventDefault(); onDismiss() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) onDismiss()
    }}>
    {children}
  </dialog>
}
