# Real traces for the sensor-fusion signal

Recorded trails from real phones. They are the only way to know how the motion-vs-GPS signal behaves on **real** walks, drives and spoofs, and to calibrate `client/src/lib/sensorFusion/fusion.json`. Until they exist every accuracy number is SYNTHETIC.

## How to record one

1. Open the Capture page with **`?record=1`** (e.g. `https://<your-ip>:5174/?record=1`; use `npm run dev:https` on a phone, sensors need HTTPS), agree to the recording and start it.
2. Do the scenario (below). Keep the page open and the screen on.
3. Pick the scenario in the Visit recording box, write one line in the note box (phone, OS/browser, what you did), tap **Download trace**. You get `<scenario>-<time>.json` (no photo, no worker id; it does contain **your location**).
4. Put the file in the matching folder here. Optional: `site.json` in this folder (`{"lat": ..., "lng": ..., "radius_m": 60}`) lets the engine also check the arrival and the end position against the site.

## Folders

| Folder | Do this | Counts as | Aim for |
|---|---|---|---|
| `walk_to_site/` | Walk to a site from at least 150 m away, 2 min, phone in hand; again with the phone in a pocket | genuine | 5+ |
| `drive_then_walk/` | Ride/drive for a few minutes, then walk the last 100 m | genuine | 3+ |
| `stationary_at_site/` | Stay at a site for 3-5 minutes, indoors and outdoors | genuine | 5+ |
| `indoor_poor_gps/` | Stand inside a building or basement where GPS wanders | genuine | 3+ |
| `spoof_teleport/` | Laptop or phone left still; Chrome DevTools → Sensors → Location, set a place far away, record, then switch the override to the site | spoof | 5+ |
| `spoof_mock_android/` | Android phone with a mock-location app (Developer options), phone left on a table, fake position at the site | spoof | 3+ |
| `spoof_static_home/` | Fake position at the site, phone at home, not moving | spoof | 3+ |

## Rules

- **One trace in one folder.** Do not copy a file into several.
- **These files contain where you were.** Do not commit other people's traces without their consent; the folder is not git-ignored on purpose (so you decide), so do not `git add` anything you would not want public.
- Then run `cd client && npm run report`: section 5b has a REAL block that reads these folders (counts and intervals; "indicative only" under 30 per class).
