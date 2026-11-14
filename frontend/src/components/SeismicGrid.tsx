import { useEffect, useRef, useState } from 'react'
import { Activity, BellRing, Radio, Shield, Volume2, VolumeX, Zap } from 'lucide-react'
import { useData } from '@/store/data'

interface SensorChannel {
  id: string
  name: string
  sector: string
  velocity: number
  freq: number
  status: 'QUIET' | 'ACTIVITY' | 'ALERT'
  classification: string
}

export function SeismicGrid() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const alerts = useData((s) => s.alerts)
  const hasAlert = alerts.some((a) => a.status === 'NEW')
  const [channels, setChannels] = useState<SensorChannel[]>([
    {
      id: 'ugs-01',
      name: 'UGS-01 [BOP SUNDAR]',
      sector: 'Sector Alpha (Border Fence KM 141.2)',
      velocity: 0.18,
      freq: 0.8,
      status: 'QUIET',
      classification: 'AMB NOISE (WIND/GRAVEL)',
    },
    {
      id: 'ugs-02',
      name: 'UGS-02 [ZERO LINE CENTRAL]',
      sector: 'Sector Bravo (Perimeter Wire KM 143.8)',
      velocity: hasAlert ? 2.15 : 0.42,
      freq: hasAlert ? 1.6 : 0.9,
      status: hasAlert ? 'ALERT' : 'ACTIVITY',
      classification: hasAlert ? 'BIPEDAL FOOTSTEP IMPACT [CONF: 94%]' : 'LOW-FREQ SOIL DISPLACEMENT',
    },
    {
      id: 'ugs-03',
      name: 'UGS-03 [ICP ATTARI APPROACH]',
      sector: 'Sector Charlie (Naka Highway KM 146.0)',
      velocity: 0.25,
      freq: 1.1,
      status: 'QUIET',
      classification: 'ROADWAY SUB-SURFACE ATTENUATION',
    },
  ])

  // Real-time canvas oscilloscope animation
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let t = 0
    const pointsCh1: number[] = new Array(80).fill(0)
    const pointsCh2: number[] = new Array(80).fill(0)
    const pointsCh3: number[] = new Array(80).fill(0)

    const draw = () => {
      t += 0.08
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      // Oscilloscope background grid
      ctx.strokeStyle = 'rgba(28, 42, 69, 0.45)'
      ctx.lineWidth = 1
      for (let x = 0; x < w; x += 30) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
      for (let y = 0; y < h; y += 20) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }

      // Shift and generate waveform data
      pointsCh1.shift()
      pointsCh2.shift()
      pointsCh3.shift()

      // Ch1: Ambient micro-tremor
      const n1 = Math.sin(t * 1.5) * 4 + (Math.random() - 0.5) * 3
      pointsCh1.push(n1)

      // Ch2: Spike on alert or footstep rhythm
      const impulse = hasAlert ? Math.sin(t * 6) * 16 + (Math.random() - 0.5) * 8 : Math.sin(t * 2) * 5 + (Math.random() - 0.5) * 3
      pointsCh2.push(impulse)

      // Ch3: Low vehicle rumble
      const n3 = Math.sin(t * 0.8) * 3 + (Math.random() - 0.5) * 2
      pointsCh3.push(n3)

      const drawChannel = (points: number[], baselineY: number, color: string) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.4
        ctx.beginPath()
        const step = w / (points.length - 1)
        points.forEach((val, i) => {
          const x = i * step
          const y = baselineY + val
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      }

      drawChannel(pointsCh1, h * 0.2, '#38bdf8')
      drawChannel(pointsCh2, h * 0.55, hasAlert ? '#ef4444' : '#22c55e')
      drawChannel(pointsCh3, h * 0.85, '#f5b40b')

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animRef.current)
  }, [hasAlert])

  const triggerTestImpulse = () => {
    setChannels((prev) =>
      prev.map((c, i) =>
        i === 1
          ? {
              ...c,
              velocity: 2.85,
              freq: 1.8,
              status: 'ALERT',
              classification: 'SIMULATED STRIDE IMPACT // TEST TRIGGER',
            }
          : c,
      ),
    )
    setTimeout(() => {
      setChannels((prev) =>
        prev.map((c, i) =>
          i === 1
            ? {
                ...c,
                velocity: hasAlert ? 2.15 : 0.42,
                freq: hasAlert ? 1.6 : 0.9,
                status: hasAlert ? 'ALERT' : 'ACTIVITY',
                classification: hasAlert
                  ? 'BIPEDAL FOOTSTEP IMPACT [CONF: 94%]'
                  : 'LOW-FREQ SOIL DISPLACEMENT',
              }
            : c,
        ),
      )
    }, 4000)
  }

  return (
    <div className="panel flex flex-col gap-2 p-2.5">
      <div className="flex items-center justify-between border-b border-base-700 pb-1.5">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent animate-pulse" />
          <span className="panel-title text-accent">
            SEISMIC & ACOUSTIC UGS SENSOR GRID (UNATTENDED GROUND SENSORS)
          </span>
          <span className="rounded bg-sky-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-300 border border-sky-500/40">
            CIBMS SUBSURFACE TELEMETRY
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={triggerTestImpulse}
            className="btn btn-sm font-mono text-[10px] text-ink-dim hover:text-ink"
            title="Inject simulated ground seismic pulse on Sector Bravo"
          >
            <Zap size={11} className="text-amber-400" /> Test Waveform Ping
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
        {/* Real-time Oscilloscope Canvas */}
        <div className="md:col-span-2 relative h-28 rounded border border-base-700 bg-base-950/90 overflow-hidden flex flex-col justify-between p-1.5">
          <div className="flex justify-between font-mono text-[9px] text-ink-mute z-10">
            <span className="text-sky-400">CH1: UGS-01 (0.8 Hz)</span>
            <span className={hasAlert ? 'text-crit font-bold animate-pulse' : 'text-emerald-400'}>
              CH2: UGS-02 ({hasAlert ? '1.6 Hz ALERT' : 'NORMAL'})
            </span>
            <span className="text-amber-400">CH3: UGS-03 (1.1 Hz)</span>
          </div>
          <canvas ref={canvasRef} width={340} height={90} className="absolute inset-0 w-full h-full" />
          <div className="flex justify-between font-mono text-[8px] text-ink-mute/70 z-10 mt-auto">
            <span>SAMPLING: 250 S/s</span>
            <span>GROUND COUPLING: EXCELLENT (99.4%)</span>
            <span>BANDPASS: 0.1 - 40 Hz</span>
          </div>
        </div>

        {/* Telemetry Sensor Cards */}
        <div className="md:col-span-2 flex flex-col justify-between gap-1.5">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`flex items-center justify-between px-2.5 py-1 rounded border text-xs ${
                ch.status === 'ALERT'
                  ? 'border-crit/70 bg-crit/10 text-crit'
                  : ch.status === 'ACTIVITY'
                  ? 'border-med/60 bg-med/10 text-amber-200'
                  : 'border-base-700 bg-base-850/80 text-ink-dim'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 font-semibold text-[11px]">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      ch.status === 'ALERT'
                        ? 'bg-crit animate-ping'
                        : ch.status === 'ACTIVITY'
                        ? 'bg-med'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span>{ch.name}</span>
                  <span className="text-[10px] font-mono text-ink-mute truncate">
                    · {ch.sector}
                  </span>
                </div>
                <div className="font-mono text-[10px] truncate text-ink-mute">
                  {ch.classification}
                </div>
              </div>
              <div className="text-right shrink-0 font-mono text-[11px] pl-2">
                <div className="font-bold">{ch.velocity.toFixed(2)} mm/s</div>
                <div className="text-[9px] text-ink-mute">{ch.freq.toFixed(1)} Hz</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
