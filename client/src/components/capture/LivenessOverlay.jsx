import { Check, RefreshCw, ScanFace, Send, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { THRESHOLDS } from '../../lib/photoQuality/config.js'

const L = THRESHOLDS.liveness

// Optional spoken prompts (for people who cannot look at the screen while doing the action). Off by default,
// remembered per device; storage may be blocked, so every access is guarded.
const VOICE_KEY = 'tl.liveness.voice'
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window
const readVoice = () => { try { return localStorage.getItem(VOICE_KEY) === '1' } catch { return false } }
const saveVoice = (on) => { try { localStorage.setItem(VOICE_KEY, on ? '1' : '0') } catch { /* blocked */ } }

// The live-check prompt over the camera for face-required tasks: what to do, a countdown, the steps, and what
// to do after a miss. Presentational: everything comes from the liveness session's state().
// The data-liveness tone ('idle' | 'run' | 'go' | 'ok' | 'warn' | 'bad') and data-challenge are read by the e2e suite.
export default function LivenessOverlay({ live, offline = false, onRetry, onReview }) {
  const [voice, setVoice] = useState(readVoice)
  const spoken = useRef('')
  const snapRef = live?.snapshot
  const done0 = live?.valid
  const phrase = !live ? '' : offline ? "Can't reach the server" : snapRef?.phase === 'running' ? snapRef.current.prompt : done0 ? 'Live check passed. Take your photo now.' : snapRef?.phase === 'failed' ? (snapRef.reason ?? 'That did not work') : ''
  useEffect(() => {
    if (!voice || !canSpeak() || !phrase || spoken.current === phrase) return
    spoken.current = phrase
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(phrase)) } catch { /* no voices */ }
    if (done0) { try { navigator.vibrate?.(60) } catch { /* not supported */ } }
  }, [voice, phrase, done0])
  if (!live) return null
  const snap = live.snapshot
  const done = live.valid
  const failed = snap?.phase === 'failed' && !done
  const running = snap?.phase === 'running'
  const secs = running ? Math.ceil(snap.current.remainingMs / 1000) : 0

  let tone = 'idle'
  let title = 'Position your face in the frame'
  let sub = 'Then follow the on-screen prompt.'
  if (offline && !running && !done) {
    tone = 'bad'
    title = "Can't reach the server"
    sub = 'The live check needs a connection. Check your signal; trying again…'
  } else if (running) {
    const c = snap.current
    tone = c.state === 'active' ? 'go' : 'run'
    title = c.faceLost ? 'Keep your face in the frame' : c.state === 'wait_neutral' ? 'Look at the camera' : c.prompt
    sub = c.state === 'active' ? 'Got it, hold…' : c.state === 'wait_neutral' ? `Next: ${c.prompt.toLowerCase()}` : `${secs}s left`
  } else if (done) {
    tone = 'ok'
    title = 'Live check passed'
    sub = 'Take your photo now.'
  } else if (live.reviewRequested) {
    tone = 'warn'
    title = 'Sending for review'
    sub = 'The live check could not be completed. You can take the photo; it will be reviewed.'
  } else if (failed) {
    tone = 'bad'
    title = 'That did not work'
    sub = `${snap.reason ?? ''} ${live.canRetry ? `Try again (${live.attempts} of ${L.maxAttempts} used).` : 'You can send this for review instead.'}`.trim()
  } else if (snap?.phase === 'passed') {
    tone = 'warn' // passed, but too long ago
    title = 'The live check has expired'
    sub = 'Do it again before taking the photo.'
  }

  const toggleVoice = () => { const on = !voice; setVoice(on); saveVoice(on); spoken.current = ''; if (!on) window.speechSynthesis.cancel() }

  return (
    <div className={`cap-liveness cap-liveness--${tone}`} data-liveness={offline && tone === 'bad' && !failed ? 'offline' : tone} data-challenge={running ? snap.current.id : undefined} role="status">
      <div className="cap-liveness__row">
        {tone === 'ok' ? <Check size={18} className="cap-icon" aria-hidden="true" /> : <ScanFace size={18} className="cap-icon" aria-hidden="true" />}
        <strong className="cap-liveness__title">{title}</strong>
        {snap && snap.total > 0 && running && (
          <span className="cap-liveness__steps" aria-label={`Step ${snap.index + 1} of ${snap.total}`}>
            {Array.from({ length: snap.total }, (_, i) => (
              <i key={i} className={i < snap.index ? 'is-done' : i === snap.index ? 'is-now' : ''} />
            ))}
          </span>
        )}
      </div>
      <span className="cap-liveness__sub">{sub}</span>
      {canSpeak() && (
        <button type="button" className="cap-btn cap-btn--sm cap-liveness__voice" aria-pressed={voice} onClick={toggleVoice} data-tip={voice ? 'Stop reading aloud' : 'Read prompts aloud'}>
          {voice ? <VolumeX size={14} className="cap-icon" aria-hidden="true" /> : <Volume2 size={14} className="cap-icon" aria-hidden="true" />}
          <span className="cap-liveness__voicetxt">{voice ? 'Stop reading aloud' : 'Read prompts aloud'}</span>
        </button>
      )}
      {running && <span className="cap-liveness__bar" style={{ '--p': `${Math.max(0, Math.min(1, snap.current.remainingMs / L.timeoutMs)) * 100}%` }}><i /></span>}
      {(failed || (snap?.phase === 'passed' && !done)) && !live.reviewRequested && (
        <div className="cap-liveness__actions">
          {(live.canRetry || (snap?.phase === 'passed' && !done)) && (
            <button type="button" className="cap-btn cap-btn--sm cap-btn--primary" onClick={onRetry}><RefreshCw size={14} className="cap-icon" aria-hidden="true" /> Try again</button>
          )}
          {!live.canRetry && failed && (
            <button type="button" className="cap-btn cap-btn--sm" onClick={onReview}><Send size={14} className="cap-icon" aria-hidden="true" /> Send for review</button>
          )}
        </div>
      )}
    </div>
  )
}
