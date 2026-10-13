# IBVAP Command Center (frontend)

**Intelligent Border Video Analytics Platform** - Smart India Hackathon, Problem Statement 26187.

IBVAP turns the CCTV cameras that already exist at border outposts, check posts and border roads into an
intelligent surveillance network. No new hardware: an AI engine reads the existing RTSP streams, and this
dashboard is what the operator in the control room sees.

This repository folder is the **Command Center dashboard**. It runs fully on its own in mock mode (simulated
cameras, detections and alerts), and switches to the real FastAPI backend with one environment variable.

## Features mapped to the problem statement

| Requirement | Where to see it |
|---|---|
| Human detection and tracking | Live camera overlays: boxes with class, track ID and confidence (Command Center, Live Cameras) |
| Vehicle detection and classification | Live overlays (car / truck / bus / motorcycle / tractor), `Vehicle Detected` alerts, ANPR table "Class" column |
| Face detection / recognition | Face Watchlist page: watchlist grid, captured vs watchlist photo, similarity %, Confirm / Reject review |
| ANPR | ANPR page: live plate reads, search, vehicle history with route on the map, blacklist manager, operator correction of low-confidence reads |
| Virtual fence intrusion | Zones page: draw polygon zones and directional tripwires on the camera view, set severity, trigger classes, dwell time and schedule; zones are drawn on every feed and alert snapshot; full-screen CRITICAL alert |
| Suspicious activity | `Suspicious Activity` and `Loitering` alerts with dwell time and zone |
| Night-time movement | Night / IR indicator on feeds, `Night Movement` alerts, "Day vs night" chart in Analytics |
| Real-time alerts and event logging | Global toasts, sound, bell, critical modal on every page; Alerts log with filters and CSV export; per-alert history timeline |
| Integration with command and control systems | Settings > Integration (C2): REST endpoints, WebSocket URL, webhook with test event, example JSON payload; `docs/API_CONTRACT.md` |
| Improves response time | Analytics: average response time (NEW to ACKNOWLEDGED) and false alarm rate; Reports: shift report |

Operational features beyond the problem statement:

| Feature | Where |
|---|---|
| Incident grouping (same track, or same camera + type within 2 min, shown once with an xN counter; one popup per incident) | Command Center feed, Alerts > Incidents |
| Response playbook (SOP checklist per alert type), Notify QRT, live response timer | Alert detail, critical alert dialog |
| Evidence export: ZIP with snapshot, clip, metadata, SHA-256 hashes, chain of custody; integrity badge | Alert detail |
| Audit log (camera views, zone / watchlist / blacklist edits, exports, settings), Commander / Admin only | Audit Log |
| Data retention, face blurring preference, DPDP Act 2023 note; stream encryption status, idle auto-logout | Settings > Data & Privacy, Security |
| "Why it fired" (frames confirmed, dwell, class, confidence), visibility badges, per-camera sensitivity | Alert cards and detail, Live Cameras, Settings > Detection |
| Backend link status, offline action queue with sync, edge node health | Top bar, System Health |
| Requirements coverage and architecture | About IBVAP |

Also included: Map View with the border line, camera status markers that pulse on new alerts, alert-density heat circles and an offline grid fallback, role-based access (Operator / Commander / Admin),
English / Hindi toggle, keyboard shortcuts, camera health ("SIGNAL LOST" with last-seen time), printable shift
reports, and a scripted Demo Mode.

## Screenshots

_Add screenshots here before submission._

| Screen | Image |
|---|---|
| Command Center | `docs/screenshots/command-center.png` |
| Critical alert modal | `docs/screenshots/critical-alert.png` |
| Live Cameras (3x3) | `docs/screenshots/live-cameras.png` |
| Alert detail | `docs/screenshots/alert-detail.png` |
| ANPR | `docs/screenshots/anpr.png` |
| Face Watchlist matches | `docs/screenshots/face-matches.png` |
| Analytics | `docs/screenshots/analytics.png` |
| Map View | `docs/screenshots/map.png` |

## Run in mock mode (no backend needed)

Requires Node.js 20 or newer.

```bash
cd frontend
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
npm run dev
```

Open http://localhost:5173, pick a role and press **Enter Command Center**. There is no password in mock mode.

`.env` for mock mode:

```
VITE_USE_MOCK=true
```

The simulator raises a new alert every 5-10 seconds. Data lives in memory and resets on page reload.

## Run with the real backend

1. Start the FastAPI backend (it must implement `docs/API_CONTRACT.md` and allow CORS from `http://localhost:5173`).
2. Edit `.env`:

   ```
   VITE_USE_MOCK=false
   VITE_API_URL=http://localhost:8000/api
   VITE_WS_URL=ws://localhost:8000/ws
   ```
3. Restart `npm run dev` (Vite reads `.env` only at start).

If the backend goes down, the dashboard keeps showing the last data it received and displays
"Backend not reachable, showing cached data" until the connection returns.

## Production build

```bash
npm run build      # type-check + bundle into dist/
npm run preview    # serve dist/ on http://localhost:4173
```

`dist/` is static files; any web server (or FastAPI `StaticFiles`) can host it. Configure the server to return
`index.html` for unknown paths so that links like `/alerts/ALT-00012` work on refresh.

## Demo Mode (for the presentation)

Mock mode only. Start it from **Settings > Demo Mode** or press **Ctrl+Shift+D**. It runs a scripted scenario of
about 2 minutes with captions at the bottom of the screen:

patrol → vehicle at check post → ANPR blacklist match → person crosses the virtual fence at night → CRITICAL alert
modal → operator acknowledges → repeat alerts collapse into one incident (x3) → playbook steps ticked → QRT notified →
evidence ZIP exported (the browser downloads a file) → map flies to the camera and its marker pulses → escalation →
shift report → About IBVAP (requirements coverage).

Random alerts are paused while it runs. Press Ctrl+Shift+D again to stop.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `A` | Acknowledge the focused alert (the critical modal, or the alert card under the mouse) |
| `M` | Mute / unmute alert sound |
| `1` `2` `3` `4` | Live Cameras layout 1x1 / 2x2 / 3x3 / 4x4 |
| `?` | Show shortcuts |
| `Ctrl+Shift+D` | Start / stop Demo Mode |

## Roles

| Role | Can do |
|---|---|
| Operator | Monitor, acknowledge, escalate, mark false alarm, review face matches, correct plates |
| Commander | Everything above, plus resolve alerts and edit zones, watchlist and blacklist |
| Admin | Everything, including cameras and settings |

## Offline use

Fonts, icons and all mock imagery are bundled; nothing is loaded from a CDN. The only thing that needs internet
is the OpenStreetMap tile layer. Without it, the map shows camera pins on a plain dark background.

## Project structure

```
docs/API_CONTRACT.md     REST + WebSocket contract for the backend
src/types/               Shared domain types
src/services/            DataService interface, mock implementation + simulator, real API implementation
src/store/               Zustand stores (data + alert system, UI preferences, auth)
src/components/          Shared components (CameraFeed, AlertCard, overlays, layout)
src/pages/               One file per route
src/i18n/                English / Hindi dictionary
src/demo/                Demo Mode script
```

See `../CLAUDE.md` for the architecture rules.

## Known limitations

- The real-backend path (`src/services/api/apiService.ts`) is written to the contract but has not been run against
  a live server yet, because the backend does not exist yet.
- Mock authentication only: no passwords or tokens.
- Mock data is not persisted; a reload resets it.
- Settings such as confidence threshold are stored and sent to the backend, but only a real AI engine acts on them.
