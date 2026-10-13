import type {
  AuditCategory, AuditEntry, BBox, BlacklistVehicle, Camera, DetectionModules, EdgeNode, Role, User, WatchlistPerson, Zone,
} from '@/types'

// ---------- random helpers ----------
export const rand = (min: number, max: number) => min + Math.random() * (max - min)
export const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1))
export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]
export function weighted<T extends string>(table: Record<T, number>): T {
  const entries = Object.entries(table) as [T, number][]
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [k, w] of entries) {
    r -= w
    if (r <= 0) return k
  }
  return entries[0][0]
}
export const isNightHour = (d: Date) => d.getHours() >= 19 || d.getHours() < 6

// ---------- generated imagery (SVG data URLs, fully offline) ----------
const svgUrl = (w: number, h: number, body: string) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}'>${body}</svg>`)

export function snapshotSvg(o: {
  night: boolean
  kind: 'person' | 'vehicle' | 'none'
  bbox?: BBox
  camName: string
  time: string
}) {
  const W = 320
  const H = 180
  const sky = o.night ? ['#04130c', '#0a2416'] : ['#1b2b45', '#31466a']
  const ground = o.night ? '#0b2a18' : '#3a3a2c'
  const fig = o.night ? '#c8ffd9' : '#11161f'
  let body = `<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${sky[0]}'/><stop offset='1' stop-color='${sky[1]}'/></linearGradient></defs>
<rect width='${W}' height='${H}' fill='url(#s)'/><rect y='84' width='${W}' height='96' fill='${ground}'/>
<path d='M0 84H${W}M0 74H${W}' stroke='${o.night ? '#1f5a37' : '#6b7280'}' stroke-width='1'/>`
  for (let x = 10; x < W; x += 34) body += `<path d='M${x} 66V92' stroke='${o.night ? '#2c7a4b' : '#9ca3af'}' stroke-width='2'/>`
  if (o.bbox && o.kind !== 'none') {
    const [x, y, w, h] = [o.bbox[0] * W, o.bbox[1] * H, o.bbox[2] * W, o.bbox[3] * H]
    if (o.kind === 'person') {
      body += `<circle cx='${x + w / 2}' cy='${y + h * 0.12}' r='${Math.min(w, h) * 0.3}' fill='${fig}'/>
<rect x='${x + w * 0.2}' y='${y + h * 0.24}' width='${w * 0.6}' height='${h * 0.76}' rx='${w * 0.2}' fill='${fig}'/>`
    } else {
      body += `<rect x='${x}' y='${y + h * 0.25}' width='${w}' height='${h * 0.55}' rx='4' fill='${fig}'/>
<rect x='${x + w * 0.18}' y='${y}' width='${w * 0.55}' height='${h * 0.4}' rx='4' fill='${fig}'/>
<circle cx='${x + w * 0.22}' cy='${y + h * 0.82}' r='${h * 0.17}' fill='#000'/><circle cx='${x + w * 0.78}' cy='${y + h * 0.82}' r='${h * 0.17}' fill='#000'/>`
    }
    body += `<rect x='${x - 3}' y='${y - 3}' width='${w + 6}' height='${h + 6}' fill='none' stroke='#ef4444' stroke-width='1.5'/>`
  }
  body += `<text x='6' y='12' font-family='monospace' font-size='8' fill='#e5e7eb'>${o.camName.replace(/[<&']/g, '')}</text>
<text x='6' y='174' font-family='monospace' font-size='8' fill='#e5e7eb'>${o.time}</text>`
  return svgUrl(W, H, body)
}

export function faceSvg(seed: number, captured = false) {
  const hue = (seed * 67) % 360
  const bg = captured ? '#1f2937' : `hsl(${hue} 30% 26%)`
  const skin = captured ? '#9ca3af' : `hsl(${(seed * 13) % 40 + 15} 40% ${52 + (seed % 3) * 6}%)`
  const hair = captured ? '#374151' : '#1c1917'
  const dx = captured ? 4 : 0
  return svgUrl(
    120,
    150,
    `<rect width='120' height='150' fill='${bg}'/>
<ellipse cx='${60 + dx}' cy='150' rx='48' ry='42' fill='${captured ? '#4b5563' : `hsl(${hue} 25% 38%)`}'/>
<ellipse cx='${60 + dx}' cy='66' rx='${26 + (seed % 3) * 2}' ry='33' fill='${skin}'/>
<path d='M${32 + dx} 60 Q${60 + dx} ${14 + (seed % 4) * 4} ${88 + dx} 60 Q${60 + dx} ${38 + (seed % 5) * 2} ${32 + dx} 60Z' fill='${hair}'/>
${seed % 2 ? `<path d='M${44 + dx} 86 Q${60 + dx} ${100} ${76 + dx} 86 Q${60 + dx} 94 ${44 + dx} 86Z' fill='${hair}'/>` : ''}
<circle cx='${50 + dx}' cy='66' r='2.5' fill='#111'/><circle cx='${70 + dx}' cy='66' r='2.5' fill='#111'/>
${captured ? `<rect width='120' height='150' fill='none' stroke='#22d3ee' stroke-width='3'/>` : ''}`,
  )
}

export function plateSvg(plate: string) {
  return svgUrl(
    200,
    50,
    `<rect width='200' height='50' rx='5' fill='#f8fafc' stroke='#111' stroke-width='2'/>
<rect x='2' y='2' width='20' height='46' rx='3' fill='#1d4ed8'/><text x='12' y='42' font-size='7' fill='#fff' text-anchor='middle' font-family='sans-serif'>IND</text>
<text x='110' y='34' font-family='monospace' font-weight='bold' font-size='24' fill='#111' text-anchor='middle'>${plate}</text>`,
  )
}

// ---------- plates ----------
const RTO: Record<string, string[]> = {
  RJ: ['14', '15', '19', '04', '21', '13'],
  PB: ['02', '05', '08', '10', '46'],
  JK: ['01', '02', '08'],
  GJ: ['01', '08', '12', '24'],
}
const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'
export function randomPlate() {
  const state = weighted({ RJ: 50, PB: 25, GJ: 15, JK: 10 })
  return `${state}${pick(RTO[state])}${pick([...LETTERS])}${pick([...LETTERS])}${randInt(1000, 9999)}`
}
export const VEHICLE_CLASSES = ['Car', 'Truck', 'Motorcycle', 'Tractor', 'Bus', 'Pickup', 'SUV'] as const
export const VEHICLE_COLORS = ['White', 'Silver', 'Black', 'Blue', 'Red', 'Grey', 'Brown'] as const

// ---------- seed entities ----------
const ALL: DetectionModules = { human: true, vehicle: true, anpr: true, face: true, fence: true }
const cam = (
  id: string, name: string, locationName: string, lat: number, lng: number, streamUrl: string,
  extra: Partial<Camera> = {},
): Camera => ({
  id, name, locationName, lat, lng, streamUrl,
  status: 'online',
  fps: randInt(22, 25),
  isNightMode: isNightHour(new Date()),
  lastSeen: new Date().toISOString(),
  modules: ALL,
  visibility: isNightHour(new Date()) ? 'low-light' : 'clear',
  sensitivity: 0.5,
  minConfirmFrames: 5,
  ignoreAnimals: true,
  ...extra,
})

export const seedCameras = (): Camera[] => [
  cam('cam-01', 'BOP Sundar - Gate Cam', 'BOP Sundar, Jaisalmer Sector (RJ)', 27.7904, 70.3521, 'rtsp://10.21.4.11:554/stream1'),
  cam('cam-02', 'BOP Sundar - Fence East', 'BOP Sundar, Jaisalmer Sector (RJ)', 27.7962, 70.3618, 'rtsp://10.21.4.12:554/stream1', {
    isNightMode: true,
    visibility: 'low-light',
    sensitivity: 0.7,
    modules: { ...ALL, anpr: false },
  }),
  cam('cam-03', 'Check Post Munabao', 'Munabao, Barmer (RJ)', 25.7453, 70.2771, 'rtsp://10.22.1.20:554/h264'),
  cam('cam-04', 'Border Road KM 42', 'Jaisalmer-Tanot Road (RJ)', 27.4215, 70.5183, 'rtsp://10.21.9.42:554/stream1', {
    modules: { ...ALL, face: false, fence: false },
    visibility: 'dust',
  }),
  cam('cam-05', 'BOP Kishangarh - Watch Tower', 'Kishangarh, Jaisalmer (RJ)', 27.8721, 70.5634, 'rtsp://10.21.7.5:554/stream2', {
    status: 'degraded', fps: 9, isNightMode: true, visibility: 'fog', minConfirmFrames: 8, modules: { ...ALL, anpr: false, face: false },
  }),
  cam('cam-06', 'Check Post Hussainiwala', 'Hussainiwala, Ferozepur (PB)', 30.9981, 74.5472, 'rtsp://10.31.2.8:554/stream1'),
  cam('cam-07', 'ICP Attari - Lane 2', 'Attari, Amritsar (PB)', 31.6042, 74.5731, 'http://10.32.1.15:8080/video', {
    modules: { ...ALL, fence: false },
  }),
  cam('cam-08', 'BOP Hindumalkot - Fence North', 'Hindumalkot, Sri Ganganagar (RJ)', 30.1152, 73.9305, 'rtsp://10.23.3.3:554/stream1', {
    status: 'offline', fps: 0, lastSeen: new Date(Date.now() - 47 * 60_000).toISOString(),
  }),
]

const zone = (z: Pick<Zone, 'id' | 'cameraId' | 'name' | 'type' | 'points'> & Partial<Zone>): Zone => ({
  active: true,
  schedule: 'always',
  severity: z.type === 'line' ? 'CRITICAL' : 'HIGH',
  classes: ['person', 'vehicle'],
  minDwellSec: z.type === 'line' ? 0 : 5,
  direction: 'both',
  ...z,
})

export const seedZones = (): Zone[] => [
  zone({ id: 'zone-01', cameraId: 'cam-01', name: 'BOP Gate Entry', type: 'polygon', points: [[0.05, 0.62], [0.42, 0.52], [0.5, 0.95], [0.03, 0.95]], minDwellSec: 10 }),
  zone({ id: 'zone-02', cameraId: 'cam-02', name: 'Fence Line East', type: 'line', points: [[0.02, 0.48], [0.98, 0.4]], direction: 'forward', classes: ['person'] }),
  zone({ id: 'zone-03', cameraId: 'cam-02', name: 'No-Man Strip', type: 'polygon', points: [[0.55, 0.42], [0.98, 0.4], [0.98, 0.7], [0.6, 0.74]], schedule: 'night-only', severity: 'CRITICAL' }),
  zone({ id: 'zone-04', cameraId: 'cam-03', name: 'Check Post Barrier', type: 'line', points: [[0.3, 0.9], [0.72, 0.5]], severity: 'HIGH', classes: ['vehicle'] }),
  zone({ id: 'zone-05', cameraId: 'cam-05', name: 'Tower Perimeter', type: 'polygon', points: [[0.2, 0.5], [0.8, 0.5], [0.92, 0.92], [0.08, 0.92]], schedule: 'night-only', minDwellSec: 15 }),
  zone({ id: 'zone-06', cameraId: 'cam-06', name: 'Riverbed Crossing', type: 'polygon', points: [[0.5, 0.45], [0.95, 0.45], [0.95, 0.9], [0.55, 0.9]], severity: 'CRITICAL', classes: ['person'] }),
  zone({ id: 'zone-07', cameraId: 'cam-08', name: 'Fence Line North', type: 'line', points: [[0.05, 0.55], [0.95, 0.5]], direction: 'forward' }),
]

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

export const seedWatchlist = (): WatchlistPerson[] => [
  { id: 'wp-01', name: "Subject W-014 (alias 'Kaalu')", category: 'WANTED', riskLevel: 'HIGH', photos: [faceSvg(1), faceSvg(11)], notes: 'Wanted in cross-border narcotics case, FIR 112/2025.', addedAt: daysAgo(64) },
  { id: 'wp-02', name: "Subject S-027 (alias 'Bhura')", category: 'SUSPECT', riskLevel: 'MEDIUM', photos: [faceSvg(2)], notes: 'Suspected cattle smuggling courier.', addedAt: daysAgo(31) },
  { id: 'wp-03', name: 'Missing M-003 - Ramesh Kumar', category: 'MISSING', riskLevel: 'LOW', photos: [faceSvg(3)], notes: 'Reported missing from Ramgarh village.', addedAt: daysAgo(12) },
  { id: 'wp-04', name: 'Staff A-112 - Ct. Vikram Singh', category: 'AUTHORISED', riskLevel: 'LOW', photos: [faceSvg(4)], notes: 'Authorised BOP staff.', addedAt: daysAgo(120) },
  { id: 'wp-05', name: "Subject W-031 (alias 'Langda')", category: 'WANTED', riskLevel: 'HIGH', photos: [faceSvg(5), faceSvg(15), faceSvg(25)], notes: 'Wanted for fence-breach facilitation.', addedAt: daysAgo(8) },
  { id: 'wp-06', name: 'Subject S-040 (unidentified)', category: 'SUSPECT', riskLevel: 'MEDIUM', photos: [faceSvg(6)], notes: 'Repeated night loitering near BP 609.', addedAt: daysAgo(3) },
]

export const seedBlacklist = (): BlacklistVehicle[] => [
  { id: 'bl-01', plate: 'RJ14CA4521', reason: 'SMUGGLING', priority: 'HIGH', notes: 'White pickup, suspected fuel smuggling.', addedAt: daysAgo(20) },
  { id: 'bl-02', plate: 'PB05AK7788', reason: 'STOLEN', priority: 'MEDIUM', notes: 'Stolen from Ferozepur, FIR 87/2026.', addedAt: daysAgo(9) },
  { id: 'bl-03', plate: 'GJ12BT9034', reason: 'WANTED', priority: 'HIGH', notes: 'Linked to Subject W-014.', addedAt: daysAgo(41) },
  { id: 'bl-04', plate: 'JK02BM3310', reason: 'SMUGGLING', priority: 'MEDIUM', notes: 'Truck, repeated night movement.', addedAt: daysAgo(5) },
  { id: 'bl-05', plate: 'RJ19GD0627', reason: 'STOLEN', priority: 'LOW', notes: 'Motorcycle reported stolen.', addedAt: daysAgo(2) },
]

export const seedUsers = (): User[] => [
  { id: 'u-01', name: 'Insp. A. Rathore', username: 'rathore', role: 'COMMANDER', active: true, lastLogin: new Date(Date.now() - 95 * 60_000).toISOString() },
  { id: 'u-02', name: 'Ct. S. Meena', username: 'meena', role: 'OPERATOR', active: true, lastLogin: new Date(Date.now() - 22 * 60_000).toISOString() },
  { id: 'u-03', name: 'Ct. P. Gill', username: 'gill', role: 'OPERATOR', active: true, lastLogin: new Date(Date.now() - 9.5 * 3_600_000).toISOString() },
  { id: 'u-04', name: 'SI R. Sharma', username: 'sharma', role: 'ADMIN', active: true, lastLogin: new Date(Date.now() - 2.2 * 86_400_000).toISOString() },
  { id: 'u-05', name: 'Ct. D. Bishnoi', username: 'bishnoi', role: 'OPERATOR', active: false },
]

export const SUSPICIOUS = [
  'Object thrown across fence',
  'Person crawling near fence',
  'Group gathering near border pillar',
  'Unattended bag at check post',
  'Vehicle halted on border road > 5 min',
  'Person running towards fence',
]

/** Believable audit history for the last three days. */
export function seedAudit(): AuditEntry[] {
  const rows: [number, string, Role, AuditCategory, string, string, string][] = [
    [22, 'Ct. S. Meena', 'OPERATOR', 'AUTH', 'Signed in', 'Command Center', 'workstation OPS-2'],
    [41, 'Ct. S. Meena', 'OPERATOR', 'CAMERA_VIEW', 'Opened live view', 'BOP Sundar - Fence East', ''],
    [63, 'Insp. A. Rathore', 'COMMANDER', 'EVIDENCE', 'Evidence exported', 'ALT-00412', '1 alert(s), 3 files'],
    [95, 'Insp. A. Rathore', 'COMMANDER', 'AUTH', 'Signed in', 'Command Center', 'workstation OPS-1'],
    [130, 'Ct. S. Meena', 'OPERATOR', 'ANPR', 'Plate corrected', 'RJ14CA4S21', 'corrected to RJ14CA4521'],
    [205, 'Insp. A. Rathore', 'COMMANDER', 'ZONE', 'Zone updated', 'Fence Line East', 'severity: HIGH -> CRITICAL'],
    [260, 'Insp. A. Rathore', 'COMMANDER', 'BLACKLIST', 'Plate added', 'RJ19GD0627', 'reason STOLEN, priority LOW'],
    [410, 'Ct. P. Gill', 'OPERATOR', 'EXPORT', 'CSV export', 'Alerts', '86 rows'],
    [570, 'Ct. P. Gill', 'OPERATOR', 'AUTH', 'Signed in', 'Command Center', 'workstation OPS-2'],
    [640, 'Ct. P. Gill', 'OPERATOR', 'CAMERA_VIEW', 'Opened live view', 'Check Post Munabao', ''],
    [900, 'Insp. A. Rathore', 'COMMANDER', 'WATCHLIST', 'Person added', 'Subject S-040 (unidentified)', 'category SUSPECT, risk MEDIUM, 1 photo(s)'],
    [1380, 'Insp. A. Rathore', 'COMMANDER', 'EXPORT', 'Shift report printed', 'Reports', 'all cameras'],
    [1500, 'Ct. S. Meena', 'OPERATOR', 'CAMERA_VIEW', 'Opened live view', 'ICP Attari - Lane 2', ''],
    [2900, 'SI R. Sharma', 'ADMIN', 'SETTINGS', 'Settings changed', 'Data & Privacy', 'retention face data 90d -> 30d'],
    [2960, 'SI R. Sharma', 'ADMIN', 'SETTINGS', 'Camera saved', 'BOP Kishangarh - Watch Tower', 'stream URL updated'],
    [3170, 'SI R. Sharma', 'ADMIN', 'AUTH', 'Signed in', 'Command Center', 'workstation ADMIN-1'],
    [3400, 'Insp. A. Rathore', 'COMMANDER', 'ZONE', 'Zone created', 'Riverbed Crossing', 'polygon with 4 points, severity CRITICAL'],
    [4100, 'Ct. P. Gill', 'OPERATOR', 'AUTH', 'Signed out', 'Command Center', 'auto-logout after inactivity'],
  ]
  return rows.map(([minAgo, user, role, category, action, target, details], i) => ({
    id: `au-seed-${i}`, at: new Date(Date.now() - minAgo * 60_000).toISOString(), user, role, category, action, target, details,
  }))
}

const node = (n: Pick<EdgeNode, 'id' | 'name' | 'locationName' | 'cameraIds'> & Partial<EdgeNode>): EdgeNode => ({
  status: 'online', cpuPct: 48, gpuPct: 62, ramPct: 55, diskPct: 41, tempC: 58, processingFps: 24, latencyMs: 70,
  uptimeSec: 9 * 86_400, bandwidthMbps: 3.2, modelVersion: 'yolo11s-ibvap-1.4.2', lastHeartbeat: new Date().toISOString(),
  ...n,
})

export const seedEdgeNodes = (): EdgeNode[] => [
  node({ id: 'edge-01', name: 'BOP Sundar Edge Node', locationName: 'BOP Sundar, Jaisalmer Sector (RJ)', cameraIds: ['cam-01', 'cam-02'], uptimeSec: 21 * 86_400 + 5 * 3600 }),
  node({ id: 'edge-02', name: 'Munabao Check Post Node', locationName: 'Munabao, Barmer (RJ)', cameraIds: ['cam-03'], cpuPct: 36, gpuPct: 44, ramPct: 47, diskPct: 63, tempC: 54, latencyMs: 110, bandwidthMbps: 1.8, uptimeSec: 6 * 86_400 }),
  node({ id: 'edge-03', name: 'Kishangarh Tower Node', locationName: 'Kishangarh, Jaisalmer (RJ)', cameraIds: ['cam-04', 'cam-05'], status: 'degraded', cpuPct: 93, gpuPct: 97, ramPct: 81, diskPct: 58, tempC: 84, processingFps: 9.4, latencyMs: 310, bandwidthMbps: 0.9, uptimeSec: 37 * 3600, modelVersion: 'yolo11s-ibvap-1.4.1' }),
  node({ id: 'edge-04', name: 'Ferozepur Sector Node', locationName: 'Hussainiwala / Attari (PB)', cameraIds: ['cam-06', 'cam-07'], cpuPct: 57, gpuPct: 71, ramPct: 66, diskPct: 92, tempC: 63, latencyMs: 55, bandwidthMbps: 4.6, uptimeSec: 48 * 86_400 }),
  node({ id: 'edge-05', name: 'Hindumalkot Node', locationName: 'Hindumalkot, Sri Ganganagar (RJ)', cameraIds: ['cam-08'], status: 'offline', cpuPct: 0, gpuPct: 0, ramPct: 0, tempC: 0, processingFps: 0, latencyMs: 0, bandwidthMbps: 0, uptimeSec: 0, lastHeartbeat: new Date(Date.now() - 47 * 60_000).toISOString() }),
]
