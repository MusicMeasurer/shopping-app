import { useLayoutEffect, useRef, type ReactNode } from 'react'

export function ListHeading({ name, remaining, rename, actions }: {
  name: string
  remaining: number
  rename?: { disabled: boolean; open: () => void }
  actions?: ReactNode
}) {
  const title = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const heading = title.current!
    const measure = () => {
      const range = document.createRange()
      range.selectNodeContents(heading)
      const { left } = heading.getBoundingClientRect()
      const right = Math.max(left, ...Array.from(range.getClientRects(), line => line.right))
      heading.style.setProperty('--title-width', Math.ceil(right - left) + 'px')
    }
    const observer = new ResizeObserver(measure)
    observer.observe(heading)
    measure()
    return () => observer.disconnect()
  }, [name, rename !== undefined])

  return <div className="section-heading">
    <div className="list-heading-copy">
      <div className={rename ? 'list-title-row has-rename' : 'list-title-row'}>
        <h2 id="list-title" ref={title}>{name}</h2>
        {rename && <button type="button" className="list-title-edit" aria-label="Переименовать список"
          disabled={rename.disabled} onClick={rename.open}>✎</button>}
      </div>
      <span className="count" aria-live="polite">Осталось: {remaining}</span>
    </div>
    {actions}
  </div>
}
