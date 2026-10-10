# Progress — Awign Trust Layer: Auth & Login Feature

_Last updated: 2026-10-10_

---

## Status Overview

| Task | Status | Notes |
|---|---|---|
| Worker 1 credentials assigned | ✅ Done | `arjun.n` / token in credentials doc |
| Worker 2 credentials created | ✅ Done | `pragy.hackathon` / token in credentials doc |
| Hackathon site registration guide | ✅ Done | Steps 1–5 in credentials doc |
| Login page implementation | 🔲 Pending | See plan below |
| `Worker` model + `workers.py` | 🔲 Pending | |
| `POST /auth/login` endpoint | 🔲 Pending | |
| `Login.jsx` page | 🔲 Pending | |
| Protected route wrapper | 🔲 Pending | |
| `site_hackathon_1` registered in DB | 🔲 Pending | Do at venue |
| Hackathon site network seeded (3 visits) | 🔲 Pending | Do at venue |

---

## Decisions Made

- **Auth model:** Shared `DASHBOARD_TOKEN` for the dashboard; per-worker username/password for the login page. Login endpoint returns the token + worker metadata on success.
- **Password storage:** bcrypt hashes (passlib), never plain text.
- **Session storage:** `sessionStorage` (tab-scoped) — aligns with existing `auth.js` pattern.
- **Hackathon site ID:** `site_hackathon_1` with label "Hackathon Venue", radius 100 m, country IN.
- **Worker 2 worker ID:** `worker_hackathon_1` — keeps the existing `worker_*` naming convention.

---

## Next Steps (ordered)

1. **Build login page** — `Login.jsx` + `POST /auth/login` + `Worker` model (see credentials doc for full spec).
2. **Stand at hackathon venue** → `PUT /sites/site_hackathon_1` with your GPS.
3. **Make 3 genuine submissions** from the venue to seed the network profile.
4. **Run `GET /sites/site_hackathon_1/profile`** → confirm `"known": true`.
5. **Test the demo flow** (genuine walk → accepted, fake GPS → flagged).

---

## Reference Links

- [Credentials & Login Setup](file:///C:/Users/pragy/.gemini/antigravity/brain/83044b05-5742-4926-bb90-09cea593b7cc/worker-credentials-and-login.md)
- [auth.js](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/client/src/lib/auth.js)
- [main.py](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/backend/main.py)
- [hardening.py](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/backend/hardening.py)
- [hackathon-plan.md](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/Sensor-fusion/hackathon-plan.md)
