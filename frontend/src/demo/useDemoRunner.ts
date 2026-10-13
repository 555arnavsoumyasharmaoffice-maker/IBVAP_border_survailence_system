import { useEffect, useRef } from 'react'
import { useNavigate, type NavigateFunction } from 'react-router-dom'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'

// Scripted ~2 minute scenario for judges (mock mode only).
// Start/stop: Settings -> Demo, or the hidden shortcut Ctrl+Shift+D.

interface Ctx {
  navigate: NavigateFunction
  intrusionId?: string
}

interface Step {
  at: number // seconds from start
  caption: string
  run?: (ctx: Ctx) => void | Promise<void>
}

const BLACKLISTED_PLATE = 'RJ14CA4521'

const STEPS: Step[] = [
  { at: 0, caption: 'Normal patrol: AI engine is watching every existing CCTV feed, no new hardware', run: (c) => c.navigate('/') },
  {
    at: 10,
    caption: 'Vehicle detected and classified at Check Post Munabao',
    run: () => void service.demo.emit({ type: 'VEHICLE_DETECTED', cameraId: 'cam-03', plate: 'RJ19TA5512' }),
  },
  {
    at: 22,
    caption: 'ANPR reads the next plate: BLACKLIST MATCH (suspected smuggling)',
    run: () => void service.demo.emit({ type: 'ANPR_MATCH', cameraId: 'cam-03', plate: BLACKLISTED_PLATE }),
  },
  { at: 32, caption: 'ANPR log: every plate read, blacklist status and vehicle history', run: (c) => c.navigate('/anpr') },
  { at: 46, caption: 'Night: low-light / IR feed at BOP Sundar - Fence East', run: (c) => c.navigate('/cameras?cam=cam-02') },
  {
    at: 58,
    caption: 'A person crosses the virtual fence: CRITICAL alert on every screen',
    run: async (c) => {
      c.intrusionId = (await service.demo.emit({ type: 'FENCE_INTRUSION', cameraId: 'cam-02' }))?.id
    },
  },
  {
    at: 68,
    caption: 'Operator acknowledges (response time is logged)',
    run: (c) => {
      if (c.intrusionId) void useData.getState().setStatus(c.intrusionId, 'ACKNOWLEDGED')
    },
  },
  {
    at: 74,
    caption: 'Map flies to the intrusion site: the camera marker pulses in the severity colour',
    run: (c) => c.navigate('/map?cam=cam-02'),
  },
  {
    at: 88,
    caption: 'Operator escalates to the Company Commander',
    run: (c) => {
      if (!c.intrusionId) return
      void useData.getState().setStatus(c.intrusionId, 'ESCALATED', 'QRT requested at Fence East')
      c.navigate(`/alerts/${c.intrusionId}`)
    },
  },
  { at: 104, caption: 'Shift report generated: ready to print or hand off to Command & Control', run: (c) => c.navigate('/reports?auto=1') },
]
const TOTAL_SECONDS = 120

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
    const ctx: Ctx = { navigate: (...args: Parameters<NavigateFunction>) => navRef.current(...args) } as Ctx
    STEPS.forEach((step, i) => {
      timers.current.push(
        setTimeout(() => {
          useUi.getState().set({ demo: { running: true, caption: step.caption, step: i + 1, total: STEPS.length } })
          void step.run?.(ctx)
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
