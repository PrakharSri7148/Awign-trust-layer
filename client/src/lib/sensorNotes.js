// The note printed when a reading is unavailable. One place so the Arrival step (live preview), the AI scan step and the verdict say the same words.
export const SENSOR_NOTE = {
  gps: 'GPS unavailable or denied',
  motion: 'no motion samples (sensor unavailable or denied)',
  net: 'network info unavailable in this browser',
}

// The notes for the readings that came back unavailable ('na'), in the order GPS, Motion, Network.
export function sensorNotesFor(sensors) {
  return ['gps', 'motion', 'net'].filter((k) => sensors[k] === 'na').map((k) => SENSOR_NOTE[k])
}
