// Shared domain types. The backend must return JSON in exactly these shapes
// (see docs/API_CONTRACT.md). All timestamps are ISO-8601 strings.

export type CameraStatus = 'online' | 'offline' | 'degraded'

/** Scene visibility estimated by the AI engine. Anything other than "clear" raises the false-alarm risk. */
export type Visibility = 'clear' | 'low-light' | 'fog' | 'dust'

export interface DetectionModules {
  human: boolean
  vehicle: boolean
  anpr: boolean
  face: boolean
  fence: boolean
}

/** Sensor type. Thermal and IR-night cameras keep working in darkness; thermal also sees through light fog. */
export type CameraType = 'visible' | 'thermal' | 'ir-night'

export interface Camera {
  id: string
  cameraType: CameraType
  name: string
  locationName: string
  lat: number
  lng: number
  streamUrl: string
  status: CameraStatus
  fps: number
  isNightMode: boolean
  lastSeen: string
  modules: DetectionModules
  visibility: Visibility
  /** 0-1. Higher = detects more, at the cost of more false alarms. */
  sensitivity: number
  /** An object must be detected in this many consecutive frames before an alert is raised. */
  minConfirmFrames: number
  ignoreAnimals: boolean
  /** Set by a Commander / Admin: the camera's alerts are suppressed until cleared. */
  outOfService?: { reason: string; by: string; since: string } | null
}

export type AlertType =
  | 'FENCE_INTRUSION'
  | 'HUMAN_DETECTED'
  | 'VEHICLE_DETECTED'
  | 'ANPR_MATCH'
  | 'FACE_MATCH'
  | 'LOITERING'
  | 'NIGHT_MOVEMENT'
  | 'SUSPICIOUS_ACTIVITY'
  | 'CAMERA_OFFLINE'
  | 'DRONE_SIGHTING'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

/** Required on SUSPICIOUS_ACTIVITY alerts. LOITERING is also its own alert type and is listed here for filtering. */
export type SuspiciousSubtype = 'WALL_SCALING' | 'FAKE_PLATE' | 'UNATTENDED_OBJECT' | 'CROWD_GATHERING' | 'CRAWLING' | 'LOITERING'

/** Vehicle classification from the detector. */
export type VehicleClass = 'car' | 'truck' | 'bus' | 'motorcycle' | 'tractor' | 'jeep'

export type AlertStatus = 'NEW' | 'ACKNOWLEDGED' | 'ESCALATED' | 'RESOLVED' | 'FALSE_ALARM'

/** [x, y, w, h], all normalized 0-1 relative to the frame, origin top-left. */
export type BBox = [number, number, number, number]

export interface AlertDetails {
  plateNumber?: string
  vehicleClass?: VehicleClass
  /** Required when type is SUSPICIOUS_ACTIVITY. */
  subtype?: SuspiciousSubtype
  vehicleColor?: string
  blacklistReason?: string
  matchedPersonId?: string
  matchedPersonName?: string
  similarity?: number
  faceCropUrl?: string
  zoneId?: string
  zoneName?: string
  dwellTimeSec?: number
  objectCount?: number
  description?: string
  /** Class of the object that triggered the alert (person, truck, ...). */
  objectClass?: string
  /** Set when the camera was inside an active drone watch: the alert was raised one severity level. */
  droneWatchId?: string
  /** Severity before the drone-watch raise. */
  severityRaisedFrom?: Severity
}

export interface AlertHistoryEntry {
  /** Alert status at the time of the entry. */
  status: AlertStatus
  at: string
  by: string
  note?: string
  /** Absent or "status" = a status change. Other kinds log operator actions without changing status. */
  kind?: HistoryKind
  /** kind "bookmark": position in the clip, seconds relative to the alert moment (negative = before). */
  offsetSec?: number
}

export type QrtStatus = 'ASSIGNED' | 'ACCEPTED' | 'ON_SCENE' | 'CLEARED'

export type HistoryKind = 'status' | 'playbook' | 'notify' | 'evidence' | 'auto-escalation' | 'bookmark' | 'shared' | 'shelve' | 'unshelve' | 'qrt'

/**
 * Video clip around the alert moment. Offsets are seconds relative to `Alert.timestamp`
 * (default -10 .. +20). `url` is null when the backend has no video (the mock renders a simulated clip).
 */
export interface AlertClip {
  url: string | null
  startOffsetSec: number
  endOffsetSec: number
  /** True for the mock's canvas-rendered clip. Never true for real evidence. */
  simulated?: boolean
}

export interface Alert {
  id: string
  timestamp: string
  cameraId: string
  type: AlertType
  severity: Severity
  status: AlertStatus
  confidence: number
  snapshotUrl: string
  clip?: AlertClip
  trackId: number | null
  bbox?: BBox
  /** Why it fired: number of consecutive frames the detection was confirmed over. */
  confirmFrames?: number
  /** Visibility at the camera when the alert fired. */
  visibility?: Visibility
  details: AlertDetails
  assignedTo: string | null
  notes: string
  history: AlertHistoryEntry[]
  /** Ids of completed response-playbook steps (see src/lib/playbooks.ts). */
  playbookDone?: string[]
  /** Set when the Quick Reaction Team was notified. */
  qrtNotifiedAt?: string
  /** QRT task state, set by the QRT mobile view: ASSIGNED on notify, then ACCEPTED -> ON_SCENE -> CLEARED. */
  qrtStatus?: QrtStatus
  /** Shelved (snoozed) by an operator until this time: hidden from the live feed, no notifications. */
  shelvedUntil?: string | null
  shelveReason?: string
}

/**
 * A group of related alerts shown to the operator as one item.
 * Derived on the client from the alert list (see src/lib/incidents.ts for the rule).
 */
export interface Incident {
  id: string
  cameraId: string
  /** Type of the most severe alert in the group. */
  type: AlertType
  trackId: number | null
  /** Newest first. */
  alerts: Alert[]
  firstSeen: string
  lastSeen: string
  /** Highest severity among its alerts. */
  severity: Severity
  /** NEW if any alert is NEW, else ESCALATED if any, else closed when all are closed, else ACKNOWLEDGED. */
  status: AlertStatus
}

export type DetectionClass = 'person' | 'car' | 'truck' | 'motorcycle' | 'bus' | 'tractor' | 'jeep' | 'animal'

export interface Detection {
  trackId: number
  class: DetectionClass
  confidence: number
  bbox: BBox
}

/** One sighting of a tracked object (Alert Detail > Tracking). */
export interface TrackPoint {
  at: string
  bbox: BBox
  confidence: number
  class: DetectionClass | 'drone'
}

export interface DetectionFrame {
  cameraId: string
  timestamp: string
  detections: Detection[]
}

/** Object groups a zone reacts to. "vehicle" covers car, truck, bus, motorcycle and tractor. */
export type ZoneClass = 'person' | 'vehicle' | 'animal'

/**
 * Tripwire crossing direction, relative to walking from points[0] (A) to points[1] (B):
 *  - forward: object crosses from the LEFT side of A->B to the RIGHT side
 *  - reverse: right side to left side
 *  - both:    any crossing
 */
export type TripwireDirection = 'both' | 'forward' | 'reverse'

export interface Zone {
  id: string
  cameraId: string
  name: string
  type: 'polygon' | 'line'
  /** Normalized 0-1 so the zone works at any video resolution. line = 2 points, polygon = 3+. */
  points: [number, number][]
  active: boolean
  schedule: 'always' | 'night-only'
  /** Severity of the alert this zone raises. */
  severity: Severity
  /** Object classes that trigger the zone (animals are ignored by default). */
  classes: ZoneClass[]
  /** Seconds an object must stay inside (polygon) before alerting. 0 = immediately. */
  minDwellSec: number
  /** Only meaningful for type "line". */
  direction: TripwireDirection
}

export interface ZoneAuditEntry {
  id: string
  at: string
  by: string
  action: 'CREATE' | 'UPDATE' | 'DELETE'
  zoneId: string
  zoneName: string
  cameraId: string
  /** Human-readable summary of what changed. */
  changes: string
}

export type PersonCategory = 'WANTED' | 'SUSPECT' | 'MISSING' | 'AUTHORISED'
export type Level = 'HIGH' | 'MEDIUM' | 'LOW'

export interface WatchlistPerson {
  id: string
  name: string
  category: PersonCategory
  riskLevel: Level
  photos: string[]
  notes: string
  addedAt: string
}

export type BlacklistReason = 'STOLEN' | 'SMUGGLING' | 'WANTED' | 'OTHER'

export interface BlacklistVehicle {
  id: string
  plate: string
  reason: BlacklistReason
  priority: Level
  notes: string
  addedAt: string
}

export interface PlateRead {
  id: string
  timestamp: string
  cameraId: string
  plate: string
  vehicleClass: VehicleClass
  color: string | null
  confidence: number
  cropUrl: string
  blacklisted: boolean
  needsVerification: boolean
  correctedFrom?: string
  /** Camera was inside an active drone watch when the plate was read. */
  droneWatchId?: string
  /** When this read was shared with a police naka. */
  sharedAt?: string
}

/**
 * Drone drop watch: area around a reported drone sighting. While active, person / vehicle alerts and plate reads
 * from cameras inside the circle are tagged and raised one severity level.
 */
export interface DroneWatch {
  id: string
  lat: number
  lng: number
  radiusKm: 1 | 2 | 5
  startedAt: string
  expiresAt: string
  reason: string
  linkedAlertId: string | null
  createdBy: string
  /** Set when ended early by an operator. */
  endedAt?: string
}

/** Police / joint check point (naka) that can receive shared alerts. */
export interface Naka {
  id: string
  name: string
  lat: number
  lng: number
  /** e.g. "Punjab Police + BSF" */
  agency: string
}

export type ReviewState = 'PENDING' | 'CONFIRMED' | 'REJECTED'

export interface FaceMatch {
  id: string
  timestamp: string
  cameraId: string
  personId: string
  similarity: number
  capturedUrl: string
  alertId: string | null
  review: ReviewState
  reviewedBy?: string
}

export type Role = 'OPERATOR' | 'COMMANDER' | 'ADMIN'

export interface User {
  id: string
  name: string
  username: string
  role: Role
  active: boolean
  lastLogin?: string
}

export type AuditCategory = 'AUTH' | 'CAMERA_VIEW' | 'ZONE' | 'WATCHLIST' | 'BLACKLIST' | 'ANPR' | 'EXPORT' | 'EVIDENCE' | 'SETTINGS' | 'ALERT' | 'DRONE' | 'CAMERA'

export interface AuditEntry {
  id: string
  at: string
  user: string
  role: Role
  category: AuditCategory
  /** Short verb phrase, e.g. "Opened live view", "Zone updated". */
  action: string
  /** What it was done to: camera name, zone name, plate, alert id... */
  target: string
  details: string
}

export type RetentionDays = 7 | 30 | 90

export interface AppSettings {
  confidenceThreshold: number
  loiteringSeconds: number
  nightMode: 'auto' | 'on' | 'off'
  webhookUrl: string
  /** Data & privacy: how long each kind of data is kept before automatic deletion. */
  retention: { clipsDays: RetentionDays; snapshotsDays: RetentionDays; faceDataDays: RetentionDays }
  /** Blur faces of people who are not on the watchlist in exported snapshots / clips. */
  blurFacesInExports: boolean
  /** Auto-logout after this many minutes without operator activity. */
  sessionTimeoutMin: number
}

/** Hash recorded by the backend when the evidence file was captured. */
export interface EvidenceRecord {
  alertId: string
  algorithm: 'SHA-256'
  snapshotSha256: string
  clipSha256?: string
  recordedAt: string
}

/** Backend link: online = Connected, connecting = Reconnecting, offline = Offline. */
export type ConnectionState = 'connecting' | 'online' | 'offline'

/** AI processing box at an outpost (one per BOP / check post). */
export interface EdgeNode {
  id: string
  name: string
  locationName: string
  status: 'online' | 'degraded' | 'offline'
  cpuPct: number
  gpuPct: number
  ramPct: number
  diskPct: number
  tempC: number
  /** Frames per second the AI engine is actually processing (all cameras averaged). */
  processingFps: number
  /** Round-trip latency from the node to the command centre. */
  latencyMs: number
  uptimeSec: number
  bandwidthMbps: number
  modelVersion: string
  cameraIds: string[]
  lastHeartbeat: string
}

/** Operator action made while the backend was unreachable, waiting to be synced. */
export interface PendingAction {
  key: string
  kind: 'status' | 'notes'
  alertId: string
  status?: AlertStatus
  note?: string
  notes?: string
  by: string
  /** History kind for system-made status changes (e.g. "auto-escalation"). */
  historyKind?: AlertHistoryEntry['kind']
  /** When the operator actually did it (sent to the backend so response times stay correct). */
  at: string
}
