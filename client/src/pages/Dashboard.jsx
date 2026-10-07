import { AnimatePresence } from 'framer-motion'
import { Flame, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import CaseFile from '../components/dashboard/CaseFile.jsx'
import Charts from '../components/dashboard/Charts.jsx'
import Feed from '../components/dashboard/Feed.jsx'
import Kpis from '../components/dashboard/Kpis.jsx'
import QualityPanel from '../components/dashboard/QualityPanel.jsx'
import { useDemo } from '../lib/contexts.jsx'
import { useSubmissions } from '../lib/useSubmissions.js'

export default function Dashboard() {
  const { data, loading, error, lastUpdated, fresh, reload } = useSubmissions()
  const { demo, mock, inject } = useDemo()
  const [selected, setSelected] = useState(null)

  const rows = useMemo(
    () => (demo ? [...mock, ...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) : data),
    [demo, mock, data],
  )

  return (
    <div>
      <div className="dash-head">
        <div>
          <div className="eyebrow eyebrow--cyan">Ops command center</div>
          <h1>Verification dashboard</h1>
        </div>
        <div className="sim">
          {demo && (
            <>
              <button className="btn btn--sm btn--danger" onClick={() => inject('flagged')}><Flame size={14} /> Simulate flagged</button>
              <button className="btn btn--sm" onClick={() => inject('accepted')}><ShieldCheck size={14} /> Simulate accepted</button>
            </>
          )}
          <span className="live">
            <span className="dot dot--pulse text-green" />
            <b>LIVE</b>
            {lastUpdated ? `updated ${lastUpdated.toLocaleTimeString()}` : 'connecting…'}
          </span>
        </div>
      </div>

      <div className="stack">
        <Kpis rows={rows} />
        <Charts rows={rows} />
        <QualityPanel rows={rows} />
        <Feed rows={rows} loading={loading} error={error} fresh={fresh} onReload={reload} onOpen={setSelected} />
      </div>

      <AnimatePresence>{selected && <CaseFile key={selected.id} row={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
    </div>
  )
}
