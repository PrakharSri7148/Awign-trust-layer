import { useEffect, useState } from 'react'

// The recorder's live summary as React state. Components that show it subscribe themselves, so the (heavy) camera page above
// does not re-render every second.
export function useRecorderState(recorder) {
  const [s, setS] = useState(() => recorder.getState())
  useEffect(() => {
    setS(recorder.getState())
    return recorder.subscribe(setS)
  }, [recorder])
  return s
}
