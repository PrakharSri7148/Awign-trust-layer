import { useEffect } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Keep Tab inside `ref` while it is mounted; Esc calls onEscape (unless a popover inside already took it).
export function useFocusTrap(ref, onEscape, active = true) {
  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      const root = ref.current
      if (!root) return
      if (e.key === 'Escape') {
        if (document.querySelector('[data-rd-popover]')) return // let the popover close first
        e.stopPropagation()
        onEscape?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...root.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement)
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const outside = !root.contains(document.activeElement)
      if (e.shiftKey && (document.activeElement === first || outside)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (document.activeElement === last || outside)) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [ref, onEscape, active])
}
