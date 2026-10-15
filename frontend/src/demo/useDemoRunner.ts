import { useEffect, useRef } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import type { Alert } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useAuth } from '@/store/auth'
import { groupIncidents } from '@/lib/incidents'
import { PLAYBOOKS, qrtMessage } from '@/lib/playbooks'
import { isWatchActive, distanceKm } from '@/lib/geo'
import { audit } from '@/lib/audit'
import { translate } from '@/i18n'
import { exportEvidence } from '@/components/EvidencePanel'

// Scripted ~2.5 minute story for judges (mock mode only): "Punjab sector, foggy night, drone drop".
// Start/stop: Settings -> Demo Mode, or the hidden shortcut Ctrl+Shift+D. Safe to run twice without reload:
// every run ends earlier demo watches and uses fresh alerts / track ids.
//
// PS 26187 coverage: night + fog (a), drone + map + command & control hand-off (b, g, h), human detection and
// tracking (c, d), suspicious activity + night movement (c), virtual fence (e), face recognition (b2),
// vehicle classification + ANPR (f), real-time alerts + event logging (all steps, audit log), evidence (i).

interface Ctx {
  navigate: NavigateFunction
  droneId?: string
  watchId?: string
  trackId?: number
  /** First alert of the intruder incident. */
  firstId?: string
  fenceId?: string
  anprId?: string
}

interface Step {
  at: number // seconds from start
  caption: string
  run?: (ctx: Ctx) => void | Promise<void>
}

const RIVER = 'cam-06' // BOP Ajnala - River Cam (thermal)
const GATE = 'cam-08' // BOP Ajnala - Road Gate (ANPR)
const JEEP_PLATE = 'PB02DJ4410'
const data = () => useData.getState()
const actor = () => useAuth.getState().user?.name ?? 'Operator'
const incidentOf = (id?: string) => groupIncidents(data().alerts).find((i) => i.alerts.some((a) => a.id === id))
const latestAlert = (pred: (a: Alert) => boolean) => data().alerts.find(pred)

async function emit(spec: Parameters<typeof service.demo.emit>[0]) {
  const a = await service.demo.emit(spec)
  if (a) data().ingest(a)
  return a
}

async function tickPlaybook(alertId: string, index: number) {
  const step = PLAYBOOKS.FENCE_INTRUSION[index]
  data().ingest(await service.setPlaybookStep(alertId, step.id, step.label, true, actor()))
}

const STEPS: Step[] = [
  {
    at: 0,
    caption: 'Punjab sector, 02:10, dense fog: visible cameras report "AI degraded (fog)", the thermal River Cam at BOP Ajnala still sees clearly',
    run: async (c) => {
      // Reset anything an earlier run left behind.
      for (const w of data().droneWatches.filter((x) => isWatchActive(x) && x.reason.startsWith('[DEMO]'))) await service.endDroneWatch(w.id, actor())
      // Fog degrades the visible cameras; the thermal River Cam is unaffected.
      for (const [cam, visibility] of [['cam-06', 'clear'], ['cam-08', 'fog'], ['cam-07', 'fog']] as const) {
        await service.saveCamera({ id: cam, name: data().cameras.find((x) => x.id === cam)?.name ?? cam, visibility, isNightMode: true })
      }
      await Promise.all([data().refreshCameras(), data().refreshWatches()])
      useUi.getState().set({ cameraLayout: 3 })
      c.navigate('/cameras')
    },
  },
  {
    at: 10,
    caption: 'Post reports a drone over the Ravi: DRONE_SIGHTING alert near BOP Ajnala - River Cam',
    run: async (c) => {
      const a = await emit({ type: 'DRONE_SIGHTING', cameraId: RIVER })
      c.droneId = a?.id
      if (a) c.navigate(`/alerts/${a.id}`)
    },
  },
  { at: 18, caption: 'Operator marks the drone sighting on the map', run: (c) => c.navigate(`/map?drone=${c.droneId ?? ''}`) },
  {
    at: 24,
    caption: '2 km drone watch starts for 4 h: cameras, ANPR points and police nakas inside are highlighted, countdown in the top bar',
    run: async (c) => {
      const cam = data().cameras.find((x) => x.id === RIVER)!
      const w = await service.createDroneWatch({ lat: cam.lat - 0.004, lng: cam.lng + 0.006, radiusKm: 2, durationH: 4, reason: `[DEMO] Drone sighting ${c.droneId ?? ''}`, linkedAlertId: c.droneId ?? null, createdBy: actor() })
      audit('DRONE', 'Drone watch started', w.id, `2 km for 4 h, alert ${c.droneId ?? '-'}`)
      c.watchId = w.id
      await data().refreshWatches()
      c.navigate(`/map?watch=${w.id}`)
    },
  },
  {
    at: 34,
    caption: 'Meanwhile at ICP Attari: face watchlist match (HIGH: quiet toast, decision support only)',
    run: () => void emit({ type: 'FACE_MATCH', cameraId: 'cam-07', personId: 'wp-02' }),
  },
  {
    at: 41,
    caption: 'Thermal camera: person crawling near the fence. Tagged "In drone watch area", severity raised one level',
    run: async (c) => {
      c.navigate('/')
      const a = await emit({ type: 'NIGHT_MOVEMENT', cameraId: RIVER, severity: 'MEDIUM' })
      c.firstId = a?.id
      c.trackId = a?.trackId ?? undefined
      setTimeout(() => void emit({ type: 'SUSPICIOUS_ACTIVITY', subtype: 'CRAWLING', cameraId: RIVER, trackId: c.trackId, severity: 'MEDIUM' }), 2500)
    },
  },
  {
    at: 53,
    run: (c) => void emit({ type: 'LOITERING', cameraId: RIVER, trackId: c.trackId, severity: 'MEDIUM' }),
    caption: 'The same track loiters: the incident counter grows, no extra beep (one notification per incident)',
  },
  {
    at: 61,
    caption: 'It crosses the Riverbed Crossing zone: CRITICAL dialog shows the clip so the operator can verify first',
    run: async (c) => {
      const a = await emit({ type: 'FENCE_INTRUSION', cameraId: RIVER, trackId: c.trackId })
      c.fenceId = a?.id
    },
  },
  {
    at: 70,
    caption: 'Operator verifies on the clip and acknowledges the whole incident: response time recorded',
    run: (c) => {
      if (c.fenceId) void data().setIncidentStatus(c.fenceId, 'ACKNOWLEDGED')
    },
  },
  {
    at: 76,
    caption: 'A jeep leaves the area: vehicle classified, ANPR at the Road Gate reads a BLACKLISTED plate inside the watch',
    run: async (c) => {
      const a = await emit({ type: 'ANPR_MATCH', cameraId: GATE, plate: JEEP_PLATE, vehicleClass: 'jeep' })
      c.anprId = a?.id ?? latestAlert((x) => x.type === 'ANPR_MATCH' && x.details.plateNumber === JEEP_PLATE)?.id
      c.navigate('/anpr')
    },
  },
  {
    at: 86,
    caption: 'Share with police naka: the jeep alert goes to the joint nakas inside the watch (simulated) and is logged',
    run: async (c) => {
      const id = c.anprId ?? latestAlert((x) => x.type === 'ANPR_MATCH' && x.details.plateNumber === JEEP_PLATE)?.id
      const w = data().droneWatches.find((x) => x.id === c.watchId)
      if (!id) return
      const nakas = data().nakas.filter((n) => (w ? distanceKm(n.lat, n.lng, w.lat, w.lng) <= w.radiusKm + 3 : true)).slice(0, 2)
      await service.shareWithNaka({ alertIds: [id] }, nakas.map((n) => n.id), actor())
      audit('DRONE', 'Shared with police naka', id, nakas.map((n) => n.name).join(', '))
      c.navigate(`/alerts/${id}`)
    },
  },
  {
    at: 95,
    caption: 'Response playbook ticked and QRT notified over secure SMS / radio relay (simulated)',
    run: async (c) => {
      const id = c.fenceId
      if (!id) return
      c.navigate(`/alerts/${id}`)
      await tickPlaybook(id, 0)
      setTimeout(() => void tickPlaybook(id, 1), 1500)
      const a = data().alerts.find((x) => x.id === id)
      const camera = data().cameras.find((x) => x.id === RIVER)
      if (a) data().ingest(await service.notifyQrt(id, 'WHATSAPP', qrtMessage(a, camera, translate('en', `type.${a.type}`)), actor()))
    },
  },
  {
    at: 103,
    caption: 'QRT mobile view: the team accepts the task, the dashboard updates live',
    run: async (c) => {
      c.navigate('/qrt')
      const inc = incidentOf(c.fenceId)
      if (!inc) return
      setTimeout(async () => {
        const out = await service.updateQrtStatus(inc.alerts.map((a) => a.id), 'ACCEPTED', 'QRT (Ajnala)')
        out.forEach((a) => data().ingest(a))
      }, 3000)
    },
  },
  {
    at: 112,
    caption: 'Evidence: bookmark the crossing in the clip, then export ZIP with clip window, bookmarks, SHA-256 hashes, chain of custody',
    run: async (c) => {
      const id = c.fenceId
      if (!id) return
      c.navigate(`/alerts/${id}`)
      data().ingest(await service.addAlertHistory(id, { kind: 'bookmark', offsetSec: 0, note: '+0.0 s: crosses Riverbed Crossing zone', by: actor() }))
      const inc = incidentOf(id)
      if (inc) await exportEvidence(inc.id, inc.alerts)
    },
  },
  {
    at: 122,
    caption: 'Incident escalated to the Company Commander; every step is in the alert history and the audit log',
    run: (c) => {
      if (c.fenceId) void data().setIncidentStatus(c.fenceId, 'ESCALATED', 'Drone drop suspected, QRT on the way')
    },
  },
  { at: 128, caption: 'Event log: every operator and system action is in the audit log (who, what, when)', run: (c) => c.navigate('/audit') },
  { at: 135, caption: 'Command & Control integration: REST API, WebSocket stream and a webhook push every alert as JSON', run: (c) => c.navigate('/settings?tab=integration') },
  { at: 142, caption: 'IBVAP covers every requirement of Problem Statement 26187', run: (c) => c.navigate('/about') },
]
const TOTAL_SECONDS = 155

export function useDemoRunner() {
  const navigate = useNavigate()
  const request = useUi((s) => s.demoRequest)
  const handled = useRef(request)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const navRef = useRef(navigate)
  navRef.current = navigate

  useEffect(() => {
    const ui = useUi.getState()
    const stop = () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      service.demo.setAutoSimulation(true)
      useUi.getState().set({ demo: { running: false, caption: '', step: 0, total: 0 } })
    }
    if (handled.current === request) return
    handled.current = request
    if (ui.demo.running) {
      stop()
      return
    }
    if (!service.demo.available) {
      ui.set({ demo: { running: false, caption: 'Demo Mode needs mock mode (VITE_USE_MOCK=true)', step: 0, total: 0 } })
      timers.current.push(setTimeout(() => useUi.getState().set({ demo: { running: false, caption: '', step: 0, total: 0 } }), 4000))
      return
    }
    service.demo.setAutoSimulation(false)
    service.demo.setLinkDown(false)
    useData.setState({ modalQueue: [], toasts: [] })
    const ctx: Ctx = { navigate: (...args: Parameters<NavigateFunction>) => navRef.current(...args) } as Ctx
    const captions = STEPS.filter((s, i) => i === 0 || s.caption !== STEPS[i - 1].caption)
    STEPS.forEach((step) => {
      timers.current.push(
        setTimeout(() => {
          useUi.getState().set({ demo: { running: true, caption: step.caption, step: captions.findIndex((x) => x.caption === step.caption) + 1, total: captions.length } })
          // A failing step must never stop the rest of the demo.
          Promise.resolve()
            .then(() => step.run?.(ctx))
            .catch((e) => console.warn('Demo step failed:', step.caption, e))
        }, step.at * 1000),
      )
    })
    timers.current.push(setTimeout(stop, TOTAL_SECONDS * 1000))
  }, [request])

  // Mounted at app level (the demo visits /qrt, outside the dashboard layout). Stop cleanly on logout.
  const user = useAuth((s) => s.user)
  useEffect(() => {
    if (user) return
    timers.current.forEach(clearTimeout)
    timers.current = []
    if (useUi.getState().demo.running) {
      service.demo.setAutoSimulation(true)
      useUi.getState().set({ demo: { running: false, caption: '', step: 0, total: 0 } })
    }
  }, [user])
}
