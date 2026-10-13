import type { Alert, AlertStatus, AlertType, Severity } from '@/types'

const pad = (n: number) => String(n).padStart(2, '0')

export const fmtTime = (ts: string | number | Date) => {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
export const fmtDate = (ts: string | number | Date) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export const fmtDateTime = (ts: string | number | Date) => `${fmtDate(ts)} ${fmtTime(ts)}`

export function relTime(ts: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(ts)) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function fmtDuration(sec: number) {
  if (!isFinite(sec)) return '-'
  if (sec < 60) return `${Math.round(sec)}s`
  return `${Math.floor(sec / 60)}m ${pad(Math.round(sec % 60))}s`
}

/** RJ14AB1234 -> "RJ 14 AB 1234" */
export function fmtPlate(plate: string) {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{1,4})$/.exec(plate)
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : plate
}

export const pct = (v: number) => `${Math.round(v * 100)}%`

export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
export const STATUSES: AlertStatus[] = ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'RESOLVED', 'FALSE_ALARM']
export const ALERT_TYPES: AlertType[] = [
  'FENCE_INTRUSION', 'HUMAN_DETECTED', 'VEHICLE_DETECTED', 'ANPR_MATCH', 'FACE_MATCH',
  'LOITERING', 'NIGHT_MOVEMENT', 'SUSPICIOUS_ACTIVITY', 'CAMERA_OFFLINE',
]

export const SEV: Record<Severity, { hex: string; text: string; bg: string; soft: string; border: string }> = {
  CRITICAL: { hex: '#ef4444', text: 'text-crit', bg: 'bg-crit', soft: 'bg-crit/15 text-crit border-crit/50', border: 'border-crit' },
  HIGH: { hex: '#f97316', text: 'text-high', bg: 'bg-high', soft: 'bg-high/15 text-high border-high/50', border: 'border-high' },
  MEDIUM: { hex: '#f5b40b', text: 'text-med', bg: 'bg-med', soft: 'bg-med/15 text-med border-med/50', border: 'border-med' },
  LOW: { hex: '#22c55e', text: 'text-low', bg: 'bg-low', soft: 'bg-low/15 text-low border-low/50', border: 'border-low' },
}

export const STATUS_STYLE: Record<AlertStatus, string> = {
  NEW: 'bg-accent/15 text-accent border-accent/50',
  ACKNOWLEDGED: 'bg-base-700 text-ink-dim border-base-600',
  ESCALATED: 'bg-high/15 text-high border-high/50',
  RESOLVED: 'bg-low/15 text-low border-low/50',
  FALSE_ALARM: 'bg-base-800 text-ink-mute border-base-600',
}

export const TYPE_COLOR: Record<AlertType, string> = {
  FENCE_INTRUSION: '#ef4444',
  FACE_MATCH: '#ec4899',
  ANPR_MATCH: '#f97316',
  SUSPICIOUS_ACTIVITY: '#f5b40b',
  NIGHT_MOVEMENT: '#8b5cf6',
  LOITERING: '#eab308',
  HUMAN_DETECTED: '#38bdf8',
  VEHICLE_DETECTED: '#22c55e',
  CAMERA_OFFLINE: '#64748b',
}

export const isActive = (a: Alert) => a.status === 'NEW' || a.status === 'ESCALATED'

/** The one detail an operator needs first: plate, person, zone or description. */
export function keyDetail(a: Alert): string {
  const d = a.details
  if (d.plateNumber && a.type !== 'FACE_MATCH') return `${fmtPlate(d.plateNumber)}${d.vehicleClass ? ` - ${d.vehicleClass}` : ''}`
  if (d.matchedPersonName) return `${d.matchedPersonName}${d.similarity ? ` (${pct(d.similarity)})` : ''}`
  if (d.dwellTimeSec) return `${d.zoneName ?? 'Zone'} - dwell ${fmtDuration(d.dwellTimeSec)}`
  if (a.type === 'FENCE_INTRUSION') return `${d.zoneName ?? 'Fence'} - ${d.objectCount ?? 1} person(s)`
  if (d.vehicleClass) return `${d.vehicleColor ?? ''} ${d.vehicleClass}`.trim()
  return d.description ?? ''
}

export function downloadFile(name: string, content: string | Blob, mime = 'text/csv') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}
