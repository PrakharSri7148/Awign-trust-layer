import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from './api.js'
import { authHeaders } from './auth.js'

const POLL_MS = 5000

export function useSubmissions() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [fresh, setFresh] = useState(() => new Set())
  const seen = useRef(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/submissions`, { headers: authHeaders() })
      if (res.status === 401) throw new Error('UNAUTHORIZED')
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const rows = await res.json()
      if (!alive.current) return
      const ids = new Set(rows.map((r) => r.id))
      if (seen.current) {
        const added = rows.filter((r) => !seen.current.has(r.id)).map((r) => r.id)
        if (added.length) {
          setFresh(new Set(added))
          setTimeout(() => alive.current && setFresh(new Set()), 2800)
        }
      }
      seen.current = ids
      setData(rows)
      setError(null)
      setLastUpdated(new Date())
    } catch (err) {
      if (alive.current) setError(err.message)
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      alive.current = false
      clearInterval(id)
    }
  }, [load])

  return { data, loading, error, lastUpdated, fresh, reload: load }
}

// Reflects GET /health; used by the top bar chip.
export function useHealth() {
  const [ok, setOk] = useState(null)
  useEffect(() => {
    let alive = true
    const ping = () =>
      fetch(`${API_BASE}/health`)
        .then((r) => alive && setOk(r.ok))
        .catch(() => alive && setOk(false))
    ping()
    const id = setInterval(ping, 10000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return ok
}

export function useCountUp(target, duration = 1100) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      setV(target)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3)
      const cur = a + (target - a) * e
      from.current = cur
      setV(cur)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return v
}
