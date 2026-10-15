import { useEffect, useRef, useState } from 'react'
import { Bookmark, Pause, Play } from 'lucide-react'
import type { Alert, AlertClip } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { fmtDateTime } from '@/lib/format'
import { useT } from '@/i18n'

const RATES = [0.5, 1, 2] as const
const DEFAULT_CLIP: AlertClip = { url: null, startOffsetSec: -10, endOffsetSec: 20, simulated: true }

/** Deterministic PRNG so the simulated clip of an alert always looks the same. */
function seeded(id: string) {
  let h = 2166136261
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

interface SimObject {
  person: boolean
  /** bbox at the alert moment */
  x: number
  y: number
  w: number
  h: number
  /** normalised units per second */
  vx: number
  vy: number
  main: boolean
}

function simObjects(alert: Alert): SimObject[] {
  const rnd = seeded(alert.id)
  const person = alert.details.objectClass ? alert.details.objectClass === 'person' : true
  const [x, y, w, h] = alert.bbox ?? [0.45, 0.5, 0.05, 0.2]
  const dir = rnd() < 0.5 ? 1 : -1
  const objs: SimObject[] = [{ person, x, y, w, h, vx: dir * (person ? 0.012 + rnd() * 0.01 : 0.03 + rnd() * 0.02), vy: (rnd() - 0.5) * 0.004, main: true }]
  for (let i = 0, n = Math.floor(rnd() * 3); i < n; i++) {
    const p = rnd() < 0.6
    const ow = p ? 0.04 + rnd() * 0.02 : 0.14 + rnd() * 0.06
    objs.push({ person: p, x: rnd() * 0.8, y: 0.42 + rnd() * 0.25, w: ow, h: p ? ow * 3.8 : ow, vx: (rnd() < 0.5 ? 1 : -1) * (p ? 0.01 : 0.035), vy: 0, main: false })
  }
  return objs
}

function drawSim(ctx: CanvasRenderingContext2D, W: number, H: number, alert: Alert, objs: SimObject[], t: number, night: boolean, camName: string, thermal = false) {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  const pal = thermal ? ['#0b0420', '#1a0b3a', '#2a0f45', '#13072a'] : night ? ['#04130c', '#0a2416', '#0d2e1b', '#051209'] : ['#101b2e', '#17263d', '#1d2a22', '#121a15']
  g.addColorStop(0, pal[0])
  g.addColorStop(0.46, pal[1])
  g.addColorStop(0.47, pal[2])
  g.addColorStop(1, pal[3])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // fence posts
  ctx.strokeStyle = night ? '#1f5a37' : '#4b5563'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, H * 0.41)
  ctx.lineTo(W, H * 0.41)
  ctx.stroke()
  for (let x = W * 0.03; x < W; x += W / 9.4) {
    ctx.beginPath()
    ctx.moveTo(x, H * 0.36)
    ctx.lineTo(x, H * 0.5)
    ctx.stroke()
  }
  // sensor noise (deterministic per frame)
  const rnd = seeded(`${alert.id}:${Math.floor(t * 12)}`)
  ctx.fillStyle = night ? 'rgba(200,255,220,0.07)' : 'rgba(255,255,255,0.05)'
  for (let i = 0; i < 140; i++) ctx.fillRect(rnd() * W, rnd() * H, 1.5, 1.5)

  const fig = thermal ? '#ffd27a' : night ? '#c8ffd9' : '#0b0f16'
  const fs = Math.max(10, W / 48)
  ctx.font = `600 ${fs}px "JetBrains Mono", monospace`
  for (const o of objs) {
    const x = (o.x + o.vx * t) * W
    const y = (o.y + o.vy * t) * H
    const w = o.w * W
    const h = o.h * H
    if (x > W || x + w < 0) continue
    if (thermal) {
      const hg = ctx.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, Math.max(w, h) / 1.5)
      hg.addColorStop(0, 'rgba(255,250,220,0.9)')
      hg.addColorStop(0.5, 'rgba(255,140,40,0.6)')
      hg.addColorStop(1, 'rgba(120,0,120,0)')
      ctx.fillStyle = hg
      ctx.fillRect(x - w * 0.4, y - h * 0.2, w * 1.8, h * 1.4)
    }
    ctx.fillStyle = fig
    if (o.person) {
      const bob = Math.sin(t * 7 + o.x * 10) * h * 0.01
      ctx.beginPath()
      ctx.arc(x + w / 2, y + h * 0.12 + bob, Math.min(w, h) * 0.3, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(x + w * 0.2, y + h * 0.24 + bob, w * 0.6, h * 0.76)
    } else {
      ctx.fillRect(x, y + h * 0.25, w, h * 0.55)
      ctx.fillRect(x + w * 0.18, y, w * 0.55, h * 0.4)
    }
    const alertBox = o.main && Math.abs(t) < 1.5
    ctx.strokeStyle = o.main ? (alertBox ? '#ef4444' : '#38bdf8') : '#facc15'
    ctx.lineWidth = alertBox ? 2.5 : 1.5
    ctx.strokeRect(x - 2, y - 2, w + 4, h + 4)
    if (o.main && alert.trackId !== null) {
      ctx.fillStyle = ctx.strokeStyle
      ctx.fillText(`#${alert.trackId}`, x, y - fs - 2 < 0 ? y + h + 4 : y - fs - 4)
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, H - fs - 8, W, fs + 8)
  ctx.fillStyle = '#e5e7eb'
  ctx.textBaseline = 'top'
  ctx.fillText(`${camName}  ${fmtDateTime(Date.parse(alert.timestamp) + t * 1000)}`, 6, H - fs - 4)
  ctx.textBaseline = 'alphabetic'
}

/**
 * Alert clip player: real <video> when the backend provides one, otherwise a deterministic simulated clip
 * drawn on a canvas (mock mode). Scrubber marks the alert moment (offset 0) and saved bookmarks.
 */
export function ClipPlayer({ alert, compact = false, autoPlay = false, loop = false, className = '' }: { alert: Alert; compact?: boolean; autoPlay?: boolean; loop?: boolean; className?: string }) {
  const t = useT()
  const clip = alert.clip ?? (alert.bbox ? DEFAULT_CLIP : undefined)
  const camera = useData((s) => s.cameras.find((c) => c.id === alert.cameraId))
  const user = useAuth((s) => s.user)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const start = clip?.startOffsetSec ?? -10
  const end = clip?.endOffsetSec ?? 20
  const duration = end - start
  const [pos, setPos] = useState(0) // seconds from clip start
  const [playing, setPlaying] = useState(autoPlay)
  const [rate, setRate] = useState<(typeof RATES)[number]>(1)
  const [marking, setMarking] = useState(false)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const posRef = useRef(pos)
  posRef.current = pos
  const real = !!clip?.url
  const night = camera?.isNightMode ?? false
  const objsRef = useRef<SimObject[]>([])
  useEffect(() => {
    objsRef.current = simObjects(alert)
    // Start just before the alert moment so the operator sees the trigger quickly.
    setPos(Math.max(0, -start - 3))
  }, [alert.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Simulated clip clock.
  useEffect(() => {
    if (real || !clip || !playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * rate
      last = now
      let next = posRef.current + dt
      if (next >= duration) {
        if (loop) next = 0
        else {
          next = duration
          setPlaying(false)
        }
      }
      setPos(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [real, clip, playing, rate, duration, loop])

  // Draw the simulated frame for the current position.
  useEffect(() => {
    if (real) return
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    const W = c.clientWidth || 640
    const H = c.clientHeight || 360
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(H * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawSim(ctx, W, H, alert, objsRef.current, pos + start, night, camera?.name ?? alert.cameraId, camera?.cameraType === 'thermal')
  }, [real, pos, start, alert, night, camera?.name, camera?.cameraType])

  // Real video: mirror its state.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.playbackRate = rate
  }, [rate])
  const seek = (sec: number) => {
    const next = Math.min(duration, Math.max(0, sec))
    setPos(next)
    if (videoRef.current) videoRef.current.currentTime = next
  }
  const toggle = () => {
    const v = videoRef.current
    if (v) void (v.paused ? v.play() : v.pause())
    else {
      if (!playing && pos >= duration) setPos(0)
      setPlaying(!playing)
    }
  }

  const bookmarks = alert.history.filter((h) => h.kind === 'bookmark')
  const saveBookmark = async () => {
    const offsetSec = Math.round((pos + start) * 10) / 10
    try {
      useData.getState().ingest(await service.addAlertHistory(alert.id, { kind: 'bookmark', offsetSec, note: `${offsetSec >= 0 ? '+' : ''}${offsetSec.toFixed(1)} s: ${note.trim() || 'bookmark'}`, by: user?.name ?? 'Operator' }))
      setMsg(t('clip.bookmarked'))
      setNote('')
      setMarking(false)
    } catch {
      setMsg(t('clip.bookmarkFailed'))
    }
  }

  if (!clip) {
    return (
      <div className={`relative bg-black ${className}`}>
        <img src={alert.snapshotUrl} alt="Alert snapshot" className="h-full w-full object-cover" />
        <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-ink-mute">{t('clip.none')}</span>
      </div>
    )
  }

  const pctOf = (sec: number) => `${((sec - start) / duration) * 100}%`
  const rel = pos + start
  return (
    <div className={`flex flex-col bg-black ${className}`}>
      <div className="relative min-h-0 flex-1">
        {real ? (
          <video
            ref={videoRef}
            src={clip.url!}
            muted
            autoPlay={autoPlay}
            loop={loop}
            playsInline
            className="absolute inset-0 h-full w-full object-contain"
            onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" onClick={toggle} />
        )}
        {clip.simulated && (
          <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 font-mono text-[9px] font-bold tracking-wider text-med">{t('clip.simulated')}</span>
        )}
        {Math.abs(rel) < 1.5 && (
          <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-crit px-1.5 font-mono text-[9px] font-bold text-white">{t('clip.alertMoment')}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-base-700 bg-base-900 px-2 py-1">
        <button className="btn btn-sm" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </button>
        <span className="w-14 shrink-0 font-mono text-[10px] text-ink-dim">
          {rel >= 0 ? '+' : ''}
          {rel.toFixed(1)}s
        </span>
        <div
          className="relative h-5 min-w-0 flex-1 cursor-pointer"
          role="slider"
          aria-label="Clip position"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={Math.round(rel)}
          tabIndex={0}
          onKeyDown={(e) => e.key === 'ArrowRight' ? seek(pos + 1) : e.key === 'ArrowLeft' && seek(pos - 1)}
          onPointerDown={(e) => {
            const el = e.currentTarget
            const at = (x: number) => {
              const r = el.getBoundingClientRect()
              seek(((x - r.left) / r.width) * duration)
            }
            at(e.clientX)
            const move = (ev: PointerEvent) => at(ev.clientX)
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded bg-base-700" />
          <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded bg-accent" style={{ width: `${(pos / duration) * 100}%` }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-crit" style={{ left: pctOf(0) }} title={t('clip.alertMoment')} />
          {bookmarks.map((b, i) => (
            <div key={i} className="absolute top-0 h-2 w-2 -translate-x-1/2 rotate-45 bg-med" style={{ left: pctOf(b.offsetSec ?? 0) }} title={b.note} />
          ))}
          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-base-900 bg-ink" style={{ left: `${(pos / duration) * 100}%` }} />
        </div>
        {!compact && (
          <>
            <div className="flex shrink-0 gap-0.5">
              {RATES.map((r) => (
                <button key={r} className={`btn btn-sm px-1.5 font-mono ${rate === r ? 'btn-primary' : ''}`} onClick={() => setRate(r)}>
                  {r}x
                </button>
              ))}
            </div>
            <button className="btn btn-sm shrink-0" onClick={() => { setPlaying(false); videoRef.current?.pause(); setMarking((m) => !m) }}>
              <Bookmark size={12} /> {t('clip.bookmark')}
            </button>
          </>
        )}
      </div>
      {!compact && (marking || msg) && (
        <div className="flex shrink-0 items-center gap-2 border-t border-base-700 bg-base-900 px-2 py-1 text-[11px]">
          {marking ? (
            <>
              <span className="font-mono text-ink-dim">{rel >= 0 ? '+' : ''}{rel.toFixed(1)}s</span>
              <input autoFocus className="field min-w-0 flex-1 py-0.5" placeholder={t('clip.notePh')} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveBookmark()} />
              <button className="btn btn-sm btn-primary" onClick={() => void saveBookmark()}>{t('clip.save')}</button>
            </>
          ) : (
            <span className="text-low">{msg}</span>
          )}
        </div>
      )}
    </div>
  )
}
