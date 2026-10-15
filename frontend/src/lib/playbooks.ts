import type { Alert, AlertType, Camera } from '@/types'
import { fmtTime, keyDetail } from './format'

export interface PlaybookStep {
  id: string
  label: string
}

const steps = (...labels: string[]): PlaybookStep[] => labels.map((label, i) => ({ id: `s${i + 1}`, label }))

/** Standard operating procedure per alert type. Shown for CRITICAL / HIGH alerts. */
export const PLAYBOOKS: Record<AlertType, PlaybookStep[]> = {
  FENCE_INTRUSION: steps('Verify on live camera', 'Inform QRT', 'Track movement across cameras', 'Log outcome'),
  FACE_MATCH: steps('Compare captured face with watchlist photo', 'Confirm or reject the match', 'Inform Commander / QRT if confirmed', 'Log outcome'),
  ANPR_MATCH: steps('Verify plate on snapshot', 'Alert next check post', 'Track vehicle route on ANPR page', 'Log outcome'),
  SUSPICIOUS_ACTIVITY: steps('Verify on live camera', 'Assess threat level', 'Inform QRT if required', 'Log outcome'),
  NIGHT_MOVEMENT: steps('Verify on IR / low-light feed', 'Count persons and direction', 'Inform patrol party', 'Log outcome'),
  LOITERING: steps('Verify on live camera', 'Check dwell time and zone', 'Send patrol to check', 'Log outcome'),
  HUMAN_DETECTED: steps('Verify on live camera', 'Identify: staff / civilian / unknown', 'Log outcome'),
  VEHICLE_DETECTED: steps('Verify vehicle class', 'Check plate against blacklist', 'Log outcome'),
  CAMERA_OFFLINE: steps('Check network link to the outpost', 'Inform technical team', 'Deploy manual watch if needed', 'Log restoration'),
}

export const hasPlaybook = (a: Alert) => a.severity === 'CRITICAL' || a.severity === 'HIGH'

/** Default message relayed to the Quick Reaction Team (secure SMS / radio relay). */
export function qrtMessage(a: Alert, camera: Camera | undefined, typeLabel: string) {
  const where = camera ? `${camera.name} (${camera.lat.toFixed(4)}, ${camera.lng.toFixed(4)})` : a.cameraId
  return `IBVAP ${a.severity} ALERT: ${typeLabel} at ${where}, ${fmtTime(a.timestamp)} hrs. ${keyDetail(a)}. Ref ${a.id}. QRT to respond and report.`
}
