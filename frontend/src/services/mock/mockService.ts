import type {
  Alert, AlertStatus, AlertType, AppSettings, BBox, ConnectionState, Detection, DetectionClass,
  DetectionFrame, EvidenceRecord, FaceMatch, PlateRead, Severity, Zone, ZoneAuditEntry,
} from '@/types'
import type { DataService, DemoAlertSpec } from '../types'
import { fetchBytes, sha256Hex } from '@/lib/evidence'
import {
  SUSPICIOUS, VEHICLE_CLASSES, VEHICLE_COLORS, faceSvg, isNightHour, pick, plateSvg, rand, randInt,
  randomPlate, seedAudit, seedBlacklist, seedEdgeNodes, seedCameras, seedUsers, seedWatchlist, seedZones, snapshotSvg, weighted,
} from './data'

// In-memory fake backend + simulator. Emits a new random alert every 5-10 s,
// a plate read every 4-9 s, and detection frames at 10 Hz for subscribed cameras.

const TYPE_WEIGHTS: Record<AlertType, number> = {
  VEHICLE_DETECTED: 26,
  HUMAN_DETECTED: 22,
  NIGHT_MOVEMENT: 12,
  LOITERING: 10,
  SUSPICIOUS_ACTIVITY: 8,
  FENCE_INTRUSION: 7,
  ANPR_MATCH: 6,
  FACE_MATCH: 4,
  CAMERA_OFFLINE: 3,
}
const OPERATORS = ['Ct. S. Meena', 'Ct. P. Gill', 'Insp. A. Rathore']
const VEHICLE_KINDS: DetectionClass[] = ['car', 'truck', 'motorcycle', 'tractor', 'bus']
/** Types the AI engine typically re-reports while the same object stays in view (these collapse into one incident). */
const REPEATABLE: AlertType[] = ['FENCE_INTRUSION', 'HUMAN_DETECTED', 'VEHICLE_DETECTED', 'LOITERING', 'NIGHT_MOVEMENT', 'SUSPICIOUS_ACTIVITY']

interface Track extends Detection {
  vx: number
  vy: number
}

interface BuildOpts {
  /** Reuse an existing track id (repeat alert about the same object). */
  trackId?: number
  plate?: string
  personId?: string
  live?: boolean
}

export function createMockService(): DataService {
  const cameras = seedCameras()
  const zones = seedZones()
  const watchlist = seedWatchlist()
  const blacklist = seedBlacklist()
  const users = seedUsers()
  let settings: AppSettings = {
    confidenceThreshold: 0.5, loiteringSeconds: 30, nightMode: 'auto', webhookUrl: '',
    retention: { clipsDays: 30, snapshotsDays: 90, faceDataDays: 30 },
    blurFacesInExports: true,
    sessionTimeoutMin: 15,
  }
  const evidenceRecords = new Map<string, EvidenceRecord>()

  const alerts: Alert[] = []
  const plateReads: PlateRead[] = []
  const faceMatches: FaceMatch[] = []
  const zoneAudit: ZoneAuditEntry[] = []
  const auditLog = seedAudit()
  const edgeNodes = seedEdgeNodes()
  const connSubs = new Set<(s: ConnectionState) => void>()
  /** Simulated loss of the backend link (Settings > Demo, or the browser going offline). */
  let linkDown = typeof navigator !== 'undefined' && navigator.onLine === false
  const setLink = (down: boolean) => {
    if (down === linkDown) return
    linkDown = down
    connSubs.forEach((cb) => cb(down ? 'offline' : 'online'))
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => setLink(true))
    window.addEventListener('online', () => setLink(false))
  }
  /** Writes fail like a real network error while the link is down. */
  const requireLink = () => {
    if (linkDown) throw new TypeError('Network unreachable (simulated link loss)')
  }

  const alertSubs = new Set<(a: Alert) => void>()
  const plateSubs = new Set<(r: PlateRead) => void>()
  const detSubs = new Map<string, Set<(f: DetectionFrame) => void>>()
  const tracks = new Map<string, Track[]>()

  let seq = 1
  let trackSeq = 100
  let autoSim = true
  let simStarted = false
  let detTimer: ReturnType<typeof setInterval> | null = null

  const clone = <T,>(v: T): T => structuredClone(v)
  const later = <T,>(v: T, ms = 160) => new Promise<T>((r) => setTimeout(() => r(clone(v)), ms))
  const camById = (id: string) => cameras.find((c) => c.id === id)
  const liveCams = () => cameras.filter((c) => c.status !== 'offline')
  const isBlacklisted = (plate: string) => blacklist.some((b) => b.plate === plate)
  const fmtTime = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().replace('T', ' ').slice(0, 19)

  // ---------- detection tracks ----------
  function spawnTrack(cameraId: string, fromEdge: boolean): Track {
    const roadCam = /Check Post|Road|ICP/.test(camById(cameraId)?.name ?? '')
    const isVehicle = Math.random() < (roadCam ? 0.65 : 0.25)
    const dir = Math.random() < 0.5 ? 1 : -1
    const w = isVehicle ? rand(0.14, 0.2) : rand(0.04, 0.055)
    const h = isVehicle ? w * rand(0.9, 1.1) : w * rand(3.6, 4.2)
    return {
      trackId: trackSeq++,
      class: isVehicle ? pick(VEHICLE_KINDS) : Math.random() < 0.06 ? 'animal' : 'person',
      confidence: rand(0.62, 0.97),
      bbox: [fromEdge ? (dir > 0 ? -w : 1) : rand(0.05, 0.8), rand(0.42, 0.7), w, h],
      vx: dir * (isVehicle ? rand(0.005, 0.011) : rand(0.0015, 0.004)),
      vy: rand(-0.0006, 0.0006),
    }
  }

  function stepTracks(cameraId: string) {
    let list = tracks.get(cameraId)
    if (!list) {
      list = Array.from({ length: randInt(1, 3) }, () => spawnTrack(cameraId, false))
      tracks.set(cameraId, list)
    }
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]
      t.bbox[0] += t.vx
      t.bbox[1] = Math.min(0.75, Math.max(0.38, t.bbox[1] + t.vy))
      t.confidence = Math.min(0.99, Math.max(0.5, t.confidence + rand(-0.01, 0.01)))
      if (t.bbox[0] > 1.02 || t.bbox[0] + t.bbox[2] < -0.02) list.splice(i, 1)
    }
    if (list.length < 4 && Math.random() < (list.length === 0 ? 0.08 : 0.015)) list.push(spawnTrack(cameraId, true))
    return list
  }

  function tickDetections() {
    const timestamp = new Date().toISOString()
    detSubs.forEach((subs, cameraId) => {
      if (camById(cameraId)?.status === 'offline') return
      const detections = stepTracks(cameraId).map(({ vx: _vx, vy: _vy, ...d }) => ({ ...d, bbox: [...d.bbox] as BBox }))
      subs.forEach((cb) => cb({ cameraId, timestamp, detections }))
    })
  }

  // ---------- builders ----------
  function addPlateRead(cameraId: string, plate: string, ts: Date, lowConf = false): PlateRead {
    const read: PlateRead = {
      id: `pr-${seq++}`,
      timestamp: ts.toISOString(),
      cameraId,
      plate,
      vehicleClass: pick(VEHICLE_CLASSES),
      color: Math.random() < 0.85 ? pick(VEHICLE_COLORS) : null,
      confidence: lowConf ? rand(0.42, 0.68) : rand(0.78, 0.99),
      cropUrl: plateSvg(plate),
      blacklisted: isBlacklisted(plate),
      needsVerification: lowConf,
    }
    plateReads.unshift(read)
    return read
  }

  function buildAlert(type: AlertType, cameraId: string, ts: Date, opts: BuildOpts = {}): Alert {
    const camera = camById(cameraId)!
    const night = isNightHour(ts) || camera.isNightMode
    // Fence / loitering alerts always reference a real, active zone from the zone list.
    const camZones = zones.filter((z) => z.cameraId === cameraId && z.active)
    const zone = camZones.length ? pick(camZones) : undefined
    const isVehicleType = type === 'VEHICLE_DETECTED' || type === 'ANPR_MATCH'
    const kind = type === 'CAMERA_OFFLINE' ? 'none' : isVehicleType ? 'vehicle' : 'person'

    let bbox: BBox | undefined
    let trackId: number | null = null
    if (kind !== 'none') {
      const live = opts.live
        ? tracks.get(cameraId)?.find((t) => (kind === 'vehicle' ? VEHICLE_KINDS.includes(t.class) : t.class === 'person') && t.bbox[0] > 0 && t.bbox[0] + t.bbox[2] < 1)
        : undefined
      if (live) {
        bbox = [...live.bbox] as BBox
        trackId = live.trackId
      } else {
        const w = kind === 'vehicle' ? rand(0.16, 0.24) : rand(0.05, 0.07)
        bbox = [rand(0.1, 0.7), rand(0.4, 0.6), w, kind === 'vehicle' ? w * 1.0 : w * 3.8]
        trackId = trackSeq++
      }
    }

    if (opts.trackId !== undefined && kind !== 'none') trackId = opts.trackId

    const liveClass = trackId !== null ? tracks.get(cameraId)?.find((t) => t.trackId === trackId)?.class : undefined

    let severity: Severity = 'LOW'
    let confidence = rand(0.6, 0.97)
    const details: Alert['details'] = {}

    switch (type) {
      case 'FENCE_INTRUSION':
        severity = zone?.severity ?? 'CRITICAL'
        confidence = rand(0.82, 0.98)
        Object.assign(details, {
          zoneId: zone?.id, zoneName: zone?.name ?? 'Fence Line', objectCount: randInt(1, 3),
          description: zone?.type === 'polygon' ? 'Person entered restricted zone' : 'Person crossed virtual fence line',
        })
        break
      case 'HUMAN_DETECTED':
        severity = night ? 'MEDIUM' : 'LOW'
        Object.assign(details, { objectCount: randInt(1, 4), description: 'Person detected in camera view' })
        break
      case 'VEHICLE_DETECTED':
        Object.assign(details, {
          vehicleClass: pick(VEHICLE_CLASSES), vehicleColor: pick(VEHICLE_COLORS),
          plateNumber: Math.random() < 0.6 ? randomPlate() : undefined,
        })
        break
      case 'ANPR_MATCH': {
        const entry = blacklist.find((b) => b.plate === opts.plate) ?? pick(blacklist)
        severity = entry.priority === 'HIGH' ? 'CRITICAL' : 'HIGH'
        confidence = rand(0.85, 0.99)
        Object.assign(details, {
          plateNumber: entry.plate, vehicleClass: pick(VEHICLE_CLASSES), vehicleColor: pick(VEHICLE_COLORS),
          blacklistReason: entry.reason, description: entry.notes,
        })
        break
      }
      case 'FACE_MATCH': {
        const candidates = watchlist.filter((p) => p.category !== 'AUTHORISED')
        const person = watchlist.find((p) => p.id === opts.personId) ?? pick(candidates)
        const similarity = rand(0.71, 0.96)
        severity = person.riskLevel === 'HIGH' ? 'CRITICAL' : 'HIGH'
        confidence = similarity
        Object.assign(details, {
          matchedPersonId: person.id, matchedPersonName: person.name, similarity,
          faceCropUrl: faceSvg(Number(person.id.slice(-2)), true),
        })
        break
      }
      case 'LOITERING':
        severity = 'MEDIUM'
        Object.assign(details, {
          zoneId: zone?.id, zoneName: zone?.name ?? 'Camera view',
          dwellTimeSec: randInt(settings.loiteringSeconds, settings.loiteringSeconds + 240),
        })
        break
      case 'NIGHT_MOVEMENT': {
        const count = randInt(1, 4)
        severity = count > 2 ? 'HIGH' : 'MEDIUM'
        Object.assign(details, { objectCount: count, description: 'Movement detected in low-light / IR mode' })
        break
      }
      case 'SUSPICIOUS_ACTIVITY':
        severity = Math.random() < 0.5 ? 'HIGH' : 'MEDIUM'
        Object.assign(details, { description: pick(SUSPICIOUS), zoneName: zone?.name })
        break
      case 'CAMERA_OFFLINE':
        severity = 'MEDIUM'
        confidence = 1
        Object.assign(details, { description: 'No frames received for 60 s (link degraded)' })
        break
    }

    const alert: Alert = {
      id: `ALT-${String(seq++).padStart(5, '0')}`,
      timestamp: ts.toISOString(),
      cameraId,
      type,
      severity,
      status: 'NEW',
      confidence,
      snapshotUrl: snapshotSvg({ night, kind, bbox, camName: camera.name, time: fmtTime(ts) }),
      trackId,
      bbox,
      confirmFrames: kind === 'none' ? undefined : randInt(camera.minConfirmFrames, camera.minConfirmFrames + 14),
      visibility: camera.visibility === 'clear' && isNightHour(ts) ? 'low-light' : camera.visibility,
      details,
      assignedTo: null,
      notes: '',
      history: [{ status: 'NEW', at: ts.toISOString(), by: 'AI Engine' }],
    }

    if (kind !== 'none') details.objectClass = kind === 'person' ? 'person' : (details.vehicleClass?.toLowerCase() ?? liveClass ?? 'vehicle')

    if (type === 'FACE_MATCH') {
      faceMatches.unshift({
        id: `fm-${seq++}`,
        timestamp: alert.timestamp,
        cameraId,
        personId: details.matchedPersonId!,
        similarity: details.similarity!,
        capturedUrl: details.faceCropUrl!,
        alertId: alert.id,
        review: 'PENDING',
      })
    }
    return alert
  }

  /** Give a seeded (historical) alert a believable workflow history. */
  function ageAlert(a: Alert) {
    const ageMin = (Date.now() - Date.parse(a.timestamp)) / 60_000
    const by = pick(OPERATORS)
    const serious = a.severity === 'CRITICAL' || a.severity === 'HIGH'
    const outcome: AlertStatus =
      ageMin > 120
        ? weighted({ RESOLVED: 64, FALSE_ALARM: 14, ACKNOWLEDGED: 22 } as Record<AlertStatus, number>)
        : ageMin > 15 || serious
          ? weighted({ ACKNOWLEDGED: 60, RESOLVED: 24, ESCALATED: 4, FALSE_ALARM: 7, NEW: serious ? 0 : 5 } as Record<AlertStatus, number>)
          : weighted({ NEW: 45, ACKNOWLEDGED: 55 } as Record<AlertStatus, number>)
    if (outcome === 'NEW') return
    const t0 = Date.parse(a.timestamp)
    const ackAt = t0 + (serious ? rand(8, 70) : rand(25, 260)) * 1000
    a.history.push({ status: 'ACKNOWLEDGED', at: new Date(ackAt).toISOString(), by })
    if (outcome !== 'ACKNOWLEDGED') {
      a.history.push({ status: outcome, at: new Date(ackAt + rand(60, 1500) * 1000).toISOString(), by: outcome === 'RESOLVED' ? 'Insp. A. Rathore' : by })
    }
    a.status = outcome
    a.assignedTo = by
    const fm = faceMatches.find((f) => f.alertId === a.id)
    if (fm && ageMin > 600) {
      fm.review = outcome === 'FALSE_ALARM' ? 'REJECTED' : 'CONFIRMED'
      fm.reviewedBy = by
    }
  }

  function randomType(ts: Date): AlertType {
    const t = weighted(TYPE_WEIGHTS)
    return t === 'NIGHT_MOVEMENT' && !isNightHour(ts) ? 'HUMAN_DETECTED' : t
  }

  function camForType(type: AlertType) {
    const pool = liveCams().filter((c) =>
      type === 'FENCE_INTRUSION' ? c.modules.fence && zones.some((z) => z.cameraId === c.id && z.active)
        : type === 'ANPR_MATCH' ? c.modules.anpr
          : type === 'FACE_MATCH' ? c.modules.face
            : true,
    )
    return pick(pool.length ? pool : liveCams()).id
  }

  // ---------- seed history (14 days) ----------
  function seed() {
    const now = Date.now()
    const stamps: Date[] = []
    for (let i = 0; i < 430; i++) stamps.push(new Date(now - rand(1, 14) * 86_400_000))
    for (let i = 0; i < 70; i++) stamps.push(new Date(now - rand(1, 24) * 3_600_000))
    for (let i = 0; i < 14; i++) stamps.push(new Date(now - rand(1, 60) * 60_000))
    stamps.sort((a, b) => a.getTime() - b.getTime())
    for (const ts of stamps) {
      let type = randomType(ts)
      // Intrusions cluster at night: push most of the old ones into 22:00-05:00.
      if (type === 'FENCE_INTRUSION' && now - ts.getTime() > 86_400_000 && Math.random() < 0.75) {
        ts.setHours(pick([22, 23, 0, 1, 1, 2, 2, 2, 3, 3, 4, 5]), randInt(0, 59))
      }
      if (type === 'CAMERA_OFFLINE' && Math.random() < 0.5) type = 'VEHICLE_DETECTED'
      const cameraId = camForType(type)
      if (type === 'ANPR_MATCH') addPlateRead(cameraId, pick(blacklist).plate, ts)
      const a = buildAlert(type, cameraId, ts, type === 'ANPR_MATCH' ? { plate: plateReads[0].plate } : {})
      ageAlert(a)
      alerts.push(a)
      // Follow-up alerts about the same track, so history contains multi-alert incidents.
      if (REPEATABLE.includes(type) && Math.random() < 0.25) {
        for (let k = 1, n = randInt(1, 3); k <= n; k++) {
          const ts2 = new Date(ts.getTime() + k * rand(15, 45) * 1000)
          if (ts2.getTime() > now) break
          const b = buildAlert(type, cameraId, ts2, { trackId: a.trackId ?? undefined })
          b.status = a.status
          b.assignedTo = a.assignedTo
          b.history = [b.history[0], ...a.history.slice(1)]
          alerts.push(b)
        }
      }
    }
    alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

    const pool = Array.from({ length: 28 }, randomPlate)
    const anprCams = cameras.filter((c) => c.modules.anpr && c.status !== 'offline')
    for (let i = 0; i < 140; i++) {
      addPlateRead(pick(anprCams).id, pick(pool), new Date(now - rand(0.02, 72) * 3_600_000), Math.random() < 0.1)
    }
    plateReads.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  }
  seed()

  // ---------- live simulator ----------
  function emit(alert: Alert) {
    if (!alerts.includes(alert)) alerts.unshift(alert)
    const copy = clone(alert)
    alertSubs.forEach((cb) => cb(copy))
  }

  function emitPlateRead(cameraId: string, plate: string, lowConf = false) {
    const read = addPlateRead(cameraId, plate, new Date(), lowConf)
    const copy = clone(read)
    plateSubs.forEach((cb) => cb(copy))
    // Business rule: a read matching the blacklist always raises an ANPR_MATCH alert.
    if (read.blacklisted) emit(buildAlert('ANPR_MATCH', cameraId, new Date(), { plate, live: true }))
    return read
  }

  let lastSim: Alert | null = null
  function simulateOnce() {
    const now = new Date()
    // ~30% of the time the same object is reported again: the UI groups these into one incident.
    if (lastSim && REPEATABLE.includes(lastSim.type) && now.getTime() - Date.parse(lastSim.timestamp) < 60_000 && Math.random() < 0.3) {
      lastSim = buildAlert(lastSim.type, lastSim.cameraId, now, { live: true, trackId: lastSim.trackId ?? undefined })
      emit(lastSim)
      return
    }
    const type = randomType(now)
    const cameraId = camForType(type)
    if (type === 'ANPR_MATCH') emitPlateRead(cameraId, pick(blacklist).plate)
    else emit(buildAlert(type, cameraId, now, { live: true }))
    lastSim = alerts[0]
  }

  function startSimulator() {
    if (simStarted) return
    simStarted = true
    const alertLoop = () => {
      if (autoSim && !linkDown) simulateOnce()
      setTimeout(alertLoop, rand(5000, 10000))
    }
    const plateLoop = () => {
      if (autoSim && !linkDown) {
        const anprCams = liveCams().filter((c) => c.modules.anpr)
        if (anprCams.length) emitPlateRead(pick(anprCams).id, randomPlate(), Math.random() < 0.12)
      }
      setTimeout(plateLoop, rand(4000, 9000))
    }
    setTimeout(alertLoop, 4000)
    setTimeout(plateLoop, 2500)
  }

  const ZONE_FIELDS = ['name', 'type', 'points', 'active', 'schedule', 'severity', 'classes', 'minDwellSec', 'direction'] as const
  function logZone(action: ZoneAuditEntry['action'], z: Zone, by: string, changes: string) {
    zoneAudit.unshift({ id: `za-${seq++}`, at: new Date().toISOString(), by, action, zoneId: z.id, zoneName: z.name, cameraId: z.cameraId, changes })
  }
  const describe = (v: unknown) => (Array.isArray(v) ? v.join('+') || 'none' : String(v))

  const findAlert = (id: string) => {
    const a = alerts.find((x) => x.id === id)
    if (!a) throw new Error(`Alert ${id} not found`)
    return a
  }

  return {
    mode: 'mock',

    login(username, role) {
      const known = users.find((u) => u.role === role && (!username.trim() || u.name === username.trim()))
      if (known) known.lastLogin = new Date().toISOString()
      return later({ id: known?.id ?? 'u-session', name: username.trim() || role, username: known?.username ?? role.toLowerCase(), role, active: true, lastLogin: new Date().toISOString() }, 350)
    },

    getCameras: () => later(cameras),
    saveCamera(input) {
      const existing = input.id ? camById(input.id) : undefined
      if (existing) {
        Object.assign(existing, input)
        return later(existing)
      }
      const created = {
        id: `cam-${String(cameras.length + 1).padStart(2, '0')}`,
        locationName: '', lat: 27.5, lng: 70.5, streamUrl: '', status: 'online' as const, fps: 25,
        isNightMode: isNightHour(new Date()), lastSeen: new Date().toISOString(),
        visibility: 'clear' as const, sensitivity: 0.5, minConfirmFrames: 5, ignoreAnimals: true,
        modules: { human: true, vehicle: true, anpr: true, face: true, fence: true },
        ...input,
      }
      cameras.push(created)
      return later(created)
    },
    testCameraConnection(streamUrl) {
      const ok = /^(rtsp|http|https):\/\/.+/.test(streamUrl.trim())
      return later(
        { ok, latencyMs: ok ? randInt(40, 180) : 0, message: ok ? 'Stream reachable, H.264 1920x1080 @ 25 fps' : 'Invalid URL: expected rtsp:// or http(s)://' },
        900,
      )
    },
    getStreamUrl: () => null,

    getAlerts(q = {}) {
      let list = alerts.filter(
        (a) => (!q.from || a.timestamp >= q.from) && (!q.to || a.timestamp <= q.to) && (!q.cameraId || a.cameraId === q.cameraId),
      )
      if (q.limit) list = list.slice(0, q.limit)
      return later(list, 450)
    },
    getAlert: async (id) => later(findAlert(id)),
    async updateAlertStatus(id, status, by, note, at) {
      requireLink()
      const a = findAlert(id)
      a.status = status
      a.history.push({ status, at: at ?? new Date().toISOString(), by, note })
      if (!a.assignedTo || status === 'ESCALATED') a.assignedTo = status === 'ESCALATED' ? 'Insp. A. Rathore' : by
      emit(a)
      return later(a, 60)
    },
    async updateAlertNotes(id, notes) {
      requireLink()
      const a = findAlert(id)
      a.notes = notes
      emit(a)
      return later(a, 60)
    },

    async setPlaybookStep(id, stepId, label, done, by) {
      requireLink()
      const a = findAlert(id)
      const set = new Set(a.playbookDone ?? [])
      if (done) set.add(stepId)
      else set.delete(stepId)
      a.playbookDone = [...set]
      a.history.push({ kind: 'playbook', status: a.status, at: new Date().toISOString(), by, note: `${done ? 'Done' : 'Undone'}: ${label}` })
      emit(a)
      return later(a, 60)
    },
    async notifyQrt(id, channel, message, by) {
      requireLink()
      const a = findAlert(id)
      a.qrtNotifiedAt = new Date().toISOString()
      a.history.push({ kind: 'notify', status: a.status, at: a.qrtNotifiedAt, by, note: `QRT notified via ${channel === 'SMS' ? 'SMS' : 'WhatsApp'}: ${message}` })
      emit(a)
      return later(a, 700)
    },

    async getEvidenceRecord(id) {
      const a = findAlert(id)
      let rec = evidenceRecords.get(id)
      if (!rec) {
        // A real backend stores this hash when the snapshot is written. The mock derives it once on first request.
        rec = { alertId: id, algorithm: 'SHA-256', snapshotSha256: await sha256Hex((await fetchBytes(a.snapshotUrl)).bytes), recordedAt: a.timestamp }
        evidenceRecords.set(id, rec)
      }
      return later(rec, 60)
    },
    async logEvidenceExport(id, by, packageSha256, files) {
      const a = findAlert(id)
      a.history.push({ kind: 'evidence', status: a.status, at: new Date().toISOString(), by, note: `Evidence exported (${files.length} files, package SHA-256 ${packageSha256.slice(0, 16)}...)` })
      emit(a)
      return later(a, 60)
    },

    getZones: () => later(zones),
    saveZone(z, by) {
      const existing = z.id ? zones.find((x) => x.id === z.id) : undefined
      if (existing) {
        const changes = ZONE_FIELDS.filter((k) => JSON.stringify(existing[k]) !== JSON.stringify(z[k])).map((k) =>
          k === 'points' ? 'shape edited' : `${k}: ${describe(existing[k])} -> ${describe(z[k])}`,
        )
        Object.assign(existing, clone(z))
        if (changes.length) logZone('UPDATE', existing, by, changes.join('; '))
        return later(existing)
      }
      const created: Zone = { ...clone(z), id: `zone-${seq++}` }
      zones.push(created)
      logZone('CREATE', created, by, `${created.type} with ${created.points.length} points, severity ${created.severity}`)
      return later(created)
    },
    deleteZone(id, by) {
      const i = zones.findIndex((z) => z.id === id)
      if (i >= 0) logZone('DELETE', zones.splice(i, 1)[0], by, 'zone removed')
      return later(undefined)
    },
    getZoneAudit: () => later(zoneAudit),

    getPlateReads(q = {}) {
      const s = q.search?.replace(/\s/g, '').toUpperCase()
      let list = plateReads.filter(
        (r) => (!s || r.plate.includes(s)) && (!q.from || r.timestamp >= q.from) && (!q.to || r.timestamp <= q.to),
      )
      if (q.limit) list = list.slice(0, q.limit)
      return later(list, 350)
    },
    async correctPlateRead(id, plate) {
      const r = plateReads.find((x) => x.id === id)
      if (!r) throw new Error('Plate read not found')
      const wasBlacklisted = r.blacklisted
      r.correctedFrom = r.correctedFrom ?? r.plate
      r.plate = plate.replace(/\s/g, '').toUpperCase()
      r.cropUrl = plateSvg(r.plate)
      r.needsVerification = false
      r.blacklisted = isBlacklisted(r.plate)
      if (r.blacklisted && !wasBlacklisted) emit(buildAlert('ANPR_MATCH', r.cameraId, new Date(), { plate: r.plate, live: true }))
      return later(r, 80)
    },
    getBlacklist: () => later(blacklist),
    addBlacklistVehicle(v) {
      const created = { ...v, plate: v.plate.replace(/\s/g, '').toUpperCase(), id: `bl-${seq++}`, addedAt: new Date().toISOString() }
      blacklist.unshift(created)
      plateReads.forEach((r) => (r.blacklisted = isBlacklisted(r.plate)))
      return later(created)
    },
    removeBlacklistVehicle(id) {
      const i = blacklist.findIndex((b) => b.id === id)
      if (i >= 0) blacklist.splice(i, 1)
      plateReads.forEach((r) => (r.blacklisted = isBlacklisted(r.plate)))
      return later(undefined)
    },

    getWatchlist: () => later(watchlist, 350),
    addWatchlistPerson(p) {
      const created = { ...p, id: `wp-${seq++}`, addedAt: new Date().toISOString() }
      watchlist.unshift(created)
      return later(created)
    },
    removeWatchlistPerson(id) {
      const i = watchlist.findIndex((p) => p.id === id)
      if (i >= 0) watchlist.splice(i, 1)
      return later(undefined)
    },
    getFaceMatches: () => later(faceMatches, 350),
    async reviewFaceMatch(id, review, by) {
      const m = faceMatches.find((x) => x.id === id)
      if (!m) throw new Error('Face match not found')
      m.review = review
      m.reviewedBy = by
      return later(m, 80)
    },

    getEdgeNodes() {
      // Small random drift so the page looks live.
      for (const n of edgeNodes) {
        if (n.status === 'offline') continue
        const drift = (v: number, by: number, min: number, max: number) => Math.min(max, Math.max(min, v + rand(-by, by)))
        n.cpuPct = drift(n.cpuPct, 3, 5, 99)
        n.gpuPct = drift(n.gpuPct, 3, 5, 99)
        n.ramPct = drift(n.ramPct, 1, 10, 97)
        n.tempC = drift(n.tempC, 0.8, 40, 92)
        n.processingFps = drift(n.processingFps, 0.5, 5, 25)
        n.latencyMs = drift(n.latencyMs, 8, 20, 600)
        n.bandwidthMbps = drift(n.bandwidthMbps, 0.2, 0.2, 8)
        n.uptimeSec += 5
        n.lastHeartbeat = new Date().toISOString()
      }
      return later(edgeNodes, 200)
    },
    getUsers: () => later(users),
    getAuditLog: () => later(auditLog),
    logAudit(entry) {
      auditLog.unshift({ ...entry, id: `au-${seq++}`, at: new Date().toISOString() })
      return later(undefined, 10)
    },
    getSettings: () => later(settings),
    saveSettings(s) {
      settings = clone(s)
      return later(settings)
    },
    sendTestWebhook(url) {
      let ok = false
      try {
        ok = /^https?:$/.test(new URL(url).protocol)
      } catch {
        /* invalid URL */
      }
      return later({ ok, message: ok ? 'Mock mode: test event simulated, 200 OK (nothing was actually sent)' : 'Invalid webhook URL' }, 700)
    },

    subscribeAlerts(cb) {
      alertSubs.add(cb)
      startSimulator()
      return () => alertSubs.delete(cb)
    },
    subscribePlateReads(cb) {
      plateSubs.add(cb)
      startSimulator()
      return () => plateSubs.delete(cb)
    },
    subscribeDetections(cameraId, cb) {
      let set = detSubs.get(cameraId)
      if (!set) detSubs.set(cameraId, (set = new Set()))
      set.add(cb)
      detTimer ??= setInterval(tickDetections, 100)
      const subs = set
      return () => {
        subs.delete(cb)
        if (subs.size === 0) detSubs.delete(cameraId)
        if (detSubs.size === 0 && detTimer) {
          clearInterval(detTimer)
          detTimer = null
        }
      }
    },
    subscribeConnection(cb: (s: ConnectionState) => void) {
      connSubs.add(cb)
      cb(linkDown ? 'offline' : 'online')
      return () => connSubs.delete(cb)
    },

    demo: {
      available: true,
      setAutoSimulation(on) {
        autoSim = on
      },
      setLinkDown: setLink,
      async emit(spec: DemoAlertSpec) {
        if (spec.type === 'ANPR_MATCH') {
          emitPlateRead(spec.cameraId, spec.plate ?? blacklist[0].plate)
          return clone(alerts[0])
        }
        if (spec.type === 'VEHICLE_DETECTED' && spec.plate) emitPlateRead(spec.cameraId, spec.plate)
        const a = buildAlert(spec.type, spec.cameraId, new Date(), { ...spec, live: true })
        if (spec.type === 'VEHICLE_DETECTED' && spec.plate) a.details.plateNumber = spec.plate
        emit(a)
        return clone(a)
      },
    },
  }
}
