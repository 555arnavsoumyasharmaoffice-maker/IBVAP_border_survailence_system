import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Car, Crosshair, Eye, Moon, Radio, Sun, User, VideoOff, ZoomIn } from 'lucide-react'
import type { Camera, DetectionFrame, Zone } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { DEGRADED_REASON, fmtDateTime, isLowVisibility, relTime } from '@/lib/format'
import { tripwireArrows } from '@/lib/zones'
import { latLngToMGRS } from '@/lib/geo'
import { useT } from '@/i18n'
import { useNow } from './ui'

export interface CameraFeedHandle {
  /** Composite the current frame + overlay into a PNG data URL (null if not possible). */
  snapshot: () => string | null
}

export type VisionMode = 'normal' | 'flir' | 'nvg' | 'defog'

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
  /** Initial vision mode (defaults to flir if cameraType is thermal, else normal) */
  initialVisionMode?: VisionMode
  /** When true, actively loads and renders the heavy live stream. When false, stays in low-memory standby mode. */
  active?: boolean
  /** Callback fired when user clicks to engage live monitoring */
  onEngage?: () => void
}

const CLASS_COLOR: Record<string, string> = {
  person: '#38bdf8',
  animal: '#a3e635',
  drone: '#f97316',
  car: '#facc15',
  bus: '#ec4899',
  truck: '#fb923c',
  tempo: '#06b6d4',
  motorcycle: '#c084fc',
  bicycle: '#10b981',
  auto_rickshaw: '#22c55e',
  tractor: '#eab308',
  jeep: '#06b6d4',
  tank: '#ef4444',
}
const VEHICLE_COLOR = '#facc15'
const EMPTY_ZONES: Zone[] = []

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  frame: DetectionFrame | null,
  zones: Zone[],
  opts: {
    boxes: boolean
    zones: boolean
    ids: boolean
    thermal?: boolean
    hud?: boolean
    camera?: Camera
    visionMode?: VisionMode
    zoom?: number
  },
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

  if (opts.thermal && frame) {
    for (const d of frame.detections) {
      const [x, y, bw, bh] = [d.bbox[0] * w, d.bbox[1] * h, d.bbox[2] * w, d.bbox[3] * h]
      const g = ctx.createRadialGradient(x + bw / 2, y + bh / 2, 1, x + bw / 2, y + bh / 2, Math.max(bw, bh) / 1.6)
      g.addColorStop(0, 'rgba(255,250,220,0.95)')
      g.addColorStop(0.35, 'rgba(255,170,40,0.85)')
      g.addColorStop(0.7, 'rgba(220,40,90,0.45)')
      g.addColorStop(1, 'rgba(80,0,120,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.ellipse(x + bw / 2, y + bh / 2, bw / 1.6, bh / 1.8, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (opts.boxes && frame) {
    for (const d of frame.detections) {
      const [x, y, bw, bh] = [d.bbox[0] * w, d.bbox[1] * h, d.bbox[2] * w, d.bbox[3] * h]
      const color = CLASS_COLOR[d.class] ?? VEHICLE_COLOR
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, bw, bh)
      const baseName = d.label || (d.class === 'tank' ? 'COMBAT TANK [DRDO ZORAWAR]' : d.class.replace('_', ' ').toUpperCase())
      const label = `${baseName}${opts.ids ? ` #${d.trackId}` : ''} ${Math.round(d.confidence * 100)}%`
      const tw = ctx.measureText(label).width + 8
      const ly = y - fs - 5 < 0 ? y : y - fs - 5
      ctx.fillStyle = color
      ctx.fillRect(x - 1, ly, tw, fs + 5)
      ctx.fillStyle = '#04121f'
      ctx.fillText(label, x + 3, ly + 2)
    }
  }

  // --- Tactical Military Reticle HUD ---
  if (opts.hud) {
    const isNvg = opts.visionMode === 'nvg'
    const isFlir = opts.visionMode === 'flir'
    const hudCol = isNvg ? 'rgba(52, 211, 153, 0.75)' : isFlir ? 'rgba(251, 146, 60, 0.75)' : 'rgba(56, 189, 248, 0.7)'
    ctx.strokeStyle = hudCol
    ctx.lineWidth = 1.2

    // 1. Four corner mil-spec brackets
    const bLen = Math.min(20, Math.max(12, w / 22))
    const m = 10
    // Top-left
    ctx.beginPath(); ctx.moveTo(m, m + bLen); ctx.lineTo(m, m); ctx.lineTo(m + bLen, m); ctx.stroke()
    // Top-right
    ctx.beginPath(); ctx.moveTo(w - m - bLen, m); ctx.lineTo(w - m, m); ctx.lineTo(w - m, m + bLen); ctx.stroke()
    // Bottom-left
    ctx.beginPath(); ctx.moveTo(m, h - m - bLen); ctx.lineTo(m, h - m); ctx.lineTo(m + bLen, h - m); ctx.stroke()
    // Bottom-right
    ctx.beginPath(); ctx.moveTo(w - m - bLen, h - m); ctx.lineTo(w - m, h - m); ctx.lineTo(w - m, h - m - bLen); ctx.stroke()

    // 2. Center Crosshair with Mil-Dot Stadia Marks
    const cx = w / 2, cy = h / 2
    ctx.beginPath()
    ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 4, cy)
    ctx.moveTo(cx + 4, cy); ctx.lineTo(cx + 18, cy)
    ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 4)
    ctx.moveTo(cx, cy + 4); ctx.lineTo(cx, cy + 18)
    ctx.stroke()
    // Center ring & dots
    ctx.fillStyle = hudCol
    ctx.fillRect(cx - 1, cy - 1, 2, 2)
    ctx.fillRect(cx - 9, cy - 1, 2, 2)
    ctx.fillRect(cx + 7, cy - 1, 2, 2)
    ctx.fillRect(cx - 1, cy - 9, 2, 2)
    ctx.fillRect(cx - 1, cy + 7, 2, 2)

    // 3. MGRS & Rangefinder Telemetry readout
    const smallFs = Math.max(8.5, Math.min(10.5, w / 52))
    ctx.font = `500 ${smallFs}px "JetBrains Mono", monospace`
    ctx.fillStyle = hudCol

    if (opts.camera && w > 160) {
      const mgrsStr = latLngToMGRS(opts.camera.lat, opts.camera.lng)
      ctx.fillText(`MGRS: ${mgrsStr}`, m + 4, m + bLen + 4)
      ctx.fillText(`HDG: 042° NNE | EL: -02.4°`, m + 4, m + bLen + 4 + smallFs + 2)
    }

    if (w > 180 && h > 120) {
      const rangeText = `L-RF: 140m [LOCK] | STAB: ON`
      ctx.fillText(rangeText, m + 4, h - m - bLen - smallFs - 4)
    }
  }
}

export const CameraFeed = forwardRef<CameraFeedHandle, Props>(function CameraFeed(
  {
    camera,
    showBoxes = true,
    showZones = true,
    showTrackIds = true,
    bare = false,
    hideTopBar = false,
    hideZoneId,
    className = '',
    initialVisionMode,
    active = true,
    onEngage,
  },
  ref,
) {
  const t = useT()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<DetectionFrame | null>(null)
  const [visionMode, setVisionMode] = useState<VisionMode>(
    initialVisionMode || (camera.cameraType === 'thermal' ? 'flir' : 'normal'),
  )
  const [zoom, setZoom] = useState<1 | 2 | 4>(1)
  const [showHud, setShowHud] = useState(true)
  const [thermalPalette, setThermalPalette] = useState<'ironbow' | 'white-hot' | 'black-hot' | 'amber'>('ironbow')
  const [uavJammed, setUavJammed] = useState(false)

  const changeThermalPalette = async (pal: 'ironbow' | 'white-hot' | 'black-hot' | 'amber') => {
    setThermalPalette(pal)
    try {
      await service.setThermalPalette(camera.id, pal)
    } catch (e) {
      console.error(e)
    }
  }

  const toggleDroneJam = async () => {
    const next = !uavJammed
    setUavJammed(next)
    try {
      await service.triggerDroneJam(camera.id, next)
    } catch (e) {
      console.error(e)
    }
  }

  const optsRef = useRef<{
    boxes: boolean
    zones: boolean
    ids: boolean
    thermal?: boolean
    hud?: boolean
    camera?: Camera
    visionMode?: VisionMode
    zoom?: number
  }>({
    boxes: showBoxes,
    zones: showZones,
    ids: showTrackIds,
    hud: showHud,
    camera,
    visionMode,
    zoom,
  })

  const zones = useData((s) => s.zones)
  const camZones = zones.filter((z) => z.cameraId === camera.id && z.id !== hideZoneId)
  const zonesRef = useRef(EMPTY_ZONES)
  const flashAt = useData((s) => s.flash[camera.id])
  const [counts, setCounts] = useState({ persons: 0, vehicles: 0 })
  const [streamFailed, setStreamFailed] = useState(false)
  const offline = camera.status === 'offline'
  const streamUrl = service.getStreamUrl(camera)
  const hasLiveStream = !!streamUrl && !streamFailed

  useEffect(() => {
    setStreamFailed(false)
  }, [camera.id, active, streamUrl])

  useEffect(() => {
    if (!streamFailed) return
    const timer = setTimeout(() => {
      setStreamFailed(false)
    }, 2500)
    return () => clearTimeout(timer)
  }, [streamFailed])

  optsRef.current = {
    boxes: showBoxes && !hasLiveStream,
    zones: showZones,
    ids: showTrackIds && !hasLiveStream,
    thermal: (visionMode === 'flir' || camera.cameraType === 'thermal') && !streamUrl,
    hud: showHud,
    camera,
    visionMode,
    zoom,
  }
  zonesRef.current = camZones

  const redraw = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawOverlay(
      ctx,
      canvas.width / dpr,
      canvas.height / dpr,
      frameRef.current,
      zonesRef.current,
      optsRef.current,
    )
  }

  // Keep canvas pixel size in sync with tile
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

  useEffect(redraw, [visionMode, zoom, showHud])

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
        if (img && img.naturalWidth) {
          try {
            ctx.drawImage(img, 0, 0, out.width, out.height)
          } catch {
            // cross-origin tainted canvas fallback: draw background gradient
            const g = ctx.createLinearGradient(0, 0, 0, out.height)
            g.addColorStop(0, camera.isNightMode ? '#04130c' : '#101b2e')
            g.addColorStop(1, camera.isNightMode ? '#051209' : '#121a15')
            ctx.fillStyle = g
            ctx.fillRect(0, 0, out.width, out.height)
          }
        } else {
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
        ctx.fillText(`${camera.name}  ${fmtDateTime(Date.now())} [OPTIC: ${visionMode.toUpperCase()}]`, 12, out.height - 14)
        return out.toDataURL('image/png')
      } catch {
        return null
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

  const visionClass =
    visionMode === 'flir'
      ? 'vision-flir'
      : visionMode === 'nvg'
      ? 'vision-nvg'
      : visionMode === 'defog'
      ? 'vision-defog'
      : ''

  const overlayEffectClass =
    visionMode === 'flir' ? 'flir-overlay' : visionMode === 'nvg' ? 'nvg-overlay' : ''

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-black ${overlayEffectClass} ${className}`}>
      {/* Video stream container with digital zoom */}
      <div
        className="absolute inset-0 h-full w-full overflow-hidden transition-transform duration-200"
        style={{
          transform: zoom > 1 ? `scale(${zoom})` : 'none',
          transformOrigin: 'center center',
        }}
      >
        {active && streamUrl && !streamFailed ? (
          <img
            ref={imgRef}
            src={streamUrl}
            alt={camera.name}
            onError={() => setStreamFailed(true)}
            className={`h-full w-full object-fill ${visionClass}`}
          />
        ) : (
          <div
            className={`feed-mock absolute inset-0 ${
              visionMode === 'flir' || camera.cameraType === 'thermal'
                ? 'thermal'
                : visionMode === 'nvg' || camera.isNightMode
                ? 'night'
                : ''
            } ${visionClass}`}
          >
            <div className="feed-noise absolute inset-0" />
            <div className="feed-lines absolute inset-0" />
            <div className="feed-scan absolute inset-x-0 top-0" />
            {!active && (
              <div
                onClick={(e) => { e.stopPropagation(); onEngage?.() }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center cursor-pointer bg-black/60 hover:bg-black/40 transition-all p-2 select-none group"
              >
                <div className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg bg-black/90 border border-cyan-500/50 text-cyan-300 font-mono text-[11px] shadow-[0_0_15px_rgba(6,182,212,0.3)] group-hover:border-cyan-400 group-hover:scale-105 group-hover:text-white transition-all">
                  <Radio size={14} className="text-cyan-400 animate-pulse" />
                  <span className="font-bold tracking-wider">CLICK TO MONITOR</span>
                  <span className="text-[9px] text-cyan-400/70 font-sans">Power-Save Standby</span>
                </div>
              </div>
            )}
            {active && streamUrl && streamFailed && (
              <div className="absolute inset-x-0 top-1/2 text-center font-mono text-[11px] text-high">
                STREAM UNAVAILABLE - retrying
              </div>
            )}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {!bare && (
        <FeedChrome
          camera={camera}
          counts={counts}
          topBar={!hideTopBar}
          visionMode={visionMode}
          zoom={zoom}
        />
      )}

      {/* Floating Tactical Optics Toolbar */}
      {!bare && (
        <div className="absolute top-7 right-1.5 z-20 flex items-center gap-1 rounded border border-base-700/80 bg-base-950/85 px-1.5 py-0.5 backdrop-blur-sm shadow-md">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setVisionMode((m) =>
                m === 'normal' ? 'flir' : m === 'flir' ? 'nvg' : m === 'nvg' ? 'defog' : 'normal',
              )
            }}
            title="Cycle Optics Vision: Standard / Thermal FLIR / Gen-3 NVG / Atmospheric De-Haze"
            className={`flex items-center gap-0.5 px-1 py-0.5 font-mono text-[9px] font-bold tracking-wider rounded transition-colors ${
              visionMode === 'flir'
                ? 'bg-rose-950/90 text-rose-300 border border-rose-500/60'
                : visionMode === 'nvg'
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/60'
                : visionMode === 'defog'
                ? 'bg-amber-950/90 text-amber-300 border border-amber-500/60'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <Eye size={10} className="shrink-0" />
            {visionMode === 'normal' ? 'VIS' : visionMode.toUpperCase()}
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              setZoom((z) => (z === 1 ? 2 : z === 2 ? 4 : 1))
            }}
            title="Cycle Digital Pan-Zoom: 1x / 2x / 4x"
            className={`flex items-center gap-0.5 px-1 py-0.5 font-mono text-[9px] font-bold rounded transition-colors ${
              zoom > 1
                ? 'bg-accent/25 text-accent border border-accent/50'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <ZoomIn size={10} className="shrink-0" />
            {zoom}x
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowHud((h) => !h)
            }}
            title="Toggle Tactical MGRS and Mil-Spec HUD Reticle"
            className={`flex items-center gap-0.5 px-1 py-0.5 font-mono text-[9px] font-bold rounded transition-colors ${
              showHud
                ? 'bg-sky-950/90 text-sky-300 border border-sky-500/60'
                : 'text-ink-mute hover:text-ink'
            }`}
          >
            <Crosshair size={10} className="shrink-0" />
            HUD
          </button>

          {/* C-UAS Electronic Warfare RF Jammer Toggle */}
          {(camera.id === 'cam-03' || camera.name.toLowerCase().includes('drone') || camera.name.toLowerCase().includes('uav')) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void toggleDroneJam()
              }}
              title="Activate C-UAS Electronic Warfare RF Directional Jammer"
              className={`flex items-center gap-0.5 px-1.5 py-0.5 font-mono text-[9px] font-bold rounded transition-colors ${
                uavJammed
                  ? 'bg-amber-500 text-black font-black animate-pulse shadow-md shadow-amber-500/50'
                  : 'bg-red-950/90 text-red-300 border border-red-500/70 hover:bg-red-900/70'
              }`}
            >
              <Radio size={10} className="shrink-0" />
              {uavJammed ? 'JAM ACTIVE' : '⚡ JAM UAV'}
            </button>
          )}

          {/* Thermal Dynamic Palette Selector */}
          {(camera.cameraType === 'thermal' || visionMode === 'flir') && (
            <div className="flex items-center gap-0.5 border-l border-base-700/60 pl-1">
              {(['ironbow', 'white-hot', 'black-hot', 'amber'] as const).map((p) => (
                <button
                  key={p}
                  onClick={(e) => {
                    e.stopPropagation()
                    void changeThermalPalette(p)
                  }}
                  title={`Thermal palette: ${p}`}
                  className={`px-1 py-0.5 font-mono text-[8px] font-bold uppercase rounded transition-colors ${
                    thermalPalette === p
                      ? 'bg-rose-950/90 text-rose-300 border border-rose-500/80'
                      : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  {p === 'ironbow' ? 'IRON' : p === 'white-hot' ? 'W-HOT' : p === 'black-hot' ? 'B-HOT' : 'AMBER'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {isLowVisibility(camera.visibility) && !camera.outOfService && (
        <span className="pointer-events-none absolute top-14 left-1.5 rounded bg-med/90 px-1 font-mono text-[9px] font-bold text-black uppercase">
          {t('feed.aiDegraded')} ({DEGRADED_REASON[camera.visibility]})
        </span>
      )}

      {camera.outOfService && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 bg-black/70 py-1.5 text-center font-mono text-[11px] text-med">
          <div className="font-bold tracking-widest">{t('oos.tile')}</div>
          <div className="truncate px-2 text-[10px] text-ink-dim">
            {camera.outOfService.reason} · {camera.outOfService.by}
          </div>
        </div>
      )}

      {!streamUrl && (
        <span className="pointer-events-none absolute right-1.5 bottom-6 rounded bg-black/60 px-1 font-mono text-[8px] font-bold tracking-wider text-med">
          {t('feed.simulated')}
        </span>
      )}

      {/* Flashing alert frame */}
      {flashing && <div key={flashAt} className="feed-flash pointer-events-none absolute inset-0" />}
    </div>
  )
})

function FeedChrome({
  camera,
  counts,
  topBar,
  visionMode,
  zoom,
}: {
  camera: Camera
  counts: { persons: number; vehicles: number }
  topBar: boolean
  visionMode: VisionMode
  zoom: number
}) {
  const t = useT()
  const now = useNow(1000)
  return (
    <>
      {topBar && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent px-2 pt-1.5 pb-3">
          <span className="truncate font-mono text-[11px] font-semibold text-white">{camera.name}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {camera.isNightMode ? (
              <Moon size={12} className="text-indigo-300" />
            ) : (
              <Sun size={12} className="text-amber-300" />
            )}
            {camera.status === 'degraded' && (
              <span className="rounded bg-med px-1 text-[9px] font-bold text-black">DEGRADED</span>
            )}
            <span className="flex items-center gap-1 rounded bg-crit px-1.5 text-[9px] font-bold tracking-wider text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              {t('feed.live')}
            </span>
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-2 pt-3 pb-1 font-mono text-[10px] text-white/90">
        <span>{fmtDateTime(now)}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-0.5">
            <User size={11} />
            {counts.persons}
          </span>
          <span className="flex items-center gap-0.5">
            <Car size={11} />
            {counts.vehicles}
          </span>
          <span>{camera.fps} FPS</span>
          {zoom > 1 && <span className="rounded bg-accent/20 px-1 text-[9px] text-accent">{zoom}X</span>}
          {visionMode !== 'normal' && (
            <span className="rounded bg-base-800 px-1 text-[9px] font-bold uppercase text-ink">
              {visionMode}
            </span>
          )}
        </span>
      </div>
    </>
  )
}
