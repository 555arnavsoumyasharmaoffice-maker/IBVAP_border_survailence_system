import { useEffect, useRef } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useAuth } from '@/store/auth'
import { groupIncidents } from '@/lib/incidents'
import { PLAYBOOKS, qrtMessage } from '@/lib/playbooks'
import { translate } from '@/i18n'
import { exportEvidence } from '@/components/EvidencePanel'

// Scripted ~2 minute scenario for judges (mock mode only).
// Start/stop: Settings -> Demo Mode, or the hidden shortcut Ctrl+Shift+D.

interface Ctx {
  navigate: NavigateFunction
  intrusionId?: string
}

interface Step {
  at: number // seconds from start
  caption: string
  run?: (ctx: Ctx) => void | Promise<void>
}

const CAM = 'cam-02' // BOP Sundar - Fence East
const BLACKLISTED_PLATE = 'RJ14CA4521'
const data = () => useData.getState()
const actor = () => useAuth.getState().user?.name ?? 'Operator'
const intrusion = (c: Ctx) => data().alerts.find((a) => a.id === c.intrusionId)
const intrusionIncident = (c: Ctx) => groupIncidents(data().alerts).find((i) => i.alerts.some((a) => a.id === c.intrusionId))
const emitFence = () => service.demo.emit({ type: 'FENCE_INTRUSION', cameraId: CAM })

async function tickPlaybook(c: Ctx, index: number) {
  const step = PLAYBOOKS.FENCE_INTRUSION[index]
  if (c.intrusionId) data().ingest(await service.setPlaybookStep(c.intrusionId, step.id, step.label, true, actor()))
}

const STEPS: Step[] = [
  { at: 0, caption: 'Normal patrol: AI engine is watching every existing CCTV feed, no new hardware', run: (c) => c.navigate('/') },
  {
    at: 8,
    caption: 'Vehicle detected and classified at Check Post Munabao',
    run: () => void service.demo.emit({ type: 'VEHICLE_DETECTED', cameraId: 'cam-03', plate: 'RJ19TA5512' }),
  },
  {
    at: 16,
    caption: 'ANPR reads the next plate: BLACKLIST MATCH (suspected smuggling)',
    run: () => void service.demo.emit({ type: 'ANPR_MATCH', cameraId: 'cam-03', plate: BLACKLISTED_PLATE }),
  },
  { at: 24, caption: 'ANPR log: every plate read, blacklist status and vehicle history', run: (c) => c.navigate('/anpr') },
  { at: 33, caption: 'Night: low-light / IR feed at BOP Sundar - Fence East', run: (c) => c.navigate(`/cameras?cam=${CAM}`) },
  {
    at: 41,
    caption: 'A person crosses the virtual fence: CRITICAL alert on every screen',
    run: async (c) => {
      c.intrusionId = (await emitFence())?.id
    },
  },
  {
    at: 50,
    caption: 'Operator acknowledges: response time is recorded',
    run: (c) => {
      if (c.intrusionId) void data().setIncidentStatus(c.intrusionId, 'ACKNOWLEDGED')
    },
  },
  {
    at: 55,
    caption: 'The intruder is re-detected twice: alerts collapse into ONE incident (x3), no repeat popups',
    run: async (c) => {
      c.navigate('/')
      await emitFence()
      setTimeout(() => void emitFence(), 2500)
    },
  },
  {
    at: 66,
    caption: 'Response playbook: SOP steps are ticked and saved in the alert history',
    run: async (c) => {
      if (!c.intrusionId) return
      c.navigate(`/alerts/${c.intrusionId}`)
      await tickPlaybook(c, 0)
      setTimeout(() => void tickPlaybook(c, 1), 2500)
    },
  },
  {
    at: 74,
    caption: 'Notify QRT: message relayed over secure SMS / radio relay (simulated) and logged',
    run: async (c) => {
      const a = intrusion(c)
      if (!a) return
      const camera = data().cameras.find((x) => x.id === a.cameraId)
      data().ingest(await service.notifyQrt(a.id, 'WHATSAPP', qrtMessage(a, camera, translate('en', `type.${a.type}`)), actor()))
    },
  },
  {
    at: 82,
    caption: 'Evidence export: ZIP with snapshots, SHA-256 hashes and chain-of-custody log',
    run: async (c) => {
      const inc = intrusionIncident(c)
      if (inc) await exportEvidence(inc.id, inc.alerts)
    },
  },
  { at: 91, caption: 'Map flies to the intrusion site: the camera marker pulses in the severity colour', run: (c) => c.navigate(`/map?cam=${CAM}`) },
  {
    at: 100,
    caption: 'Incident escalated to the Company Commander',
    run: (c) => {
      if (c.intrusionId) void data().setIncidentStatus(c.intrusionId, 'ESCALATED', 'QRT requested at Fence East')
    },
  },
  { at: 106, caption: 'Shift report generated: ready to print or hand off to Command & Control', run: (c) => c.navigate('/reports?auto=1') },
  { at: 117, caption: 'IBVAP covers every requirement of Problem Statement 26187', run: (c) => c.navigate('/about') },
]
const TOTAL_SECONDS = 132

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
    const ctx: Ctx = { navigate: (...args: Parameters<NavigateFunction>) => navRef.current(...args) } as Ctx
    STEPS.forEach((step, i) => {
      timers.current.push(
        setTimeout(() => {
          useUi.getState().set({ demo: { running: true, caption: step.caption, step: i + 1, total: STEPS.length } })
          // A failing step must never stop the rest of the demo.
          Promise.resolve()
            .then(() => step.run?.(ctx))
            .catch((e) => console.warn('Demo step failed:', step.caption, e))
        }, step.at * 1000),
      )
    })
    timers.current.push(setTimeout(stop, TOTAL_SECONDS * 1000))
  }, [request])

  // Stop cleanly if the layout unmounts (logout) mid-demo.
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      service.demo.setAutoSimulation(true)
      useUi.getState().set({ demo: { running: false, caption: '', step: 0, total: 0 } })
    },
    [],
  )
}
