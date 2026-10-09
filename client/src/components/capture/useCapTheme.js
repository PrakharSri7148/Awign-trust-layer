import { useCallback, useState } from 'react'

// Theme of the Photo step: dark by default; light (for outdoor use) is a token swap. `?theme=light|dark` in the URL sets and remembers it.
const KEY = 'tl.capture.theme'
function initial() {
  try {
    const q = new URLSearchParams(window.location.search).get('theme')
    if (q === 'light' || q === 'dark') { try { localStorage.setItem(KEY, q) } catch { /* blocked */ } return q }
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
export function useCapTheme() {
  const [theme, setTheme] = useState(initial)
  const set = useCallback((t) => { setTheme(t); try { localStorage.setItem(KEY, t) } catch { /* the choice just does not persist */ } }, [])
  return [theme, set]
}
