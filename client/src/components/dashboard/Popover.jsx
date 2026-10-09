import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cx } from './ui.jsx'

// A menu or small dialog anchored to a button. Fixed position, closes on outside click / Esc / resize, arrow keys move between items.
// role="menu": items are .menu__item buttons. role="dialog": free content (a search box, a list).
export default function Popover({ anchorRef, open, onClose, role = 'menu', label, width = 220, align = 'right', children, focusFirst = true }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  // The parent re-renders often (the list polls every 5 s) and passes fresh callbacks: keep them in refs so the listeners and the focus
  // are set up once per opening, not once per render.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const anchorR = useRef(anchorRef)
  anchorR.current = anchorRef

  useLayoutEffect(() => {
    if (!open || !anchorR.current.current || !ref.current) return
    const place = () => {
      const a = anchorR.current.current.getBoundingClientRect()
      const w = ref.current.offsetWidth
      const h = ref.current.offsetHeight
      let left = align === 'left' ? a.left : a.right - w
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      let top = a.bottom + 6
      if (top + h > window.innerHeight - 8 && a.top - h - 6 > 8) top = a.top - h - 6
      setPos({ left, top })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, align, children])

  useEffect(() => {
    if (!open) return undefined
    const items = () => [...ref.current.querySelectorAll('.rd-menu__item,[data-menu-item]')]
    const onDoc = (e) => { if (!ref.current?.contains(e.target) && !anchorR.current.current?.contains(e.target)) closeRef.current(false) }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(true); return }
      if (role !== 'menu') return
      if (e.key === 'Tab') { closeRef.current(false); return }
      const list = items()
      const i = list.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
      if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
      if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
      if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
    }
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    if (focusFirst) setTimeout(() => (items()[0] ?? ref.current?.querySelector('input,button,a'))?.focus(), 0)
    return () => { document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true) }
  }, [open, role, focusFirst])

  if (!open) return null
  return (
    <div ref={ref} className={cx('popover')} role={role} aria-label={label} data-rd-popover style={{ position: 'fixed', left: pos.left, top: pos.top, width }}>
      {children}
    </div>
  )
}
