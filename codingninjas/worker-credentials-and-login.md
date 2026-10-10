# Worker Credentials & Login Setup

> [!IMPORTANT]
> This document contains credentials. Treat it like a password file — do not commit it to version control or share the link.

---

## How Auth Works in This Project

The backend uses a **single shared `DASHBOARD_TOKEN`** (set as an env var) to gate the dashboard / reviewer / photo endpoints. Worker endpoints (`POST /submissions`, `POST /visits`, `POST /liveness/challenge`, `GET /health`) are **always open** — workers do not authenticate; they are identified only by the `worker_id` string they send in their payloads.

The client stores the dashboard token in `sessionStorage` (gone when the tab closes) and sends it as `Authorization: Bearer <token>` via [`auth.js`](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/client/src/lib/auth.js).

> [!NOTE]
> "Worker credentials" in this system means: a **worker ID** (the string the app submits) + the **site ID** the worker is assigned to. There is no per-worker password today — that's what the login page you're about to build will add.

---

## Worker 1 — Existing Worker (Site Already Registered)

| Field | Value |
|---|---|
| **Worker ID** | `worker_demo_1` |
| **Display name** | Arjun N. |
| **Assigned site** | `site_blr_01` — Koramangala Retail Hub, Bengaluru |
| **Site coordinates** | lat `12.935200`, lng `77.624500` |
| **Login username** | `arjun.n` |
| **Login password** | `ioqLRAG-Bzw05LrVgRVXtiQmWB8rRgHw` |
| **Role** | Worker |

> [!TIP]
> The password above was generated with `secrets.token_urlsafe(24)` — cryptographically random and URL-safe. Use it as the initial credential. Change it after first login once you add a profile/password-change screen.

---

## Worker 2 — New Worker (Hackathon Environment)

| Field | Value |
|---|---|
| **Worker ID** | `worker_hackathon_1` |
| **Display name** | Pragy (Hackathon) |
| **Assigned site** | `site_hackathon_1` — Hackathon Venue |
| **Login username** | `pragy.hackathon` |
| **Login password** | `j2b8ke9q0NffrjW3AibxiC9DOu70QLCe` |
| **Role** | Worker |

> [!NOTE]
> Worker 2's site (`site_hackathon_1`) is **not yet registered** in the backend — the site fingerprint must be seeded from the hackathon venue. Follow **Step-by-step: Register the Hackathon Site Fingerprint** below.

---

## Dashboard Token (for the Review UI)

```
BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ
```

Set this in your backend environment before starting the server:

```bash
# .env or shell export
DASHBOARD_TOKEN=BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ
```

The login page will prompt for this token and store it in `sessionStorage` via [`auth.js → setToken()`](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/client/src/lib/auth.js#L5).

---

## Login Page — What to Build

### Approach
Add a `/login` route and a `Login.jsx` page. On submit it calls a lightweight `POST /auth/login` endpoint (to be added to [`main.py`](file:///c:/Users/pragy/Documents/Awign%20Trust%20Layer/Awign-trust-layer/backend/main.py)) that validates the username/password against a worker registry, then returns the dashboard token so the client can store it.

### Files to create / modify

| File | What |
|---|---|
| `backend/workers.py` (new) | In-memory (or SQLite via new `Worker` model) registry: `{username, password_hash, worker_id, site_id}` |
| `backend/models.py` | Add `Worker` SQLModel table |
| `backend/main.py` | Add `POST /auth/login` endpoint; returns `{ worker_id, site_id, token }` |
| `client/src/pages/Login.jsx` (new) | Login form: username + password → `POST /auth/login` → `setToken()` → redirect |
| `client/src/main.jsx` | Add `<Route path="/login" element={<Login />} />` and a protected-route wrapper |
| `client/src/lib/auth.js` | Add `workerSession` helpers (worker_id, site_id alongside the token) |

### Endpoint spec

```
POST /auth/login
Body: { "username": "arjun.n", "password": "..." }
200:  { "worker_id": "worker_demo_1", "site_id": "site_blr_01", "token": "<dashboard_token>" }
401:  { "detail": "Invalid credentials" }
```

> [!WARNING]
> The password in `workers.py` should be stored as a **bcrypt hash**, not plain text. Use `passlib[bcrypt]` (already in Python's ecosystem): `from passlib.hash import bcrypt; bcrypt.hash(password)` to store, `bcrypt.verify(password, hash)` to check.

---

## Step-by-step: Register the Hackathon Site Fingerprint

The second worker's site (`site_hackathon_1`) needs its GPS location registered **and** its network fingerprint seeded from the hackathon venue. Here's how:

### Step 1 — Stand at the hackathon venue

Go to the spot where the worker will be submitting photos (or as close as possible to the judging area).

### Step 2 — Register the site location

With the backend running and the tunnel live, call `PUT /sites/site_hackathon_1` from the dashboard or directly via curl:

```bash
curl -X PUT https://<your-tunnel>/sites/site_hackathon_1 \
  -H "Authorization: Bearer BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": <YOUR_CURRENT_LAT>,
    "lng": <YOUR_CURRENT_LNG>,
    "radius_m": 100,
    "country": "IN",
    "label": "Hackathon Venue"
  }'
```

> [!TIP]
> Use the **"Register this spot as the site"** button (H2 from the hackathon plan) if it's been built — it reads your GPS automatically. Or use the Site Settings panel in the redesign dashboard.

### Step 3 — Seed the network fingerprint (environment learning)

The backend learns the site's network profile from **accepted submissions**. To seed it fast at the hackathon:

1. Log in as `pragy.hackathon` on the capture app.
2. Make **3 genuine submissions** from the hackathon venue (walk up, take photo, submit). Each accepted submission teaches the link-speed class and ASN to the profile.
3. After 3 accepted visits the profile is considered **known** (`"known": true` in `GET /sites/site_hackathon_1/profile`).

**Check the profile:**
```bash
curl https://<your-tunnel>/sites/site_hackathon_1/profile \
  -H "Authorization: Bearer BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ"
```
Look for `"known": true` and `"visits": 3` (or more).

### Step 4 — Verify the hackathon environment check

Run the self-check endpoint to see what the server sees for your current network:

```bash
# First set ENV_CHECK=1 in the backend env, then:
curl "https://<your-tunnel>/env/check?site_id=site_hackathon_1"
```

Expect: `"site_registered": true`, `"environment_score"` close to 1.0, and `"known": true` after seeding.

### Step 5 — Reset before the demo

Before every demo run, call the reset to start clean:

```bash
curl -X POST https://<your-tunnel>/sites/site_hackathon_1/reset-fingerprint \
  -H "Authorization: Bearer BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ"
```

Then re-seed with 3 genuine submissions. Or — **better for a hackathon** — register the fingerprint once in the morning and don't reset it before the demo (the learned profile will already accept you).

---

## Credential Storage in the App

Once the login page is built, the session should be stored as:

```js
// In sessionStorage (cleared on tab close)
sessionStorage.setItem('tl.dashboard.token', dashboardToken)
sessionStorage.setItem('tl.worker.id', workerId)      // new
sessionStorage.setItem('tl.worker.site', siteId)       // new
```

The capture page reads `tl.worker.id` and `tl.worker.site` to pre-fill the submission payload instead of asking the worker to type them.

---

## Quick Reference Table

| Who | Username | Password | Worker ID | Site |
|---|---|---|---|---|
| Worker 1 (existing) | `arjun.n` | `ioqLRAG-Bzw05LrVgRVXtiQmWB8rRgHw` | `worker_demo_1` | `site_blr_01` |
| Worker 2 (hackathon) | `pragy.hackathon` | `j2b8ke9q0NffrjW3AibxiC9DOu70QLCe` | `worker_hackathon_1` | `site_hackathon_1` |
| Dashboard / Reviewer | — | `BlsTi4WjPvQE9ER_focY7oaorkwGANSrH7bFnM5IeGQ` | — | — |
