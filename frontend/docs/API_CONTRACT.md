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
  "modules": { "human": true, "vehicle": true, "anpr": true, "face": true, "fence": true }
}
```
`status`: `online | offline | degraded`

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
  "clipUrl": "http://localhost:8000/media/clips/ALT-00715.mp4",
  "trackId": 612,
  "bbox": [0.41, 0.52, 0.06, 0.22],
  "details": { "zoneId": "zone-02", "zoneName": "Fence Line East", "objectCount": 1 },
  "assignedTo": null,
  "notes": "",
  "history": [{ "status": "NEW", "at": "2026-10-13T18:04:56.000Z", "by": "AI Engine" }]
}
```
- `type`: `FENCE_INTRUSION | HUMAN_DETECTED | VEHICLE_DETECTED | ANPR_MATCH | FACE_MATCH | LOITERING | NIGHT_MOVEMENT | SUSPICIOUS_ACTIVITY | CAMERA_OFFLINE`
- `severity`: `CRITICAL | HIGH | MEDIUM | LOW`
- `status`: `NEW | ACKNOWLEDGED | ESCALATED | RESOLVED | FALSE_ALARM`
- `clipUrl`, `bbox` are optional. `trackId` and `assignedTo` may be `null`.
- `history` must contain one entry per status change, oldest first. The frontend computes **response time** as
  (first `ACKNOWLEDGED` entry `at`) - (`timestamp`), so always append, never overwrite.
- `history[].note` is optional.

`details` (all optional; send what applies to the type):

| Field | Used by |
|---|---|
| `plateNumber`, `vehicleClass`, `vehicleColor` | VEHICLE_DETECTED, ANPR_MATCH |
| `blacklistReason` | ANPR_MATCH |
| `matchedPersonId`, `matchedPersonName`, `similarity` (0-1), `faceCropUrl` | FACE_MATCH |
| `zoneId`, `zoneName` | FENCE_INTRUSION, LOITERING |
| `dwellTimeSec` | LOITERING |
| `objectCount` | HUMAN_DETECTED, NIGHT_MOVEMENT, FENCE_INTRUSION |
| `description` | any |

Plates are stored **without spaces, uppercase** (`RJ14AB1234`); the UI formats them.

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
{ "confidenceThreshold": 0.5, "loiteringSeconds": 30, "nightMode": "auto", "webhookUrl": "" }
```
`nightMode`: `auto | on | off`

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
| PATCH | `/alerts/{id}/status` | `{ "status": "ACKNOWLEDGED", "by": "Ct. S. Meena", "note": "optional" }` | updated `Alert` |
| PATCH | `/alerts/{id}/notes` | `{ "notes": "text" }` | updated `Alert` |

On a status change the backend must: set `status`, append `{status, at: now, by, note}` to `history`, set
`assignedTo`, and **broadcast the updated alert on the WebSocket** (so other operator screens update).
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

One connection to `VITE_WS_URL`. The frontend reconnects automatically (1 s, doubling up to 15 s).

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

- A new `alert` with status `NEW` triggers the toast / sound / critical modal. Do not re-send old alerts as new ids.
- `FENCE_INTRUSION` and `FACE_MATCH` open the full-screen critical dialog on every operator screen.
- When a camera stops sending frames: set its `status` to `offline`, keep `lastSeen`, and raise a `CAMERA_OFFLINE` alert.
- If the backend is unreachable the frontend shows cached GET responses and a "Backend not reachable" banner.
