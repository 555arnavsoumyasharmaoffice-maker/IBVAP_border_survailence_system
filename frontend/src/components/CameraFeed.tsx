import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Car, Moon, Sun, User, VideoOff } from 'lucide-react'
import type { Camera, DetectionFrame, Zone } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { fmtDateTime, relTime } from '@/lib/format'
import { tripwireArrows } from '@/lib/zones'
import { useT } from '@/i18n'
import { useNow } from './ui'

export interface CameraFeedHandle {
  /** Composite the current frame + overlay into a PNG data URL (null if not possible). */
  snapshot: () => string | null
}

interface Props {
  camera: Camera
  showBoxes?: boolean
  showZones?: boolean
  showTrackIds?: boolean
  /** Hide name/time/count chrome (the parent tile renders its own). */
  bare?: boolean
  /** Hide only the top name/LIVE strip (when the parent tile already shows it). */
  hideTopBar?: boolean
  /** Do not draw this zone (the Zones editor draws its own editable copy). */
  hideZoneId?: string
  className?: string
}

const CLASS_COLOR: Record<string, string> = {
  person: '#38bdf8',
  animal: '#a3e635',
}
const VEHICLE_COLOR = '#facc15'
const EMPTY_ZONES: Zone[] = []

function drawOverlay(
  ctx: CanvasRenderingContext2D, w: number, h: number, frame: DetectionFrame | null, zones: Zone[],
  opts: { boxes: boolean; zones: boolean; ids: boolean },
) {
  ctx.clearRect(0, 0, w, h)
  const fs = Math.max(10, Math.min(13, w / 46))
  ctx.font = `600 ${fs}px "JetBrains Mono", monospace`
  ctx.textBaseline = 'top'

  if (opts.zones) {
    for (const z of zones) {
      if (!z.active || z.points.length < 2) continue
      ctx.beginPath()
      z.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)))
      if (z.type === 'polygon') {
        ctx.closePath()
        ctx.fillStyle = 'rgba(239,68,68,0.14)'
        ctx.fill()
      }
      ctx.strokeStyle = 'rgba(239,68,68,0.9)'
      ctx.lineWidth = z.type === 'line' ? 2.5 : 1.5
      ctx.setLineDash(z.type === 'line' ? [8, 5] : [])
      ctx.stroke()
      ctx.setLineDash([])
      if (z.type === 'line') {
        ctx.lineWidth = 2
        ctx.lineJoin = 'round'
        for (const line of tripwireArrows(z.points, z.direction, w, h, Math.max(14, w / 34))) {
          ctx.beginPath()
          line.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.stroke()
        }
      }
      ctx.fillStyle = 'rgba(254,202,202,0.95)'
      ctx.fillText(z.name.toUpperCase(), z.points[0][0] * w + 4, z.points[0][1] * h + 4)
    }
  }

  if (opts.boxes && frame) {
    for (const d of frame.detections) {
      const [x, y, bw, bh] = [d.bbox[0] * w, d.bbox[1] * h, d.bbox[2] * w, d.bbox[3] * h]
      const color = CLASS_COLOR[d.class] ?? VEHICLE_COLOR
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, bw, bh)
      const label = `${d.class}${opts.ids ? ` #${d.trackId}` : ''} ${Math.round(d.confidence * 100)}%`
      const tw = ctx.measureText(label).width + 8
      const ly = y - fs - 5 < 0 ? y : y - fs - 5
      ctx.fillStyle = color
      ctx.fillRect(x - 1, ly, tw, fs + 5)
      ctx.fillStyle = '#04121f'
      ctx.fillText(label, x + 3, ly + 2)
    }
  }
}

export const CameraFeed = forwardRef<CameraFeedHandle, Props>(function CameraFeed(
  { camera, showBoxes = true, showZones = true, showTrackIds = true, bare = false, hideTopBar = false, hideZoneId, className = '' },
  ref,
) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<DetectionFrame | null>(null)
  const optsRef = useRef({ boxes: showBoxes, zones: showZones, ids: showTrackIds })
  const zones = useData((s) => s.zones)
  const camZones = zones.filter((z) => z.cameraId === camera.id && z.id !== hideZoneId)
  const zonesRef = useRef(EMPTY_ZONES)
  const flashAt = useData((s) => s.flash[camera.id])
  const [counts, setCounts] = useState({ persons: 0, vehicles: 0 })
  const [streamFailed, setStreamFailed] = useState(false)
  const offline = camera.status === 'offline'
  const streamUrl = service.getStreamUrl(camera)

  optsRef.current = { boxes: showBoxes, zones: showZones, ids: showTrackIds }
  zonesRef.current = camZones

  const redraw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawOverlay(ctx, canvas.width / dpr, canvas.height / dpr, frameRef.current, zonesRef.current, optsRef.current)
  }

  // Keep the canvas pixel size in sync with the tile.
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(wrap.clientWidth * dpr)
      canvas.height = Math.round(wrap.clientHeight * dpr)
      redraw()
    })
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [offline])

  useEffect(() => {
    if (offline) return
    frameRef.current = null
    return service.subscribeDetections(camera.id, (frame) => {
      frameRef.current = frame
      redraw()
      let persons = 0
      let vehicles = 0
      for (const d of frame.detections) {
        if (d.class === 'person') persons++
        else if (d.class !== 'animal') vehicles++
      }
      setCounts((c) => (c.persons === persons && c.vehicles === vehicles ? c : { persons, vehicles }))
    })
  }, [camera.id, offline])

  useEffect(redraw)

  useImperativeHandle(ref, () => ({
    snapshot() {
      const overlay = canvasRef.current
      if (!overlay) return null
      try {
        const out = document.createElement('canvas')
        out.width = overlay.width
        out.height = overlay.height
        const ctx = out.getContext('2d')!
        const img = imgRef.current
        if (img && img.naturalWidth) ctx.drawImage(img, 0, 0, out.width, out.height)
        else {
          const g = ctx.createLinearGradient(0, 0, 0, out.height)
          g.addColorStop(0, camera.isNightMode ? '#04130c' : '#101b2e')
          g.addColorStop(0.47, camera.isNightMode ? '#0a2416' : '#17263d')
          g.addColorStop(0.48, camera.isNightMode ? '#0d2e1b' : '#1d2a22')
          g.addColorStop(1, camera.isNightMode ? '#051209' : '#121a15')
          ctx.fillStyle = g
          ctx.fillRect(0, 0, out.width, out.height)
        }
        ctx.drawImage(overlay, 0, 0)
        ctx.font = `${Math.round(out.height / 30)}px monospace`
        ctx.fillStyle = '#fff'
        ctx.fillText(`${camera.name}  ${fmtDateTime(Date.now())}`, 12, out.height - 14)
        return out.toDataURL('image/png')
      } catch {
        return null // cross-origin MJPEG without CORS headers taints the canvas
      }
    },
  }))

  const flashing = flashAt && Date.now() - flashAt < 3000

  if (offline) {
    return (
      <div className={`relative flex flex-col items-center justify-center gap-1 overflow-hidden bg-black text-ink-mute ${className}`}>
        <div className="feed-noise absolute inset-0" />
        <VideoOff size={28} className="text-crit" />
        <div className="font-mono text-sm font-semibold tracking-widest text-crit">{t('feed.signalLost')}</div>
        <div className="font-mono text-[11px]">
          {t('feed.lastSeen')}: {fmtDateTime(camera.lastSeen)} ({relTime(camera.lastSeen)})
        </div>
        {!bare && !hideTopBar && <div className="absolute top-1.5 left-2 font-mono text-[11px] text-ink-dim">{camera.name}</div>}
      </div>
    )
  }

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-black ${className}`}>
      {streamUrl && !streamFailed ? (
        <img ref={imgRef} src={streamUrl} alt={camera.name} crossOrigin="anonymous" onError={() => setStreamFailed(true)} className="absolute inset-0 h-full w-full object-fill" />
      ) : (
        <div className={`feed-mock absolute inset-0 ${camera.isNightMode ? 'night' : ''}`}>
          <div className="feed-noise absolute inset-0" />
          <div className="feed-lines absolute inset-0" />
          <div className="feed-scan absolute inset-x-0 top-0" />
          {streamUrl && streamFailed && (
            <div className="absolute inset-x-0 top-1/2 text-center font-mono text-[11px] text-high">STREAM UNAVAILABLE - retrying</div>
          )}
        </div>
      )}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {!bare && <FeedChrome camera={camera} counts={counts} topBar={!hideTopBar} />}
      {/* keyed so the flash animation restarts for every new alert on this camera */}
      {flashing && <div key={flashAt} className="feed-flash pointer-events-none absolute inset-0" />}
    </div>
  )
})

function FeedChrome({ camera, counts, topBar }: { camera: Camera; counts: { persons: number; vehicles: number }; topBar: boolean }) {
  const t = useT()
  const now = useNow(1000)
  return (
    <>
      {topBar && (
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/75 to-transparent px-2 pt-1.5 pb-3">
        <span className="truncate font-mono text-[11px] font-semibold text-white">{camera.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {camera.isNightMode ? <Moon size={12} className="text-indigo-300" /> : <Sun size={12} className="text-amber-300" />}
          {camera.status === 'degraded' && <span className="rounded bg-med px-1 text-[9px] font-bold text-black">DEGRADED</span>}
          <span className="flex items-center gap-1 rounded bg-crit px-1.5 text-[9px] font-bold tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
            {t('feed.live')}
          </span>
        </span>
      </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pt-3 pb-1 font-mono text-[10px] text-white/90">
        <span>{fmtDateTime(now)}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-0.5"><User size={11} />{counts.persons}</span>
          <span className="flex items-center gap-0.5"><Car size={11} />{counts.vehicles}</span>
          <span>{camera.fps} FPS</span>
        </span>
      </div>
    </>
  )
}
