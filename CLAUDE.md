# IBVAP - Intelligent Border Video Analytics Platform

Smart India Hackathon project, Problem Statement 26187. Two team members, one-week build.

IBVAP turns EXISTING CCTV cameras at border outposts (BOPs), check posts and border roads into an intelligent
surveillance network without new hardware. A separate Python AI engine (YOLO detection, ByteTrack tracking, ANPR,
face recognition, virtual fence, loitering, night detection) processes RTSP streams and sends events to a FastAPI
backend. `frontend/` is the Command Center dashboard that security operators use.

Judges must immediately see every requirement covered: human detection and tracking, vehicle detection and
classification, face detection/recognition, ANPR, virtual fence intrusion, suspicious activity, night-time
movement, real-time alerts and event logging, integration with command and control systems.

## Repo layout

```
docs/                  Research report, project guide, AI engine guide (PDF)
legacy/                Old Streamlit prototype (app.py, alerts.db), superseded by frontend/, kept for reference
frontend/              React Command Center (this is the active work)
  docs/API_CONTRACT.md Every endpoint, WebSocket message and JSON shape. The backend is built to match it.
  .env.example         VITE_USE_MOCK, VITE_API_URL, VITE_WS_URL
  src/
    types/index.ts     ALL shared domain types (Camera, Alert, Detection, Zone, PlateRead, ...)
    services/
      types.ts         DataService interface: the only API the UI may call
      index.ts         exports `service` (mock or api, chosen by VITE_USE_MOCK)
      mock/            mockService.ts (in-memory backend + simulator), data.ts (seed data, SVG imagery)
      api/             apiService.ts (REST + WebSocket, localStorage cache fallback)
    store/             Zustand: data.ts (cameras, zones, alerts, toasts, critical-modal queue),
                       ui.ts (language, mute, camera layout 1-3, selectedAlertId, demo state), auth.ts (user, role permissions)
    i18n/              dict.ts (en + hi dictionaries), index.ts (useT hook)
    lib/               format.ts (formatters, severity/type colours, CSV), sound.ts (Web Audio beeps)
    components/        ui.tsx (badges, PlateTag, Skeleton, Empty/Error states, Modal, Tabs),
                       CameraFeed.tsx, AlertCard.tsx, AlertOverlays.tsx (toasts + critical modal),
                       MiniMap.tsx, ZoneShapes.tsx (zones on still snapshots),
                       layout/Layout.tsx (sidebar, top bar, shortcuts, banners)
    demo/              useDemoRunner.ts (scripted ~2.5 min story "Punjab sector, foggy night, drone drop"; mounted in App.tsx)
    pages/             One file per route (incl. AuditLog, SystemHealth, About)
    lib/incidents.ts   Incident grouping rule (client-derived from alerts)
    lib/playbooks.ts   SOP checklists per alert type, QRT message text
    lib/evidence.ts    Evidence ZIP + SHA-256 (jszip, Web Crypto)
    lib/audit.ts       audit(category, action, target, details) helper -> service.logAudit
    lib/geo.ts         distanceKm, watchAt (drone watch geometry)
    components/ClipPlayer.tsx  alert clip (real <video> or deterministic simulated canvas), scrubber, bookmarks
    components/DroneWatch.tsx  watch banner, In-watch tag, Share with police naka
    components/Shelve.tsx      shelve / unshelve, camera out-of-service
    components/Owner.tsx       incident owner (assign to me / user)
    components/HierarchyTree.tsx  Sector -> BOP -> Camera tree (Live Cameras, Map), groupHierarchy()
    pages/Search.tsx, Shift.tsx, QrtView.tsx (/qrt, phone layout, outside the dashboard layout)
```

## Commands (run inside `frontend/`)

- `npm run dev` - dev server on http://localhost:5173
- `npm run build` - `tsc --noEmit` then `vite build`. Must pass with zero TypeScript errors before finishing work.
- `npm run preview` - serve the production build

## Tech stack (all free, no paid services)

React 19 + Vite + TypeScript, Tailwind CSS v4 (theme tokens in `src/index.css` under `@theme`), React Router,
Leaflet + react-leaflet with OpenStreetMap tiles, Recharts, lucide-react, Zustand.

## Architecture rules (do not break)

1. **Service layer.** UI components never import from `services/mock` or call `fetch` directly. They use
   `service` from `@/services`. Any new backend capability is added to the `DataService` interface, then
   implemented in BOTH `mockService.ts` and `apiService.ts`.
2. **Contract stays in sync.** Shared types live only in `src/types/index.ts`. When a type, endpoint or WebSocket
   message changes, update `docs/API_CONTRACT.md` in the same change. The teammate builds the backend from it.
3. **One live subscription.** `useData.getState().start()` is called once in the layout (and by `/qrt`, which sits
   outside the layout; only one of them is mounted at a time). It loads data, subscribes
   to the alert stream and drives toasts, sound, bell pulse, camera flash and the critical-modal queue. Pages read
   alerts/cameras/zones from the store; they do not subscribe to alerts themselves.
4. **Mock realism.** Mock data is Indian-border specific: names like "BOP Sundar - Gate Cam", "Border Road KM 42",
   "Check Post Munabao", "BOP Ajnala - River Cam"; RJ/PB/JK/GJ plates; real lat/lng along the Rajasthan and Punjab
   border. The simulator emits a random alert about every `MOCK_ALERT_INTERVAL_MS` (~1-2 per minute); plate reads are
   more frequent but never toast unless blacklisted. A plate read that matches the blacklist always creates an `ANPR_MATCH` alert.
5. **Video feeds.** Mock mode: dark placeholder with scanline/noise and boxes drawn on a canvas from `Detection`
   data. Real mode: `<img src>` of the backend MJPEG URL, with the same canvas overlay on top.
6. **Offline first.** Everything works without internet except map tiles. Fonts come from `@fontsource/*` npm
   packages. No CDN links, no third-party API logins. Mock images are generated SVG data URLs.
7. **Roles.** Operators acknowledge, escalate and mark false alarms. Only Commander/Admin resolve alerts and edit
   zones, watchlists, the blacklist and settings (`useCan('resolve' | 'manage')` in `store/auth.ts`).

## Design rules

- Dark control-room theme: navy/charcoal (`base-*` colours), high-contrast text (`ink`, `ink-dim`, `ink-mute`).
- Severity colours: CRITICAL red (`crit`), HIGH orange (`high`), MEDIUM amber (`med`), LOW green (`low`).
  Use the `SEV` map in `lib/format.ts`, never ad-hoc colours.
- Monospace (`font-mono`) for timestamps, plates, IDs and counts.
- Dense but clean, like a real security operations centre, not a generic admin template.
- Must fit 1366x768 without page-level overflow and look good at 1920x1080.
- Shared CSS primitives (`.panel`, `.btn`, `.field`, ...) are in `@layer components` in `index.css`.
- i18n: user-facing nav labels, alert types, severities and statuses go through `useT()`; add keys to
  `i18n/dict.ts` (English required, Hindi optional and falls back to English).
- Every data view needs a loading skeleton, an empty state and an error state (`components/ui.tsx`).

## Rules added with the operational features

- Incidents are derived on the client (`groupIncidents`); never store them separately. Notifications fire once per incident.
- Anything an operator does that matters for accountability calls `audit(...)` from `lib/audit.ts`.
- Alert status changes and notes go through `useData().setStatus` / `saveNotes` so they are queued when the backend
  link is down (`pending` in the store) and replayed on reconnect. Do not call `service.updateAlertStatus` from a page.
- Operator actions that do not change status (playbook ticks, QRT notify, evidence export) are appended to
  `alert.history` with a `kind`.

## Notification policy (ISA-18.2 / EEMUA 191, high-performance HMI)

- Only a NEW CRITICAL incident gets sound, the animated toast and the bell pulse (`notifyLevel` in `store/data.ts`).
  HIGH: quiet toast, no sound. MEDIUM / LOW: no toast, feed only. Notifications fire once per incident.
- Unacknowledged critical: ONE reminder after 60 s, auto-escalation to supervisor after 3 min (status ESCALATED,
  history `kind: "auto-escalation"`, audit category ALERT). Never repeated beeping.
- Mock alert rate is `MOCK_ALERT_INTERVAL_MS` (~1-2 per minute). Plate reads never toast unless blacklisted.
- KPI tiles are neutral grey/ink when normal and only take a severity colour when abnormal. No decorative colour.
- Live Cameras max 3x3 (9 feeds per operator), default 2x2.
- The "A" key acknowledges only the alert in the open critical dialog or the one explicitly clicked
  (`selectedAlertId`), never the card under the mouse, and confirms with an info toast.
- Honest labels: "SHA-256 hash computed" (not "verified"), QRT channels are "Secure SMS / radio relay (simulated)",
  mock mode shows "SIMULATED FEED" on tiles and a "Mock data" pill, the border line is "Indicative ... not official".

## Rules added with clips, drone watch, shelving

- Alert clips: `alert.clip` window (-10 s .. +20 s). Mock clips are simulated and labelled "SIMULATED CLIP"; never present them as real.
- Drone watch: severity raise + `droneWatchId` tagging is a BACKEND rule (mock does it in buildAlert / addPlateRead). The UI only displays it.
- Shelved incidents and out-of-service cameras never notify. Shelving needs a reason; every shelve / unshelve is in history + audit.
- Likelihood band (`likelihood()` in lib/format.ts) is shown as text + icon, never colour alone. LOW likelihood never beeps.
- Resolve is blocked until every mandatory playbook step of the incident is ticked (`missingSteps` in lib/playbooks.ts); the backend enforces it too.
- Every status change is audited once in the store (setStatus / setStatusMany); do not add extra audit calls for status.
- SUSPICIOUS_ACTIVITY always carries `details.subtype`; NIGHT_MOVEMENT only comes from night-mode cameras.

## Status

Built: login with roles, Command Center, Live Cameras, Map View, Alerts + Alert Detail, ANPR, Face Watchlist,
Zones, Analytics, Reports, Settings, Audit Log, System Health, About IBVAP, global alert system, incident grouping,
response playbook, evidence export, offline action queue, keyboard shortcuts, Demo Mode (Ctrl+Shift+D), alert clip player
with bookmarks, drone drop watch + police nakas, suspicious-activity subtypes, vehicle classes, tracking view, shelving,
camera out-of-service, likelihood band, forensic Search, incident owner + On hold + SOP gate on Resolve,
Sector -> BOP -> Camera hierarchy + Sector overview, QRT mobile view (/qrt), camera type (thermal / IR) + AI-degraded
state, shift handover, Demo story "Punjab sector, foggy night, drone drop" (runner mounted in App so it survives /qrt).

Map View (border line, status markers, alert pulse + popup, type/window filters, heat circles, offline grid) and
the Zones editor (polygon + tripwire with direction, drag handles, per-zone severity / classes / dwell, audit log)
are built to the Phase 3 spec. Zone geometry helpers are in `lib/zones.ts`; `lib/border.ts` is an approximate,
illustrative border trace, not survey data.
The FastAPI backend and AI engine do not exist yet; `apiService.ts` has never been run against a real server.
