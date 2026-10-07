// On desktop this is http://localhost:8000. From a phone, the page host is the
// dev machine's LAN IP, so the backend is reached on that IP. Over HTTPS we go
// through the Vite /api proxy instead. VITE_API_URL overrides everything.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (window.location.protocol === 'https:'
    ? '/api'
    : `http://${window.location.hostname}:8000`)
