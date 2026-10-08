// Optional dashboard token (the server enforces it only when DASHBOARD_TOKEN is set; see backend/hardening.py).
// Kept in sessionStorage (gone when the tab closes), never in the URL of the app, and only sent to the dashboard endpoints.
const KEY = 'tl.dashboard.token'
export const getToken = () => { try { return sessionStorage.getItem(KEY) ?? '' } catch { return '' } }
export const setToken = (t) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY) } catch { /* blocked */ } }
// headers for a dashboard fetch (merge with your own)
export const authHeaders = (extra = {}) => { const t = getToken(); return t ? { ...extra, Authorization: `Bearer ${t}` } : extra }
// an <img> / <a> cannot send headers: the photo endpoint also takes ?token=
export const withToken = (url) => { const t = getToken(); return t && url ? `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}` : url }
