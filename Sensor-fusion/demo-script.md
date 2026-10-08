# Demo script: sensor fusion (3 minutes)

First time on the phone? Follow [phone-test-guide.md](phone-test-guide.md) (setup, test, what to send back) before rehearsing this.

**The claim:** the phone's own movement sensors are compared with its GPS trail. A real walk to the site is accepted; a faked location is flagged with a reason a person can read. The screen shows what the app reads and what it cannot read. **Do not claim accuracy:** the model is trained on simulated trails.

## Before the judges arrive (10 min)

| Step | Command / action |
|---|---|
| 1 | `Sensor-fusion/demo-start.sh` (prints the laptop's WiFi address). Set `DASHBOARD_TOKEN` first: a public venue network means a public backend |
| 2 | Phone: open the APK (or Chrome at `https://<ip>:5174/?demo=1`, started with `--https`). **Sensor feed → Server → Test connection** shows green |
| 3 | Stand **at the demo spot, outdoors**. Wait until the feed shows **±10 m** or better. Tap **Register this spot as the site** |
| 4 | Reset old runs: `cd client && npm run demo:reset -- --apply` (removes only `site_demo_1`'s submissions and learned network; the site stays) |
| 5 | Mock-location app installed and chosen in Developer options → *Select mock location app*, with a pin **several km away**, **switched off** for now |
| 6 | Laptop: dashboard open; screen recording of the fallback video ready (see below) |

## On stage

**1. Genuine arrival (60-90 s).** Walk about 100 m away. Tap **Stop**, then **Start recording my visit** (a fresh visit). Point at the **Sensor feed**: GPS numbers update, |acceleration| moves, **Activity now: walking**, step rhythm about 1.8 Hz, the trail grows toward the site circle. Walk back and stand on the spot for about 20 s. Take the photo (it is checked on the phone first), then tap **I've reached the site · send my location**: the sensor fusion starts now.
→ **VERIFIED**. "Arrival at site" is green. Show the "Movement vs GPS" line (green) and **What was fetched**: N fixes, motion windows, walking %, site registered, IP line, and the WiFi/cell/mock-flag lines with the reason they are not available.

**2. Fake location (60 s).** Tap **New submission** (recording restarts). Put the phone **on the table**. Switch the mock-location app **on** at the far pin, wait about 20 s, then move the pin onto the site (or switch it off so the real GPS jumps back). Wait 20 s. Photo, then **I've reached the site · send my location**.
→ **FLAGGED FOR REVIEW**, reason *"GPS jumped N km in N s while the phone stayed still"*; "What was fetched" shows the jump in red.

**3. Dashboard (45 s).** Open both cases: the trail drawing (the dashed line is the jump), the GPS-vs-phone timeline with the mismatch outlined, the network checks, the review queue.

**4. One honest sentence.** "The model is trained on simulated trails; we measured it on a simulator. Real-phone calibration is the next step. Fusion only flags for human review; it never blocks a worker, and missing sensors are treated as neutral."

## If something fails on stage

| Problem | Do this |
|---|---|
| No GPS / ±50 m+ (indoors) | play the laptop demo: `Sensor-fusion/demo-start.sh --laptop` (scripted walk + teleport through the real UI and server, in a visible Chrome; it stays open on the case file) |
| "Could not reach the server" | Sensor feed → Server → Test connection; same WiFi? macOS firewall prompt allowed? |
| Mock app's fixes are not "jumping" | move the pin far (> 5 km) in one step; a slow drag looks like driving |
| Screen turned off mid-walk | it is counted as hidden time; start a new visit |
| Anything else | the fallback video |

## Fallback video

Record once after a clean rehearsal: the phone's screen (Android's built-in screen recorder) for steps 1-2 and the laptop's screen for step 3. As a second fallback, `npm run demo:laptop` writes screenshots to the scratch directory it prints (or to `E2E_SHOTS=<dir>`).

## Numbers you may quote (and their labels)

- Laptop end-to-end (scripted sensors, real page and server): genuine walk accepted with motion consistency ≥ 0.85; 14 km teleport with a still phone flagged with the jump reason. **SYNTHETIC inputs.**
- Simulator: fraud caught 81-88%, honest flagged 2-7% (`progress.md`). **SYNTHETIC: a property of the simulator, not of real phones.**
- Real phones: **not measured yet.**
