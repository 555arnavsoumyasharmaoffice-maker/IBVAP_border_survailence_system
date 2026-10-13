import type { Alert, AlertStatus, Incident, Severity } from '@/types'

// Incident grouping (reduces alert fatigue). Rule, also documented in docs/API_CONTRACT.md:
//   an alert joins an existing incident when
//     a) it has the same camera + trackId and arrives within 10 min of that incident's last alert, or
//     b) it has the same camera + type and arrives within 2 min of that incident's last alert.
// Incidents are derived on the client from the alert list, so they work in mock and real mode.

export const SAME_TYPE_WINDOW_MS = 2 * 60_000
export const SAME_TRACK_WINDOW_MS = 10 * 60_000

export const SEV_RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }

export function incidentStatus(alerts: Alert[]): AlertStatus {
  if (alerts.some((a) => a.status === 'NEW')) return 'NEW'
  if (alerts.some((a) => a.status === 'ESCALATED')) return 'ESCALATED'
  if (alerts.every((a) => a.status === 'FALSE_ALARM')) return 'FALSE_ALARM'
  if (alerts.every((a) => a.status === 'RESOLVED' || a.status === 'FALSE_ALARM')) return 'RESOLVED'
  return 'ACKNOWLEDGED'
}

/** `alerts` must be newest-first (as kept in the store). Returns incidents newest-first. */
export function groupIncidents(alerts: Alert[]): Incident[] {
  const byTrack = new Map<string, Incident>()
  const byType = new Map<string, Incident>()
  const out: Incident[] = []
  for (let i = alerts.length - 1; i >= 0; i--) {
    const a = alerts[i]
    const ts = Date.parse(a.timestamp)
    const trackKey = a.trackId !== null ? `${a.cameraId}|${a.trackId}` : ''
    const typeKey = `${a.cameraId}|${a.type}`
    let inc = trackKey ? byTrack.get(trackKey) : undefined
    if (inc && ts - Date.parse(inc.lastSeen) > SAME_TRACK_WINDOW_MS) inc = undefined
    if (!inc) {
      const candidate = byType.get(typeKey)
      if (candidate && ts - Date.parse(candidate.lastSeen) <= SAME_TYPE_WINDOW_MS) inc = candidate
    }
    if (!inc) {
      inc = {
        id: a.id.replace(/^ALT/, 'INC'), cameraId: a.cameraId, type: a.type, trackId: a.trackId,
        alerts: [], firstSeen: a.timestamp, lastSeen: a.timestamp, severity: a.severity, status: a.status,
      }
      out.push(inc)
    }
    inc.alerts.unshift(a)
    inc.lastSeen = a.timestamp
    if (SEV_RANK[a.severity] > SEV_RANK[inc.severity]) {
      inc.severity = a.severity
      inc.type = a.type
    }
    if (trackKey) byTrack.set(trackKey, inc)
    byType.set(typeKey, inc)
  }
  for (const inc of out) inc.status = incidentStatus(inc.alerts)
  return out.reverse()
}

/**
 * Would `a` (a brand-new alert) join an incident that already exists in `alerts` (newest-first)?
 * Returns the highest severity already seen in that incident, or null when `a` starts a new incident.
 */
export function existingIncidentSeverity(a: Alert, alerts: Alert[]): Severity | null {
  const ts = Date.parse(a.timestamp)
  let best: Severity | null = null
  for (const b of alerts) {
    const age = ts - Date.parse(b.timestamp)
    if (age > SAME_TRACK_WINDOW_MS) break
    if (b.id === a.id || b.cameraId !== a.cameraId) continue
    const sameTrack = a.trackId !== null && b.trackId === a.trackId
    const sameType = b.type === a.type && age <= SAME_TYPE_WINDOW_MS
    if ((sameTrack || sameType) && (best === null || SEV_RANK[b.severity] > SEV_RANK[best])) best = b.severity
  }
  return best
}

/** Which alerts of an incident a status change applies to. */
export function eligibleFor(status: AlertStatus, alerts: Alert[]): Alert[] {
  const closed = (a: Alert) => a.status === 'RESOLVED' || a.status === 'FALSE_ALARM'
  if (status === 'ACKNOWLEDGED') return alerts.filter((a) => a.status === 'NEW')
  if (status === 'ESCALATED') return alerts.filter((a) => !closed(a) && a.status !== 'ESCALATED')
  return alerts.filter((a) => !closed(a))
}
