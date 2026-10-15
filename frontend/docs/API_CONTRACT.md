# IBVAP API Contract (frontend <-> FastAPI backend)

This is what the frontend expects when `VITE_USE_MOCK=false`. The TypeScript source of truth is
`src/types/index.ts` (shapes) and `src/services/api/apiService.ts` (calls). If you change one, change both.

- REST base URL: `VITE_API_URL` (default `http://localhost:8000/api`)
- WebSocket URL: `VITE_WS_URL` (default `ws://localhost:8000/ws`)
- All bodies are JSON, field names are **camelCase**, timestamps are **ISO-8601 UTC strings** (`2026-10-13T18:04:56.000Z`).
- Coordinates in `bbox` and zone `points` are **normalized 0-1** relative to the frame, origin top-left.
- Enable CORS for the frontend origin (`http://localhost:5173` in dev).
- Errors: any non-2xx status. Body `{ "detail": "message" }` (FastAPI default) is fine.
- `DELETE` endpoints return `204` with no body.

> Pydantic tip: use `alias_generator=to_camel` and `populate_by_name=True` so Python stays snake_case and JSON is camelCase.

## 1. Data shapes

### Camera
```json
{
  "id": "cam-01",
  "name": "BOP Sundar - Gate Cam",
  "locationName": "BOP Sundar, Jaisalmer Sector (RJ)",
  "lat": 27.7904,
  "lng": 70.3521,
  "streamUrl": "rtsp://10.21.4.11:554/stream1",
  "status": "online",
  "fps": 25,
  "isNightMode": false,
  "lastSeen": "2026-10-13T18:04:56.000Z",
  "modules": { "human": true, "vehicle": true, "anpr": true, "face": true, "fence": true },
  "visibility": "clear",
  "sensitivity": 0.5,
  "minConfirmFrames": 5,
  "ignoreAnimals": true
}
```
`status`: `online | offline | degraded`

False-alarm controls (set in Settings > Detection, sent with `PUT /cameras/{id}`):
- `visibility`: `clear | low-light | fog | dust`, estimated by the AI engine from the image (brightness / contrast).
- `sensitivity` (0-1): per-camera detection sensitivity; higher lowers the effective confidence threshold.
- `minConfirmFrames`: a detection must persist for this many consecutive frames before an alert is raised.
- `ignoreAnimals`: when true, the `animal` class never raises alerts on this camera.

### Alert
```json
{
  "id": "ALT-00715",
  "timestamp": "2026-10-13T18:04:56.000Z",
  "cameraId": "cam-02",
  "type": "FENCE_INTRUSION",
  "severity": "CRITICAL",
  "status": "NEW",
  "confidence": 0.93,
  "snapshotUrl": "http://localhost:8000/media/snapshots/ALT-00715.jpg",
  "clip": { "url": "http://localhost:8000/media/clips/ALT-00715.mp4", "startOffsetSec": -10, "endOffsetSec": 20 },
  "trackId": 612,
  "bbox": [0.41, 0.52, 0.06, 0.22],
  "details": { "zoneId": "zone-02", "zoneName": "Fence Line East", "objectCount": 1 },
  "assignedTo": null,
  "notes": "",
  "history": [{ "status": "NEW", "at": "2026-10-13T18:04:56.000Z", "by": "AI Engine" }]
}
```
- `type`: `FENCE_INTRUSION | HUMAN_DETECTED | VEHICLE_DETECTED | ANPR_MATCH | FACE_MATCH | LOITERING | NIGHT_MOVEMENT | SUSPICIOUS_ACTIVITY | CAMERA_OFFLINE | DRONE_SIGHTING`
- `severity`: `CRITICAL | HIGH | MEDIUM | LOW`
- `status`: `NEW | ACKNOWLEDGED | ESCALATED | RESOLVED | FALSE_ALARM`
- `confirmFrames` (optional number): how many consecutive frames the detection was confirmed over ("why it fired").
- `visibility` (optional): camera visibility when the alert fired; anything but `clear` is shown as a "low visibility" tag.
- `details.objectClass` (optional): class of the triggering object (`person`, `truck`, ...).
- `clip` (optional): video around the alert. `startOffsetSec` / `endOffsetSec` are seconds relative to `timestamp`
  (record 10 s before to 20 s after, using the engine's ring buffer). `url` may be `null` while the clip is still being
  written. `simulated: true` is only ever set by the mock. Must allow CORS GET (the dashboard hashes it for evidence).
- `bbox` is optional. `trackId` and `assignedTo` may be `null`.
- `history` must contain one entry per status change, oldest first. The frontend computes **response time** as
  (first `ACKNOWLEDGED` entry `at`) - (`timestamp`), so always append, never overwrite.
- `history[].note` is optional.
- `history[].kind` is optional: absent / `"status"` = a status change; `"playbook"`, `"notify"`, `"evidence"`, `"bookmark"`,
  `"shared"`, `"auto-escalation"` log an operator / system action and carry the alert's current status unchanged.
- `history[].offsetSec` (only for `kind: "bookmark"`): clip position in seconds relative to `timestamp`.
- `playbookDone` (optional string array): ids of ticked response-playbook steps (`s1`, `s2`, ...).
- `qrtNotifiedAt` (optional): when the Quick Reaction Team was last notified.

`details` (all optional; send what applies to the type):

| Field | Used by |
|---|---|
| `plateNumber`, `vehicleClass`, `vehicleColor` | VEHICLE_DETECTED, ANPR_MATCH (and SUSPICIOUS_ACTIVITY / FAKE_PLATE) |
| `subtype` (**required** for SUSPICIOUS_ACTIVITY) | `WALL_SCALING | FAKE_PLATE | UNATTENDED_OBJECT | CROWD_GATHERING | CRAWLING`. (`LOITERING` stays its own alert type; the UI lists it with the subtypes.) |
| `blacklistReason` | ANPR_MATCH |
| `matchedPersonId`, `matchedPersonName`, `similarity` (0-1), `faceCropUrl` | FACE_MATCH |
| `zoneId`, `zoneName` | FENCE_INTRUSION, LOITERING |
| `dwellTimeSec` | LOITERING |
| `objectCount` | HUMAN_DETECTED, NIGHT_MOVEMENT, FENCE_INTRUSION |
| `description` | any |
| `droneWatchId`, `severityRaisedFrom` | any person / vehicle type inside an active drone watch (see Drone watch) |

`vehicleClass` (alerts and `PlateRead`) is one of `car | truck | bus | motorcycle | tractor | jeep`, lowercase.

`NIGHT_MOVEMENT` must only be raised by cameras whose `isNightMode` is true (IR / low-light), so operators can
tell it apart from ordinary human detection.

Plates are stored **without spaces, uppercase** (`RJ14AB1234`); the UI formats them.

### Incident (derived, no endpoint needed)
The dashboard groups alerts into incidents **on the client** to reduce alert fatigue. The backend does not need to
store incidents, but if it sends webhooks to a C2 system it should apply the same rule:

An alert joins an existing incident when
1. it has the same `cameraId` + `trackId` and arrives within **10 minutes** of that incident's last alert, or
2. it has the same `cameraId` + `type` and arrives within **2 minutes** of that incident's last alert.

```json
{
  "id": "INC-00715", "cameraId": "cam-02", "type": "FENCE_INTRUSION", "trackId": 612,
  "alerts": ["...Alert objects, newest first..."],
  "firstSeen": "2026-10-13T18:04:56.000Z", "lastSeen": "2026-10-13T18:05:40.000Z",
  "severity": "CRITICAL", "status": "NEW"
}
```
`severity` = highest among its alerts. `status` = `NEW` if any alert is NEW, else `ESCALATED` if any, else
`FALSE_ALARM` / `RESOLVED` when all are closed, else `ACKNOWLEDGED`. Toasts, sound and the critical dialog fire once
per incident (again only if a later alert is more severe). Incident-level buttons simply call
`PATCH /alerts/{id}/status` for each open alert in the group.

For this to work the AI engine must keep `trackId` stable while an object stays in view.

### Detection / DetectionFrame (live overlay)
```json
{
  "cameraId": "cam-02",
  "timestamp": "2026-10-13T18:04:56.100Z",
  "detections": [
    { "trackId": 612, "class": "person", "confidence": 0.91, "bbox": [0.41, 0.52, 0.06, 0.22] }
  ]
}
```
`class`: `person | car | truck | motorcycle | bus | tractor | animal`

### Zone (virtual fence / restricted area)
```json
{
  "id": "zone-02",
  "cameraId": "cam-02",
  "name": "Fence Line East",
  "type": "line",
  "points": [[0.02, 0.48], [0.98, 0.4]],
  "active": true,
  "schedule": "always",
  "severity": "CRITICAL",
  "classes": ["person"],
  "minDwellSec": 0,
  "direction": "forward"
}
```

| Field | Values | Meaning for the AI engine |
|---|---|---|
| `type` | `polygon \| line` | polygon = restricted area (3+ points), line = tripwire (exactly 2 points: A, B) |
| `points` | `[x, y][]`, each 0-1 | Multiply by the frame width / height. Works at any resolution. |
| `active` | boolean | Inactive zones must not raise alerts |
| `schedule` | `always \| night-only` | `night-only` zones are armed only while the camera is in night mode |
| `severity` | `CRITICAL \| HIGH \| MEDIUM \| LOW` | Severity of the `FENCE_INTRUSION` alert this zone raises |
| `classes` | array of `person \| vehicle \| animal` | Only these object groups trigger the zone. `vehicle` = car, truck, bus, motorcycle, tractor. Default `["person","vehicle"]` (animals ignored). |
| `minDwellSec` | number >= 0 | Object must stay inside a polygon this long before alerting (0 = immediately). Ignored for lines. |
| `direction` | `both \| forward \| reverse` | Lines only. Stand at A looking at B: `forward` = object crosses from your LEFT to your RIGHT, `reverse` = right to left, `both` = any crossing. |

Direction test for a track moving from `p` to `q` (pixel coords, y down), with `d = B - A`:
`side(v) = d.x * (v.y - A.y) - d.y * (v.x - A.x)`. `forward` when `side(p) < 0` and `side(q) > 0`; `reverse` when the signs are swapped.

A `FENCE_INTRUSION` (or `LOITERING`) alert raised by a zone must set `details.zoneId` and `details.zoneName`
to a real zone, so the UI can highlight it on the snapshot.

### ZoneAuditEntry
```json
{
  "id": "za-12", "at": "2026-10-13T18:20:00.000Z", "by": "Insp. A. Rathore", "action": "UPDATE",
  "zoneId": "zone-02", "zoneName": "Fence Line East", "cameraId": "cam-02",
  "changes": "severity: HIGH -> CRITICAL; shape edited"
}
```
`action`: `CREATE | UPDATE | DELETE`. `changes` is free text for humans.

### PlateRead
```json
{
  "id": "pr-1042", "timestamp": "2026-10-13T18:01:30.000Z", "cameraId": "cam-03",
  "plate": "RJ14CA4521", "vehicleClass": "Pickup", "color": "White", "confidence": 0.94,
  "cropUrl": "http://localhost:8000/media/plates/pr-1042.jpg",
  "blacklisted": true, "needsVerification": false, "correctedFrom": "RJ14CA4S21"
}
```
`color` may be `null`. `correctedFrom` is optional (set after an operator correction).
Set `needsVerification: true` for low OCR confidence (the mock uses < 0.7).

### BlacklistVehicle
```json
{ "id": "bl-01", "plate": "RJ14CA4521", "reason": "SMUGGLING", "priority": "HIGH", "notes": "White pickup", "addedAt": "2026-09-23T10:00:00.000Z" }
```
`reason`: `STOLEN | SMUGGLING | WANTED | OTHER`. `priority`: `HIGH | MEDIUM | LOW`

### WatchlistPerson
```json
{
  "id": "wp-01", "name": "Subject W-014", "category": "WANTED", "riskLevel": "HIGH",
  "photos": ["http://localhost:8000/media/faces/wp-01_1.jpg"],
  "notes": "FIR 112/2025", "addedAt": "2026-08-10T09:00:00.000Z"
}
```
`category`: `WANTED | SUSPECT | MISSING | AUTHORISED`. `riskLevel`: `HIGH | MEDIUM | LOW`.
On **create**, the frontend sends `photos` as base64 **data URLs** (`data:image/jpeg;base64,...`); the backend should
store them and return normal URLs.

### FaceMatch
```json
{
  "id": "fm-88", "timestamp": "2026-10-13T16:35:26.000Z", "cameraId": "cam-01", "personId": "wp-06",
  "similarity": 0.82, "capturedUrl": "http://localhost:8000/media/faces/fm-88.jpg",
  "alertId": "ALT-00702", "review": "PENDING", "reviewedBy": "Ct. S. Meena"
}
```
`review`: `PENDING | CONFIRMED | REJECTED`. `alertId` may be `null`, `reviewedBy` is optional.

### User
```json
{ "id": "u-02", "name": "Ct. S. Meena", "username": "meena", "role": "OPERATOR", "active": true }
```
`role`: `OPERATOR | COMMANDER | ADMIN`

### AppSettings
```json
{
  "confidenceThreshold": 0.5, "loiteringSeconds": 30, "nightMode": "auto", "webhookUrl": "",
  "retention": { "clipsDays": 30, "snapshotsDays": 90, "faceDataDays": 30 },
  "blurFacesInExports": true,
  "sessionTimeoutMin": 15
}
```
`nightMode`: `auto | on | off`. Each `retention` value is `7 | 30 | 90` days; the backend must delete clips,
snapshots and face crops / embeddings older than that (data minimisation under the DPDP Act 2023).
`sessionTimeoutMin`: the dashboard signs the user out after this many idle minutes.

## 2. REST endpoints

Paths are relative to `VITE_API_URL`.

### Auth
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ "username": "meena", "role": "OPERATOR" }` | `User` |

Hackathon build: no password, the role is chosen on the login screen. Real auth (password + token) can be added
later without changing the rest of the contract.

### Cameras
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/cameras` | | `Camera[]` |
| POST | `/cameras` | partial `Camera` (at least `name`, `streamUrl`, `lat`, `lng`, `locationName`) | `Camera` |
| PUT | `/cameras/{id}` | partial `Camera` (only changed fields, e.g. `{ "id", "name", "modules" }`) | `Camera` |
| POST | `/cameras/test` | `{ "streamUrl": "rtsp://..." }` | `{ "ok": true, "latencyMs": 84, "message": "Stream reachable" }` |
| GET | `/cameras/{id}/stream.mjpg` | | `multipart/x-mixed-replace` MJPEG stream |

The MJPEG stream is used directly as `<img src>`. Send **raw frames without boxes**: the frontend draws boxes and
zones itself from the `detections` WebSocket channel, so operators can toggle them. Add
`Access-Control-Allow-Origin` on this response too, otherwise the Snapshot button cannot read the frame.

### Alerts
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/alerts` | `?from=ISO&to=ISO&cameraId=cam-01&limit=100` (all optional) | `Alert[]`, **newest first** |
| GET | `/alerts/{id}` | | `Alert` |
| PATCH | `/alerts/{id}/status` | `{ "status": "ACKNOWLEDGED", "by": "Ct. S. Meena", "note": "optional", "at": "optional ISO time", "kind": "optional" }` | updated `Alert` |
| GET | `/cameras/{id}/tracks/{trackId}` | `?around=ISO` | `TrackPoint[]` `{ at, bbox, confidence, class }`, oldest first, sightings of that track within a few minutes of `around` (Alert Detail > Tracking) |
| GET | `/alerts/{id}/clip` | | `AlertClip` (`{ url, startOffsetSec, endOffsetSec }`), 404 if none |
| POST | `/alerts/{id}/history` | `{ "kind": "bookmark", "note": "+2.5 s: climbs fence", "by": "Ct. S. Meena", "offsetSec": 2.5 }` | updated `Alert` (append entry with current `status` and server `at`, broadcast on WS) |
| PATCH | `/alerts/{id}/notes` | `{ "notes": "text" }` | updated `Alert` |
| PATCH | `/alerts/{id}/playbook` | `{ "stepId": "s2", "label": "Inform QRT", "done": true, "by": "Ct. S. Meena" }` | updated `Alert` |
| POST | `/alerts/{id}/notify-qrt` | `{ "channel": "WHATSAPP", "message": "text", "by": "Ct. S. Meena" }` | updated `Alert` |

**Offline queue:** when the link is down the dashboard queues acknowledge / escalate / false-alarm / resolve and
notes edits, and replays them in order after reconnecting. Queued status changes carry `at` = the moment the
operator really clicked. When `at` is present the backend must use it (not the receive time) as the history entry
time, so response-time analytics stay correct. Replays can arrive late or twice: applying the same status again must
be harmless, and an unknown alert id should return 404 (the dashboard then drops that action).

`kind` is only sent for system-made changes, currently `"auto-escalation"` (see section 4); store it on the history entry.

On a status change the backend must: set `status`, append `{status, at: now, by, note, kind?}` to `history`, set
`assignedTo`, and **broadcast the updated alert on the WebSocket** (so other operator screens update).
**Evidence:**

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/alerts/{id}/evidence` | | `EvidenceRecord` |
| POST | `/alerts/{id}/evidence/export` | `{ "by": "Insp. A. Rathore", "packageSha256": "ab12...", "files": ["ALT-00733/snapshot.jpg"] }` | updated `Alert` |

```json
{ "alertId": "ALT-00733", "algorithm": "SHA-256", "snapshotSha256": "9f2c...64 hex chars", "clipSha256": "optional", "recordedAt": "2026-10-13T18:04:56.000Z" }
```
- The backend must compute `snapshotSha256` (and `clipSha256`) **when it writes the file** and never change it. The
  dashboard downloads the file, hashes it in the browser and shows "SHA-256 hash computed" (with a mismatch warning if they differ). This is a hash, not a signature: it proves the file is unchanged since the hash was recorded, nothing more.
- `snapshotUrl` / `clipUrl` must allow CORS `GET` from the dashboard origin, otherwise the browser cannot hash or zip them.
- The ZIP itself is built in the browser (snapshot, clip file if `clip.url` is set, `metadata.json` with the clip window
  and all bookmarks, `SHA256SUMS.txt`, `chain_of_custody.json`).
  `evidence/export` only records that it happened: append a history entry with `kind: "evidence"`.
- When `AppSettings.blurFacesInExports` is true, `snapshotUrl` / `clipUrl` requested with `?blur=1` should return a copy
  with non-watchlist faces blurred. (The mock cannot blur; the custody log records `faceBlurApplied: false`.)

**Playbook:** add / remove `stepId` in `playbookDone` and append a history entry
`{ kind: "playbook", status: <current>, at, by, note: "Done: Inform QRT" }`. The step lists live in the frontend
(`src/lib/playbooks.ts`); the backend only stores ids.

**Notify QRT:** `channel` is `SMS` (secure SMS gateway) or `WHATSAPP` (kept as the enum value for compatibility; the UI
labels it "radio relay"). Send `message` through the matching gateway to the QRT
contacts of that camera's sector, set `qrtNotifiedAt`, append a history entry with `kind: "notify"`. Return a
non-2xx status if the gateway rejects it, so the UI can show "not sent".

All three PATCH/POST calls above must also broadcast the updated alert on the WebSocket.

On startup the frontend loads the last 14 days with `GET /alerts?from=...`.

### Zones
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/zones` | | `Zone[]` (all cameras) |
| POST | `/zones` | `Zone` without `id`, plus `"by": "user name"` | `Zone` |
| PUT | `/zones/{id}` | `Zone`, plus `"by": "user name"` | `Zone` |
| DELETE | `/zones/{id}?by=user+name` | | 204 |
| GET | `/zones/audit` | | `ZoneAuditEntry[]`, newest first |

- Only Commander / Admin may create, edit or delete zones (the UI enforces this; the backend should too).
- Every create / update / delete must append a `ZoneAuditEntry` (who, when, what changed).
- The AI engine should load `GET /zones` at start and reload whenever a zone changes, so edits made in the
  Zones editor take effect without a restart.

### ANPR
| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/anpr/reads` | `?search=RJ14&from=ISO&to=ISO&limit=300` (all optional; `search` = substring of plate) | `PlateRead[]`, newest first |
| PATCH | `/anpr/reads/{id}` | `{ "plate": "RJ14CA4521" }` (operator correction) | updated `PlateRead` |
| GET | `/anpr/blacklist` | | `BlacklistVehicle[]` |
| POST | `/anpr/blacklist` | `BlacklistVehicle` without `id`, `addedAt` | `BlacklistVehicle` |
| DELETE | `/anpr/blacklist/{id}` | | 204 |

**Rule:** every plate read whose `plate` is on the blacklist must create an `ANPR_MATCH` alert
(severity `CRITICAL` if blacklist priority is `HIGH`, otherwise `HIGH`). This also applies when an operator
correction turns a read into a blacklisted plate.

### Faces
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/faces/watchlist` | | `WatchlistPerson[]` |
| POST | `/faces/watchlist` | `WatchlistPerson` without `id`, `addedAt` (photos as data URLs) | `WatchlistPerson` |
| DELETE | `/faces/watchlist/{id}` | | 204 |
| GET | `/faces/matches` | | `FaceMatch[]`, newest first |
| PATCH | `/faces/matches/{id}` | `{ "review": "CONFIRMED", "by": "Ct. S. Meena" }` | updated `FaceMatch` |

Every watchlist match (except category `AUTHORISED`) should also create a `FACE_MATCH` alert and link it via `alertId`.

### Drone watch and police nakas
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/drone-watches` | | `DroneWatch[]` (active and recently expired, newest first) |
| POST | `/drone-watches` | `{ "lat": 31.866, "lng": 74.631, "radiusKm": 2, "durationH": 4, "reason": "text", "linkedAlertId": "ALT-00921", "createdBy": "Ct. S. Meena" }` | `DroneWatch` |
| POST | `/drone-watches/{id}/end` | `{ "by": "Insp. A. Rathore" }` | `DroneWatch` with `endedAt` |
| GET | `/nakas` | | `Naka[]` |
| POST | `/nakas/share` | `{ "alertIds": ["ALT-1"], "plateReadId": "pr-9", "nakaIds": ["nk-01"], "by": "..." }` (either target) | 204 |

```json
{ "id": "dw-12", "lat": 31.8662, "lng": 74.6311, "radiusKm": 2, "startedAt": "2026-10-15T21:02:00Z", "expiresAt": "2026-10-16T01:02:00Z",
  "reason": "Drone sighting ALT-00921", "linkedAlertId": "ALT-00921", "createdBy": "Ct. S. Meena", "endedAt": null }
{ "id": "nk-01", "name": "Joint Naka - Ajnala Road", "lat": 31.8489, "lng": 74.6702, "agency": "Punjab Police + BSF" }
```
- `radiusKm` is 1, 2 or 5; `durationH` 2, 4 or 6. A watch is active while `endedAt` is null and `expiresAt` is in the future.
- **Backend rule:** while a watch is active, every person / vehicle alert (`HUMAN_DETECTED, VEHICLE_DETECTED, NIGHT_MOVEMENT,
  LOITERING, SUSPICIOUS_ACTIVITY, FENCE_INTRUSION, ANPR_MATCH`) from a camera within `radiusKm` (great-circle distance)
  gets `details.droneWatchId` and is raised one severity level (`severityRaisedFrom` = the original). Plate reads from
  such cameras get `droneWatchId`. The UI shows these as "In drone watch area".
- `nakas/share`: hand-off to police (SMS / radio gateway). For each alert append a history entry `kind: "shared"`;
  for a plate read set `sharedAt`. Broadcast updated alerts on the WebSocket.
- `PlateRead` gains optional `droneWatchId` and `sharedAt`.

### Edge node health
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health/nodes` | | `EdgeNode[]` |

```json
{
  "id": "edge-01", "name": "BOP Sundar Edge Node", "locationName": "BOP Sundar, Jaisalmer Sector (RJ)",
  "status": "online",
  "cpuPct": 48, "gpuPct": 62, "ramPct": 55, "diskPct": 41, "tempC": 58,
  "processingFps": 24.1, "latencyMs": 70, "uptimeSec": 1832400, "bandwidthMbps": 3.2,
  "modelVersion": "yolo11s-ibvap-1.4.2", "cameraIds": ["cam-01", "cam-02"],
  "lastHeartbeat": "2026-10-13T18:20:00.000Z"
}
```
`status`: `online | degraded | offline`. Each edge node (the box running the AI engine at an outpost) should send a
heartbeat with these numbers every few seconds; the backend marks a node `offline` when heartbeats stop. The System
Health page polls this endpoint every 5 s and warns at: temperature >= 80 °C, disk >= 90 %, processing FPS < 12,
latency > 250 ms, CPU >= 90 %.

### Audit log
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/audit` | | `AuditEntry[]`, newest first (Commander / Admin only) |
| POST | `/audit` | `AuditEntry` without `id`, `at` | 204 |

```json
{
  "id": "au-91", "at": "2026-10-13T18:20:00.000Z", "user": "Insp. A. Rathore", "role": "COMMANDER",
  "category": "EVIDENCE", "action": "Evidence exported", "target": "ALT-00733", "details": "1 alert(s), 3 files"
}
```
`category`: `AUTH | CAMERA_VIEW | ZONE | WATCHLIST | BLACKLIST | ANPR | EXPORT | EVIDENCE | SETTINGS | ALERT | DRONE`.

The dashboard POSTs an entry for: sign-in / sign-out (incl. auto-logout), opening a camera's live view, zone
create / update / delete, watchlist and blacklist edits, face-match review, plate correction, CSV / report / evidence
exports, and settings or camera changes. The backend sets `id` and `at` (server time) and must make entries
append-only. In production the backend should take `user` / `role` from the authenticated session, not from the body.

`User` has an optional `lastLogin` timestamp, set by `POST /auth/login`.

### Users, settings, integration
| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/users` | | `User[]` |
| GET | `/settings` | | `AppSettings` |
| PUT | `/settings` | `AppSettings` | `AppSettings` |
| POST | `/integration/webhook/test` | `{ "url": "https://c2.example/ibvap" }` | `{ "ok": true, "message": "200 OK" }` |

**Webhook (Command & Control integration):** when `webhookUrl` is set, POST every new alert to it as
`{ "event": "alert.created", "data": Alert }`. The test endpoint sends one sample event and reports the result.

## 3. WebSocket

One connection to `VITE_WS_URL`. The frontend reconnects automatically with exponential backoff (1 s, doubling up to 15 s) and shows the link as
Connected / Reconnecting / Offline in the top bar.

### Server -> client
Every message is `{ "type": ..., "data": ... }`:

| `type` | `data` | When |
|---|---|---|
| `alert` | `Alert` | A new alert is created **or** an existing alert changes (status, notes). The frontend upserts by `id`. |
| `plate_read` | `PlateRead` | Every new ANPR read |
| `detections` | `DetectionFrame` | ~5-10 times per second, only for cameras the client subscribed to |

```json
{ "type": "alert", "data": { "id": "ALT-00716", "type": "ANPR_MATCH", "...": "..." } }
```

### Client -> server
```json
{ "action": "subscribe", "channel": "detections", "cameraId": "cam-02" }
{ "action": "unsubscribe", "channel": "detections", "cameraId": "cam-02" }
```
`alert` and `plate_read` are always sent to every client; no subscription needed. After a reconnect the client
re-sends its `subscribe` messages.

## 4. Behaviour the UI relies on

- Notification policy (ISA-18.2 / EEMUA 191): a new `NEW` alert that starts a CRITICAL incident gets sound, an animated
  toast and the bell pulse; HIGH gets a quiet toast; MEDIUM / LOW only appear in the feed. Do not re-send old alerts as new ids.
- Unacknowledged CRITICAL incident: one silent reminder after 60 s. After 3 min the dashboard sets every NEW alert of
  the incident to `ESCALATED` with `by: "System (auto-escalation)"`, `kind: "auto-escalation"`, and POSTs an
  audit entry (`category: "ALERT"`). A backend may do this itself instead; repeating the same status must be harmless.
- Target alert volume is about 6-12 operator-facing alarms per hour; tune AI thresholds towards that.
- `FENCE_INTRUSION` and `FACE_MATCH` open the full-screen critical dialog on every operator screen.
- When a camera stops sending frames: set its `status` to `offline`, keep `lastSeen`, and raise a `CAMERA_OFFLINE` alert.
- If the backend is unreachable the frontend shows cached GET responses and a "Backend not reachable" banner.
