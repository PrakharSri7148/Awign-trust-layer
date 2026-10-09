import { useCallback, useEffect, useRef, useState } from 'react'
import { listSites, SITE_EVENT } from '../../lib/sensorFusion/sites.js'

/* ---------- Registered sites (where the map puts markers) ---------- */
export function useSites() {
  const [state, setState] = useState({ sites: null, error: null })
  const alive = useRef(true)
  const reload = useCallback(async () => {
    const r = await listSites()
    if (alive.current) setState(r.ok ? { sites: r.sites, error: null } : (s) => ({ sites: s.sites, error: r.error }))
  }, [])
  useEffect(() => {
    alive.current = true
    reload()
    globalThis.addEventListener?.(SITE_EVENT, reload)
    return () => { alive.current = false; globalThis.removeEventListener?.(SITE_EVENT, reload) }
  }, [reload])
  return { ...state, reload }
}

/* ---------- Toasts: successes clear themselves, errors stay until dismissed ---------- */
export function useToasts() {
  const [items, setItems] = useState([])
  const dismiss = useCallback((id) => setItems((l) => l.filter((t) => t.id !== id)), [])
  const push = useCallback((title, { text, type = 'ok' } = {}) => {
    const id = Math.random().toString(36).slice(2)
    setItems((l) => [...l, { id, title, text, type }])
    if (type !== 'error') setTimeout(() => dismiss(id), 4500)
    return id
  }, [dismiss])
  return { items, push, dismiss }
}

/* ---------- Theme of the console (dark by default, light is a token swap) ---------- */
const THEME_KEY = 'tl.dashboard.theme'
export function useDashTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' } })
  const set = useCallback((t) => { setTheme(t); try { localStorage.setItem(THEME_KEY, t) } catch { /* the choice just does not persist */ } }, [])
  return [theme, set]
}

export const NAME_KEY = 'tl.reviewer'
export const readReviewer = () => { try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' } }
export const saveReviewer = (n) => { try { localStorage.setItem(NAME_KEY, n) } catch { /* blocked */ } }
