import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'
import { makeMock, seedMock } from './mock.js'

/* ---------- Toasts ---------- */
const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [items, setItems] = useState([])
  const push = useCallback((message, kind = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setItems((l) => [...l, { id, message, kind }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), 3800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              className={`toast toast--${t.kind}`}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 40 }}
            >
              {t.kind === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- Demo mode ---------- */
const DemoCtx = createContext({ demo: false, mock: [], setDemo() {}, inject() {} })
export const useDemo = () => useContext(DemoCtx)

const KEY = 'trustlayer.demo'
const readDemo = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function DemoProvider({ children }) {
  const [demo, setDemoState] = useState(readDemo)
  const [mock, setMock] = useState(() => (readDemo() ? seedMock() : []))

  const setDemo = useCallback((on) => {
    setDemoState(on)
    setMock(on ? seedMock() : [])
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }, [])

  const inject = useCallback((status) => {
    setMock((m) => [makeMock(Math.random, Date.now(), status), ...m])
  }, [])

  const value = useMemo(() => ({ demo, mock, setDemo, inject }), [demo, mock, setDemo, inject])
  return <DemoCtx.Provider value={value}>{children}</DemoCtx.Provider>
}
