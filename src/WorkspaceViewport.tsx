import { Component, createRef, type ComponentProps, type ReactNode } from 'react'
import { anchorCandidates, anchoredOffset, type AxisAnchor } from './domain/viewport-anchor'

type Props = Omit<ComponentProps<'main'>, 'ref' | 'children'> & {
  scope: string
  overlay: string
  layoutKey: string
  preserve: boolean
  children: ReactNode
}
type Field = HTMLInputElement | HTMLTextAreaElement
type Snapshot = {
  y: number; x: number; vertical: AxisAnchor[]
  rail?: { node: HTMLElement; offset: number; anchors: AxisAnchor[] }
  focus?: { node: HTMLElement; value?: string; start?: number | null; end?: number | null;
    direction?: 'forward' | 'backward' | 'none' | null; scrollTop?: number; scrollLeft?: number }
}

function positions(root: HTMLElement, selector: string, attribute: string, horizontal = false): AxisAnchor[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).flatMap(node => {
    const id = node.getAttribute(attribute)
    if (!id) return []
    const rect = node.getBoundingClientRect()
    return [{ id, start: horizontal ? rect.left : rect.top, end: horizontal ? rect.right : rect.bottom }]
  })
}
function field(node: HTMLElement): node is Field {
  return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
}

/**
 * React's pre-mutation snapshot is essential: a layout effect after a pull
 * would measure the already moved row. No network, timers or scroll listeners.
 * Explicit navigation, semantic recovery and card reveal retain control.
 */
export class WorkspaceViewport extends Component<Props, Record<string, never>, Snapshot | null> {
  private root = createRef<HTMLElement>()
  private modalAnchor?: Snapshot
  private modalChanged = false

  getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    const root = this.root.current
    if (!root || !previous.preserve || !this.props.preserve || previous.scope !== this.props.scope) return null
    // Typing into an unchanged layout must not measure every row.
    if (previous.layoutKey === this.props.layoutKey && previous.overlay === this.props.overlay) return null
    const rail = root.querySelector<HTMLElement>('.list-rail')
    const rect = rail?.getBoundingClientRect()
    const focused = document.activeElement
    const focus = focused instanceof HTMLElement && root.contains(focused) ? {
      node: focused,
      ...(field(focused) ? { value: focused.value, start: focused.selectionStart, end: focused.selectionEnd,
        direction: focused.selectionDirection, scrollTop: focused.scrollTop, scrollLeft: focused.scrollLeft } : {}),
    } : undefined
    const top = window.visualViewport?.offsetTop ?? 0
    const height = window.visualViewport?.height ?? window.innerHeight
    return {
      x: window.scrollX, y: window.scrollY,
      vertical: anchorCandidates(positions(root, '[data-item-id]', 'data-item-id'), top, top + height),
      rail: rail && rect ? { node: rail, offset: rail.scrollLeft,
        anchors: anchorCandidates(positions(rail, '[data-list-id]', 'data-list-id', true),
          rect.left + rail.clientLeft, rect.left + rail.clientLeft + rail.clientWidth) } : undefined,
      focus,
    }
  }

  private restoreVertical(root: HTMLElement, snapshot: Snapshot) {
    const scroll = document.scrollingElement
    // At the very top, keep the top rather than hiding a new first item.
    const target = snapshot.y <= 0 ? 0 : anchoredOffset(snapshot.vertical,
      positions(root, '[data-item-id]', 'data-item-id'), window.scrollY, snapshot.y,
      (scroll?.scrollHeight ?? 0) - (scroll?.clientHeight ?? window.innerHeight))
    if (Math.abs(target - window.scrollY) > 0.5)
      window.scrollTo({ left: snapshot.x, top: target, behavior: 'instant' })
  }

  componentDidUpdate(previous: Props, _state: Record<string, never>, snapshot: Snapshot | null) {
    const root = this.root.current
    if (!root || !previous.preserve || !this.props.preserve || previous.scope !== this.props.scope) {
      this.modalAnchor = undefined; this.modalChanged = false
      return
    }
    const modalOpen = !!root.querySelector('dialog[open]')
    const overlayChanged = previous.overlay !== this.props.overlay
    if (overlayChanged) {
      // Do not counteract the native dialog's focus/keyboard behavior.
      // If data changes behind it, restore the background once it closes.
      if (modalOpen) {
        this.modalAnchor ??= snapshot ?? undefined
        this.modalChanged ||= previous.layoutKey !== this.props.layoutKey
      } else {
        if (this.modalAnchor && this.modalChanged) this.restoreVertical(root, this.modalAnchor)
        this.modalAnchor = undefined; this.modalChanged = false
      }
      return
    }
    if (!snapshot) return
    const focus = snapshot.focus
    if (focus && focus.node.isConnected && root.contains(focus.node) &&
      !focus.node.matches(':disabled') && (document.activeElement === focus.node || document.activeElement === document.body)) {
      // Never steal focus from another control or resurrect a removed editor.
      if (document.activeElement !== focus.node) focus.node.focus({ preventScroll: true })
      if (field(focus.node) && focus.node.value === focus.value) {
        if (focus.start != null && focus.end != null &&
          (focus.node.selectionStart !== focus.start || focus.node.selectionEnd !== focus.end ||
            focus.node.selectionDirection !== focus.direction)) {
          focus.node.setSelectionRange(focus.start, focus.end, focus.direction ?? undefined)
        }
        if (focus.scrollTop !== undefined) focus.node.scrollTop = focus.scrollTop
        if (focus.scrollLeft !== undefined) focus.node.scrollLeft = focus.scrollLeft
      }
    }
    const rail = snapshot.rail?.node
    if (rail && root.contains(rail) && snapshot.rail) {
      const target = anchoredOffset(snapshot.rail.anchors, positions(rail, '[data-list-id]', 'data-list-id', true),
        rail.scrollLeft, snapshot.rail.offset, rail.scrollWidth - rail.clientWidth)
      if (Math.abs(target - rail.scrollLeft) > 0.5) rail.scrollTo({ left: target, behavior: 'instant' })
    }
    if (modalOpen) {
      this.modalAnchor ??= snapshot
      this.modalChanged = true
    } else {
      this.restoreVertical(root, this.modalAnchor && this.modalChanged ? this.modalAnchor : snapshot)
      this.modalAnchor = undefined; this.modalChanged = false
    }
  }

  render() {
    const { scope: _scope, overlay: _overlay, layoutKey: _layoutKey, preserve: _preserve, children, ...main } = this.props
    return <main {...main} ref={this.root}>{children}</main>
  }
}
