// Small shared pieces of the reviewer console. Every class goes through cx(), which adds the rd- prefix the scoped stylesheet uses.
import {
  Activity, ArrowDown, ArrowUp, Bell, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, CircleAlert, CircleCheck, CircleX,
  ClipboardList, Clock, Copy, EllipsisVertical, Eye, FlaskConical, Fingerprint, Globe, History, Image, Inbox, LayoutGrid, List, LoaderCircle, Lock, LocateFixed,
  Map as MapIcon, MapPin, Moon, Navigation, RefreshCw, RotateCcw, Route, Satellite, Search, Send, Settings, ShieldAlert, ShieldCheck, SlidersHorizontal,
  Smartphone, Sun, TriangleAlert, X,
} from 'lucide-react'
import { decisionMeta, severity, statusOf, verdictPill } from '../../lib/dashboard/model.js'

export const cx = (...parts) =>
  parts.flat(Infinity).filter(Boolean).join(' ').split(/\s+/).filter(Boolean).map((t) => `rd-${t}`).join(' ')

const ICONS = {
  activity: Activity, 'arrow-down': ArrowDown, 'arrow-up': ArrowUp, bell: Bell, camera: Camera, check: Check, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight, 'chevron-up': ChevronUp, 'chevrons-up-down': ChevronsUpDown, 'circle-alert': CircleAlert, 'circle-check': CircleCheck, 'circle-x': CircleX,
  'clipboard-list': ClipboardList, clock: Clock, copy: Copy, 'ellipsis-vertical': EllipsisVertical, eye: Eye, flask: FlaskConical, fingerprint: Fingerprint, globe: Globe,
  history: History, image: Image, inbox: Inbox, 'layout-grid': LayoutGrid, list: List, loader: LoaderCircle, lock: Lock, locate: LocateFixed, map: MapIcon, 'map-pin': MapPin,
  moon: Moon, navigation: Navigation, 'refresh-cw': RefreshCw, 'rotate-ccw': RotateCcw, route: Route, satellite: Satellite, search: Search, send: Send, settings: Settings,
  'shield-alert': ShieldAlert, 'shield-check': ShieldCheck, 'sliders-horizontal': SlidersHorizontal, smartphone: Smartphone, sun: Sun, 'triangle-alert': TriangleAlert, x: X,
}

export function Icon({ name, className, size = 16 }) {
  const C = ICONS[name]
  if (!C) return null
  return <C size={size} strokeWidth={1.6} className={cx('icon', className)} aria-hidden="true" focusable="false" />
}

export const Pill = ({ tone = 'neutral', children, title }) => <span className={cx('pill', `pill--${tone}`)} title={title}>{children}</span>
export const SevPill = ({ p }) => { const s = severity(p); return <Pill tone={s.key}>{s.label}</Pill> }
export const PhotoPill = ({ verdict }) => { const v = verdictPill(verdict); return <Pill tone={v.tone}>{v.label}</Pill> }
export const StatusDot = ({ row }) => { const s = statusOf(row); return <span className={cx('status', `status--${s.key}`)}>{s.label}</span> }
export const DecisionPill = ({ decision }) => { const d = decisionMeta(decision); return <Pill tone={d.tone}>{d.label}</Pill> }

export const Skeleton = ({ w = '100%', h = 14 }) => <span className={cx('skeleton')} style={{ width: w, height: h }} />

export function EmptyState({ icon = 'inbox', title, children, action }) {
  return (
    <div className={cx('empty-state')}>
      <Icon name={icon} size={28} />
      <div className={cx('empty-state__title')}>{title}</div>
      {children && <div className={cx('empty-state__text')}>{children}</div>}
      {action}
    </div>
  )
}

/* ---------- Time ---------- */
export function relTime(iso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}
export const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }).replace(' ', '').toLowerCase()
export function fmtDay(iso, now = Date.now()) {
  const d = new Date(iso)
  if (d.toDateString() === new Date(now).toDateString()) return 'Today'
  if (d.toDateString() === new Date(now - 86_400_000).toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}
export const fmtDateTime = (iso, now) => `${fmtDay(iso, now)}, ${fmtClock(iso)}`
