import type {
  Alert, AlertStatus, AlertType, AppSettings, AuditEntry, BlacklistVehicle, Camera, ConnectionState, EdgeNode, EvidenceRecord,
  DetectionFrame, FaceMatch, PlateRead, ReviewState, Role, User, WatchlistPerson, Zone, ZoneAuditEntry,
} from '@/types'

export interface AlertQuery {
  from?: string
  to?: string
  cameraId?: string
  limit?: number
}

export interface PlateQuery {
  search?: string
  from?: string
  to?: string
  limit?: number
}

export type Unsubscribe = () => void

/** Spec for a scripted alert (Demo Mode). Only the mock service supports it. */
export interface DemoAlertSpec {
  type: AlertType
  cameraId: string
  plate?: string
  personId?: string
}

export interface DemoControls {
  available: boolean
  /** Pause / resume the random alert simulator. */
  setAutoSimulation(on: boolean): void
  /** Simulate losing the backend link (mock only), to demonstrate offline queueing. */
  setLinkDown(down: boolean): void
  emit(spec: DemoAlertSpec): Promise<Alert | null>
}

/**
 * The single interface every UI component talks to.
 * Implementations: mock/mockService.ts and api/apiService.ts.
 */
export interface DataService {
  readonly mode: 'mock' | 'api'

  login(username: string, role: Role): Promise<User>

  getCameras(): Promise<Camera[]>
  saveCamera(camera: Partial<Camera> & { name: string }): Promise<Camera>
  testCameraConnection(streamUrl: string): Promise<{ ok: boolean; latencyMs: number; message: string }>
  /** MJPEG URL for <img src>, or null when there is no real stream (mock mode). */
  getStreamUrl(camera: Camera): string | null

  getAlerts(query?: AlertQuery): Promise<Alert[]>
  getAlert(id: string): Promise<Alert>
  /** `at` is only passed for actions queued while offline: the time the operator really acted. */
  updateAlertStatus(id: string, status: AlertStatus, by: string, note?: string, at?: string): Promise<Alert>
  updateAlertNotes(id: string, notes: string): Promise<Alert>
  /** Tick / untick one response-playbook step. Logged in the alert history. */
  setPlaybookStep(id: string, stepId: string, label: string, done: boolean, by: string): Promise<Alert>
  /** Send an SMS / WhatsApp-style message to the Quick Reaction Team. Logged in the alert history. */
  notifyQrt(id: string, channel: 'SMS' | 'WHATSAPP', message: string, by: string): Promise<Alert>

  /** Hashes recorded at capture time, used to verify evidence integrity. */
  getEvidenceRecord(id: string): Promise<EvidenceRecord>
  /** Record that an evidence package was exported (chain of custody). Logged in the alert history. */
  logEvidenceExport(id: string, by: string, packageSha256: string, files: string[]): Promise<Alert>

  getZones(): Promise<Zone[]>
  /** Create (no id) or update. `by` is the acting user's name; every change is written to the zone audit log. */
  saveZone(zone: Omit<Zone, 'id'> & { id?: string }, by: string): Promise<Zone>
  deleteZone(id: string, by: string): Promise<void>
  /** Zone create / edit / delete log, newest first. */
  getZoneAudit(): Promise<ZoneAuditEntry[]>

  getPlateReads(query?: PlateQuery): Promise<PlateRead[]>
  correctPlateRead(id: string, plate: string): Promise<PlateRead>
  getBlacklist(): Promise<BlacklistVehicle[]>
  addBlacklistVehicle(v: Omit<BlacklistVehicle, 'id' | 'addedAt'>): Promise<BlacklistVehicle>
  removeBlacklistVehicle(id: string): Promise<void>

  getWatchlist(): Promise<WatchlistPerson[]>
  addWatchlistPerson(p: Omit<WatchlistPerson, 'id' | 'addedAt'>): Promise<WatchlistPerson>
  removeWatchlistPerson(id: string): Promise<void>
  getFaceMatches(): Promise<FaceMatch[]>
  reviewFaceMatch(id: string, review: ReviewState, by: string): Promise<FaceMatch>

  /** Health of the edge AI nodes at each outpost. */
  getEdgeNodes(): Promise<EdgeNode[]>

  getUsers(): Promise<User[]>
  /** System-wide audit log, newest first. */
  getAuditLog(): Promise<AuditEntry[]>
  logAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  sendTestWebhook(url: string): Promise<{ ok: boolean; message: string }>

  /** Fires for every new alert AND every update to an existing alert (upsert by id). */
  subscribeAlerts(cb: (alert: Alert) => void): Unsubscribe
  subscribeDetections(cameraId: string, cb: (frame: DetectionFrame) => void): Unsubscribe
  subscribePlateReads(cb: (read: PlateRead) => void): Unsubscribe
  subscribeConnection(cb: (state: ConnectionState) => void): Unsubscribe

  demo: DemoControls
}
