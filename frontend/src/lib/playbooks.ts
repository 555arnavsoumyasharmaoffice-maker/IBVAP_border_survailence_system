import type { Alert, AlertType, Camera } from '@/types'
import { fmtTime, keyDetail } from './format'

export interface PlaybookStep {
  id: string
  label: string
  /** Mandatory steps must be ticked before the alert / incident can be resolved (SOP gate). */
  mandatory: boolean
}

/** Labels ending in "?" are optional steps. */
const steps = (...labels: string[]): PlaybookStep[] =>
  labels.map((label, i) => ({ id: `s${i + 1}`, label: label.replace(/\?$/, ''), mandatory: !label.endsWith('?') }))

/** Standard operating procedure per alert type. Shown for CRITICAL / HIGH alerts. */
export const PLAYBOOKS: Record<AlertType, PlaybookStep[]> = {
  FENCE_INTRUSION: steps('Verify on live camera', 'Inform QRT', 'Track movement across cameras?', 'Log outcome'),
  FACE_MATCH: steps('Compare captured face with watchlist photo', 'Confirm or reject the match', 'Inform Commander / QRT if confirmed', 'Log outcome'),
  ANPR_MATCH: steps('Verify plate on snapshot', 'Alert next check post', 'Track vehicle route on ANPR page?', 'Log outcome'),
  SUSPICIOUS_ACTIVITY: steps('Verify on live camera', 'Assess threat level', 'Inform QRT if required?', 'Log outcome'),
  NIGHT_MOVEMENT: steps('Verify on IR / low-light feed', 'Count persons and direction', 'Inform patrol party', 'Log outcome'),
  LOITERING: steps('Verify on live camera', 'Check dwell time and zone', 'Send patrol to check', 'Log outcome'),
  HUMAN_DETECTED: steps('Verify on live camera', 'Identify: staff / civilian / unknown', 'Log outcome'),
  VEHICLE_DETECTED: steps('Verify vehicle class', 'Check plate against blacklist', 'Log outcome'),
  DRONE_SIGHTING: steps('Verify sighting on camera / with post', 'Start drone watch on the map', 'Alert nakas in the watch area', 'Search the drop area', 'Log outcome'),
  CAMERA_OFFLINE: steps('Check network link to the outpost', 'Inform technical team', 'Deploy manual watch if needed', 'Log restoration'),
}

export const hasPlaybook = (a: Alert) => a.severity === 'CRITICAL' || a.severity === 'HIGH'

/**
 * SOP gate: mandatory playbook steps not yet ticked for these alerts (one incident or one alert).
 * A step counts as done if it was ticked on any alert of the same type in the group.
 */
export function missingSteps(alerts: Alert[]): string[] {
  const types = [...new Set(alerts.filter(hasPlaybook).map((a) => a.type))]
  return types.flatMap((type) => {
    const done = new Set(alerts.filter((a) => a.type === type).flatMap((a) => a.playbookDone ?? []))
    return PLAYBOOKS[type].filter((st) => st.mandatory && !done.has(st.id)).map((st) => st.label)
  })
}

/** Default message relayed to the Quick Reaction Team (secure SMS / radio relay). */
export function qrtMessage(a: Alert, camera: Camera | undefined, typeLabel: string) {
  const where = camera ? `${camera.name} (${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)})` : a.cameraId
  return `IBVAP ${a.severity} ALERT: ${typeLabel} at ${where}, ${fmtTime(a.timestamp)} hrs. ${keyDetail(a)}. Ref ${a.id}. QRT to respond and report.`
}
