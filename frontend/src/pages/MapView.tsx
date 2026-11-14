import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L, { type LatLngTuple, type Marker as LeafletMarker } from 'leaflet'
import { Drone, Flame, Maximize2, Navigation, Radio, ScanLine, ShieldAlert, WifiOff, X } from 'lucide-react'
import type { Alert, AlertType, Camera, DroneWatch } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'
import { audit } from '@/lib/audit'
import { bearingDeg, distanceKm } from '@/lib/geo'
import { fmtLeft, nearbyNakas, useActiveWatches } from '@/components/DroneWatch'
import { HierarchyTree } from '@/components/HierarchyTree'
import { useData } from '@/store/data'
import { ALERT_TYPES, SEV, SEVERITIES, fmtTime, keyDetail, relTime } from '@/lib/format'
import { BORDER_LINE } from '@/lib/border'
import { useT } from '@/i18n'
import { TILE_ATTR, TILE_URL } from '@/components/MiniMap'
import { CameraFeed } from '@/components/CameraFeed'
import { EmptyState, SeverityBadge, SkeletonRows, useNow } from '@/components/ui'

const STATUS_COLOR = { online: '#22c55e', degraded: '#f5b40b', offline: '#64748b' } as const
const WINDOWS = [
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '6h', label: '6 h', ms: 6 * 3_600_000 },
  { id: '24h', label: '24 h', ms: 24 * 3_600_000 },
] as const
type WindowId = (typeof WINDOWS)[number]['id']
/** How long a marker keeps pulsing after an alert arrives. */
const PULSE_MS = 45_000

// Tactical UAV Patrol Circuit Waypoints
const UAV_WAYPOINTS: [number, number][] = [
  [28.78, 72.10],
  [28.65, 72.32],
  [28.48, 72.48],
  [28.52, 72.22],
  [28.78, 72.10],
]

function getUavPos(nowMs: number): { lat: number; lng: number; heading: number } {
  const period = 60_000 // 60s loop
  const progress = (nowMs % period) / period
  const totalSegments = UAV_WAYPOINTS.length - 1
  const segProgress = progress * totalSegments
  const idx = Math.floor(segProgress)
  const t = segProgress - idx
  const p1 = UAV_WAYPOINTS[idx]
  const p2 = UAV_WAYPOINTS[idx + 1] || UAV_WAYPOINTS[0]
  const lat = p1[0] + (p2[0] - p1[0]) * t
  const lng = p1[1] + (p2[1] - p1[1]) * t
  const heading = bearingDeg(p1[0], p1[1], p2[0], p2[1])
  return { lat, lng, heading }
}

function uavIcon(heading: number) {
  return L.divIcon({
    className: '',
    html: `<div style="transform: rotate(${heading}deg); width:28px; height:28px; display:flex; align-items:center; justify-content:center; background:#082f49; border:2px solid #38bdf8; border-radius:50%; box-shadow:0 0 10px rgba(56,189,248,0.8);">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="m12 2 4 8-4-2-4 2Z"/>
        <path d="M12 10v12"/>
        <path d="m4 14 8-4 8 4"/>
      </svg>
    </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

// Icons are cached so Leaflet does not rebuild the marker element on every render.
const iconCache = new Map<string, L.DivIcon>()
function pinIcon(color: string, pulse?: string, inWatch = false) {
  const key = `${color}|${pulse ?? ''}|${inWatch}`
  let icon = iconCache.get(key)
  if (!icon) {
    icon = L.divIcon({
      className: '',
      html: `<div class="cam-pin ${pulse ? 'alerting' : ''} ${inWatch ? 'in-watch' : ''}" style="background:${pulse ?? color};--pulse:${pulse ?? 'transparent'}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      popupAnchor: [0, -10],
    })
    iconCache.set(key, icon)
  }
  return icon
}

function nakaIcon(inside: boolean) {
  const key = `naka|${inside}`
  let icon = iconCache.get(key)
  if (!icon) {
    icon = L.divIcon({ className: '', html: `<div class="naka-pin ${inside ? 'inside' : ''}"></div>`, iconSize: [11, 11], iconAnchor: [6, 6] })
    iconCache.set(key, icon)
  }
  return icon
}

function MapClick({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) })
  return null
}

function FlyToPoint({ point }: { point?: { lat: number; lng: number; key: string } }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lng], 12, { duration: 1.2 })
  }, [point?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

const RADII = [1, 2, 5] as const
const DURATIONS = [2, 4, 6] as const

/** Drone-sighting tool: place a point, pick radius + duration, start a watch. */
function DronePanel({ draft, linkedAlertId, onCancel, onDone }: {
  draft: { lat: number; lng: number } | null
  linkedAlertId: string | null
  onCancel: () => void
  onDone: (w: DroneWatch) => void
}) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const [radiusKm, setRadius] = useState<DroneWatch['radiusKm']>(2)
  const [durationH, setDuration] = useState<number>(4)
  const [reason, setReason] = useState(linkedAlertId ? `Drone sighting ${linkedAlertId}` : 'Drone sighting reported by post')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const start = async () => {
    if (!draft) return
    setBusy(true)
    setErr('')
    try {
      const w = await service.createDroneWatch({ lat: draft.lat, lng: draft.lng, radiusKm, durationH, reason, linkedAlertId, createdBy: user?.name ?? 'Operator' })
      audit('DRONE', 'Drone watch started', w.id, `${radiusKm} km for ${durationH} h at ${draft.lat.toFixed(4)}, ${draft.lng.toFixed(4)}${linkedAlertId ? `, alert ${linkedAlertId}` : ''}`)
      await useData.getState().refreshWatches()
      onDone(w)
    } catch {
      setErr('Not started: backend not reachable')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2 border-b border-accent/40 bg-accent/5 p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Drone size={14} className="text-accent" />
        <span className="panel-title text-accent">{t('drone.mark')}</span>
        <button className="ml-auto text-ink-mute hover:text-ink" aria-label="Cancel" onClick={onCancel}>
          <X size={14} />
        </button>
      </div>
      {!draft ? (
        <div className="text-ink-dim">{t('drone.clickMap')}</div>
      ) : (
        <>
          <div className="font-mono text-[10px] text-ink-dim">
            {draft.lat.toFixed(4)}, {draft.lng.toFixed(4)}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-ink-mute">{t('drone.radius')}</span>
            {RADII.map((r) => (
              <button key={r} className={`btn btn-sm font-mono ${radiusKm === r ? 'btn-primary' : ''}`} onClick={() => setRadius(r)}>
                {r} km
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-ink-mute">{t('drone.duration')}</span>
            {DURATIONS.map((d) => (
              <button key={d} className={`btn btn-sm font-mono ${durationH === d ? 'btn-primary' : ''}`} onClick={() => setDuration(d)}>
                {d} h
              </button>
            ))}
          </div>
          <input className="field w-full" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('drone.reason')} />
          <button className="btn btn-primary w-full" disabled={busy || !reason.trim()} onClick={() => void start()}>
            <Drone size={13} /> {t('drone.start')}
          </button>
          {err && <div className="text-crit">{err}</div>}
        </>
      )}
    </div>
  )
}

/** Active watch: countdown, cameras / ANPR points inside, nearby nakas. */
function WatchInfo({ watch, cameras, now }: { watch: DroneWatch; cameras: Camera[]; now: number }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const nakas = useData((s) => s.nakas)
  const inside = cameras.filter((c) => distanceKm(c.lat, c.lng, watch.lat, watch.lng) <= watch.radiusKm)
  const near = nearbyNakas(nakas, watch.lat, watch.lng, watch)
  const end = async () => {
    try {
      await service.endDroneWatch(watch.id, user?.name ?? 'Operator')
      audit('DRONE', 'Drone watch ended', watch.id, 'ended early by operator')
      await useData.getState().refreshWatches()
    } catch {
      /* link down: the watch stays active */
    }
  }
  return (
    <div className="space-y-1.5 border-b border-accent/40 bg-accent/5 p-2 text-xs">
      <div className="flex items-center gap-1.5">
        <Drone size={14} className="animate-pulse text-accent" />
        <span className="font-semibold text-accent">
          {t('drone.active')} {watch.radiusKm} km
        </span>
        <span className="font-mono text-[11px]">
          {fmtLeft(Date.parse(watch.expiresAt) - now)} {t('drone.left')}
        </span>
        <button className="btn btn-sm ml-auto" onClick={() => void end()}>
          {t('drone.end')}
        </button>
      </div>
      <div className="truncate text-[11px] text-ink-dim" title={watch.reason}>
        {watch.reason}
        {watch.linkedAlertId && (
          <>
            {' · '}
            <Link to={`/alerts/${watch.linkedAlertId}`}>{watch.linkedAlertId}</Link>
          </>
        )}
      </div>
      <div>
        <div className="text-[10px] tracking-wide text-ink-mute uppercase">{t('drone.camsInside')}</div>
        {inside.length ? (
          inside.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 truncate">
              <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
              <span className="truncate">{c.name}</span>
              {c.modules.anpr && <ScanLine size={11} className="shrink-0 text-accent" aria-label="ANPR" />}
            </div>
          ))
        ) : (
          <div className="text-ink-mute">-</div>
        )}
      </div>
      <div>
        <div className="text-[10px] tracking-wide text-ink-mute uppercase">{t('drone.nakas')}</div>
        {near.map((n) => (
          <div key={n.id} className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rotate-45 ${n.inside ? 'bg-accent' : 'bg-blue-900 ring-1 ring-blue-300'}`} />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            {n.inside && <span className="text-[9px] font-semibold text-accent uppercase">{t('drone.inside')}</span>}
            <span className="font-mono text-[10px] text-ink-mute">{n.km.toFixed(1)} km</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FitCameras({ cameras }: { cameras: Camera[] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !cameras.length) return
    done.current = true
    map.fitBounds(cameras.map((c) => [c.lat, c.lng] as LatLngTuple), { padding: [60, 60] })
  }, [cameras, map])
  return null
}

function FlyTo({ camera }: { camera?: Camera }) {
  const map = useMap()
  useEffect(() => {
    if (camera) map.flyTo([camera.lat, camera.lng], 11, { duration: 1.2 })
  }, [camera?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

interface CamStats {
  count: number
  latest?: Alert
}

function CameraPopup({ camera, stats, now }: { camera: Camera; stats: CamStats; now: number }) {
  const t = useT()
  const a = stats.latest
  return (
    <div className="w-56">
      <div className="font-semibold">{camera.name}</div>
      <div className="text-[11px] text-ink-dim">{camera.locationName}</div>
      <div className="mt-0.5 font-mono text-[10px] text-ink-mute">
        {camera.status.toUpperCase()} · {camera.fps} FPS · {stats.count} alert(s) in window
      </div>
      {a ? (
        <div className="mt-2 border-t border-base-600 pt-2">
          <div className="flex items-center gap-1.5">
            <SeverityBadge severity={a.severity} />
            <span className="truncate text-xs font-semibold">{t(`type.${a.type}`)}</span>
          </div>
          <div className="mt-1 flex gap-2">
            <img src={a.snapshotUrl} alt="" className="h-12 w-20 shrink-0 rounded-sm border border-base-600 object-cover" />
            <div className="min-w-0 text-[11px]">
              <div className="font-mono text-ink-dim">
                {fmtTime(a.timestamp)} ({relTime(a.timestamp, now)})
              </div>
              <div className="truncate font-mono">{keyDetail(a)}</div>
            </div>
          </div>
          <div className="mt-1.5 flex justify-between text-[11px]">
            <Link to={`/alerts/${a.id}`}>View alert →</Link>
            <Link to={`/cameras?cam=${camera.id}`}>{t('act.viewCamera')}</Link>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 text-[11px]">
          <span className="text-ink-mute">No alerts in this window. </span>
          <Link to={`/cameras?cam=${camera.id}`}>{t('act.viewCamera')} →</Link>
        </div>
      )}
    </div>
  )
}

export default function MapView() {
  const t = useT()
  const now = useNow(1000)
  const [params, setParams] = useSearchParams()
  const { cameras, alerts, loading } = useData()
  const nakas = useData((s) => s.nakas)
  const activeWatches = useActiveWatches()
  const linkedAlertId = params.get('drone')
  const watchParam = params.get('watch')
  const [marking, setMarking] = useState(!!linkedAlertId)
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null)
  const [flyPoint, setFlyPoint] = useState<{ lat: number; lng: number; key: string }>()
  const focusWatch = activeWatches.find((w) => w.id === watchParam) ?? activeWatches[0]

  // Tactical War Room Layer Controls
  const [showUav, setShowUav] = useState(true)
  const [showEwJammer, setShowEwJammer] = useState(true)
  const [showVectors, setShowVectors] = useState(true)

  const uavPos = useMemo(() => getUavPos(now), [now])

  useEffect(() => {
    const w = activeWatches.find((x) => x.id === watchParam)
    if (w) setFlyPoint({ lat: w.lat, lng: w.lng, key: w.id })
  }, [watchParam, activeWatches])
  const inWatch = (lat: number, lng: number) => activeWatches.some((w) => distanceKm(lat, lng, w.lat, w.lng) <= w.radiusKm)
  const [type, setType] = useState<AlertType | ''>('')
  const [win, setWin] = useState<WindowId>('24h')
  const [heat, setHeat] = useState(false)
  const [tiles, setTiles] = useState({ ok: 0, err: 0 })
  const markers = useRef<Record<string, LeafletMarker>>({})
  const selected = cameras.find((c) => c.id === params.get('cam'))
  const tilesOffline = tiles.err > tiles.ok

  // Per-camera stats for the selected alert type + time window (alerts are newest-first).
  const { stats, max } = useMemo(() => {
    const ms = WINDOWS.find((w) => w.id === win)!.ms
    const out: Record<string, CamStats> = {}
    for (const a of alerts) {
      if (now - Date.parse(a.timestamp) > ms) break
      if (type && a.type !== type) continue
      const s = (out[a.cameraId] ??= { count: 0 })
      s.count++
      s.latest ??= a
    }
    return { stats: out, max: Math.max(1, ...Object.values(out).map((s) => s.count)) }
  }, [alerts, type, win, now])

  // A marker pulses in the severity colour while its newest alert is fresh.
  const pulse = useMemo(() => {
    const out: Record<string, string> = {}
    for (const a of alerts) {
      if (now - Date.parse(a.timestamp) > PULSE_MS) break
      if (type && a.type !== type) continue
      out[a.cameraId] ??= SEV[a.severity].hex
    }
    return out
  }, [alerts, type, now])

  // Open the popup of the camera that just raised a new alert.
  const newest = alerts[0]
  const lastSeen = useRef(newest?.id)
  useEffect(() => {
    if (!newest || newest.id === lastSeen.current) return
    const first = lastSeen.current === undefined
    lastSeen.current = newest.id
    if (first || newest.status !== 'NEW' || (type && newest.type !== type)) return
    markers.current[newest.cameraId]?.openPopup()
  }, [newest, type])

  // Open the popup of the camera selected from the list / a deep link (?cam=).
  useEffect(() => {
    if (!selected) return
    const timer = setTimeout(() => markers.current[selected.id]?.openPopup(), 300)
    return () => clearTimeout(timer)
  }, [selected?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string) => setParams({ cam: id })
  const empty: CamStats = { count: 0 }

  return (
    <div className="flex h-full gap-2 p-2">
      <div className={`panel relative min-w-0 flex-1 overflow-hidden ${marking ? 'map-marking' : ''}`}>
        <MapContainer center={[28.6, 72.3]} zoom={6} className="h-full w-full">
          <TileLayer
            url={TILE_URL}
            attribution={TILE_ATTR}
            eventHandlers={{
              tileload: () => setTiles((s) => ({ ok: Date.now(), err: s.err })),
              tileerror: () => setTiles((s) => ({ ok: s.ok, err: Date.now() })),
            }}
          />
          <FitCameras cameras={cameras} />
          <FlyTo camera={selected} />
          <FlyToPoint point={flyPoint} />
          {marking && <MapClick onClick={(lat, lng) => setDraft({ lat, lng })} />}

          {/* Active Drone Watches */}
          {activeWatches.map((w) => (
            <Circle key={w.id} center={[w.lat, w.lng]} radius={w.radiusKm * 1000} pathOptions={{ color: '#06b6d4', weight: 2, dashArray: '6 4', fillColor: '#06b6d4', fillOpacity: 0.12 }}>
              <Tooltip sticky>
                {t('drone.active')} {w.radiusKm} km · {fmtLeft(Date.parse(w.expiresAt) - now)} {t('drone.left')}
              </Tooltip>
            </Circle>
          ))}
          {draft && <Circle center={[draft.lat, draft.lng]} radius={2000} interactive={false} pathOptions={{ color: '#06b6d4', weight: 1.5, fillOpacity: 0.06 }} />}

          {/* Police Nakas */}
          {nakas.map((n) => (
            <Marker key={n.id} position={[n.lat, n.lng]} icon={nakaIcon(inWatch(n.lat, n.lng))}>
              <Tooltip direction="top" offset={[0, -6]}>
                {n.name} · {n.agency}
              </Tooltip>
            </Marker>
          ))}

          {/* Border Line */}
          <Polyline positions={BORDER_LINE} pathOptions={{ color: '#f5b40b', weight: 2.5, dashArray: '10 8', opacity: 0.9 }}>
            <Tooltip sticky>{t('map.border')}</Tooltip>
          </Polyline>

          {/* Tactical Autonomous UAV Patrol Track & Radar Sweep */}
          {showUav && (
            <>
              <Polyline
                positions={UAV_WAYPOINTS}
                pathOptions={{ color: '#38bdf8', weight: 1.8, dashArray: '5 6', opacity: 0.65 }}
              >
                <Tooltip sticky>HERON-MK2 Autonomous Patrol Circuit</Tooltip>
              </Polyline>
              <Circle
                center={[uavPos.lat, uavPos.lng]}
                radius={2400}
                pathOptions={{
                  color: '#38bdf8',
                  weight: 1.5,
                  dashArray: '3 4',
                  fillColor: '#38bdf8',
                  fillOpacity: 0.08,
                }}
              >
                <Tooltip permanent direction="bottom" offset={[0, 10]} className="cam-label">
                  UAV-01 · ALT 2,100m · 145 KT · EO/MWIR
                </Tooltip>
              </Circle>
              <Marker position={[uavPos.lat, uavPos.lng]} icon={uavIcon(uavPos.heading)}>
                <Tooltip direction="top" offset={[0, -14]}>
                  HERON-MK2 UAV · PATROL CIRCUIT ALPHA
                </Tooltip>
              </Marker>
            </>
          )}

          {/* Anti-Drone Electronic Warfare (EW) Jammer Bubble */}
          {showEwJammer && (
            <>
              <Circle
                center={[28.60, 72.30]}
                radius={3600}
                pathOptions={{
                  color: '#f59e0b',
                  weight: 1.5,
                  dashArray: '8 6',
                  fillColor: '#f59e0b',
                  fillOpacity: 0.06,
                }}
              >
                <Tooltip sticky>C-UAS EW SHIELD: 3.6km Soft-Kill Jammer (433M/2.4G/5.8G Active)</Tooltip>
              </Circle>
              <Circle
                center={[28.60, 72.30]}
                radius={1500}
                pathOptions={{
                  color: '#ef4444',
                  weight: 2,
                  dashArray: '4 4',
                  fillColor: '#ef4444',
                  fillOpacity: 0.12,
                }}
              >
                <Tooltip sticky>C-UAS HARD KILL ZONE: GNSS Denial & Rogue Drone Intercept</Tooltip>
              </Circle>
            </>
          )}

          {/* Predictive Intercept Trajectory Vectors */}
          {showVectors &&
            cameras.map((c) => {
              const s = stats[c.id]
              if (!s || !s.count) return null
              const targetNaka = nakas.reduce(
                (closest, n) => {
                  const d = distanceKm(c.lat, c.lng, n.lat, n.lng)
                  return !closest || d < closest.d ? { n, d } : closest
                },
                null as { n: (typeof nakas)[0]; d: number } | null,
              )
              if (!targetNaka) return null

              return (
                <Polyline
                  key={`vec-${c.id}`}
                  positions={[
                    [c.lat, c.lng],
                    [targetNaka.n.lat, targetNaka.n.lng],
                  ]}
                  pathOptions={{
                    color: '#ef4444',
                    weight: 2,
                    dashArray: '5 5',
                    opacity: 0.85,
                  }}
                >
                  <Tooltip sticky>
                    PREDICTIVE INTERCEPT VECTOR: Ingress toward {targetNaka.n.name} (Est. Intercept: {(targetNaka.d * 3.2).toFixed(0)} min)
                  </Tooltip>
                </Polyline>
              )
            })}

          {heat &&
            cameras.map((c) => {
              const n = stats[c.id]?.count ?? 0
              if (!n) return null
              const ratio = n / max
              return (
                <CircleMarker
                  key={`heat-${c.id}`}
                  center={[c.lat, c.lng]}
                  radius={14 + 36 * Math.sqrt(ratio)}
                  interactive={false}
                  pathOptions={{ stroke: false, fillColor: ratio > 0.66 ? '#ef4444' : ratio > 0.33 ? '#f97316' : '#f5b40b', fillOpacity: 0.22 + 0.25 * ratio }}
                />
              )
            })}

          {/* Cameras */}
          {cameras.map((c) => (
            <Marker
              key={c.id}
              position={[c.lat, c.lng]}
              icon={pinIcon(STATUS_COLOR[c.status], pulse[c.id], inWatch(c.lat, c.lng))}
              zIndexOffset={pulse[c.id] ? 1000 : 0}
              ref={(m) => {
                if (m) markers.current[c.id] = m
              }}
              eventHandlers={{ click: () => select(c.id) }}
            >
              {tilesOffline && (
                <Tooltip permanent direction="right" offset={[10, 0]} className="cam-label">
                  {c.name}
                </Tooltip>
              )}
              <Popup autoPan={false} closeButton={false}>
                <CameraPopup camera={c} stats={stats[c.id] ?? empty} now={now} />
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {tilesOffline && (
          <div className="absolute top-2 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-2 rounded border border-high/50 bg-base-950/95 px-3 py-1.5 text-xs text-high">
            <WifiOff size={14} /> {t('map.offline')}
          </div>
        )}

        {/* Top Tactical Status Badge */}
        <div className="absolute top-2 right-2 z-[500] flex items-center gap-2 rounded border border-base-700/80 bg-base-950/90 px-2.5 py-1 text-[11px] font-mono text-ink-dim backdrop-blur-sm shadow-md">
          <span className="flex items-center gap-1 text-accent">
            <Radio size={12} className="animate-pulse" />
            <span>MGRS 43R XQ</span>
          </span>
          <span className="text-base-700">|</span>
          <span className="text-emerald-400">SEC-DATALINK [OK]</span>
          <span className="text-base-700">|</span>
          <span className="text-amber-400">DEFCON 3</span>
        </div>

        <div className="panel absolute bottom-2 left-2 z-[500] flex flex-wrap gap-x-3 gap-y-1 px-2 py-1 text-[10px] text-ink-dim">
          {Object.entries(STATUS_COLOR).map(([k, color]) => (
            <span key={k} className="flex items-center gap-1 capitalize">
              <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {k}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-0 w-4 border-t-2 border-dashed border-med" /> {t('map.border')}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rotate-45 bg-blue-900 ring-1 ring-blue-300" /> Police naka
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-sky-400" /> UAV Track
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-500" /> C-UAS EW Bubble
          </span>
          <span className="flex items-center gap-1">
            Pulse = new alert:
            {SEVERITIES.map((s) => (
              <span key={s} className={`h-2 w-2 rounded-full ${SEV[s].bg}`} title={t(`sev.${s}`)} />
            ))}
          </span>
        </div>
      </div>

      <aside className="panel flex w-80 shrink-0 flex-col">
        <div className="space-y-2 border-b border-base-700 p-2">
          <div className="flex items-center justify-between">
            <span className="panel-title">{t('map.sites')}</span>
            <button
              className={`btn btn-sm ml-auto mr-1 ${marking ? 'btn-primary' : ''}`}
              aria-pressed={marking}
              onClick={() => {
                setMarking((m) => !m)
                setDraft(null)
              }}
              title={t('drone.mark')}
            >
              <Drone size={12} /> {t('drone.mark')}
            </button>
            <button
              className={`btn btn-sm ${heat ? 'btn-primary' : ''}`}
              aria-pressed={heat}
              onClick={() => setHeat((h) => !h)}
              title="Toggle heat circles: alert density per camera"
            >
              <Flame size={12} /> {t('map.heat')}
            </button>
          </div>

          {/* Tactical War Room Layers Row */}
          <div className="flex items-center gap-1 border-t border-base-800 pt-1.5">
            <button
              onClick={() => setShowUav((v) => !v)}
              className={`btn btn-sm flex-1 font-mono text-[10px] ${showUav ? 'border-sky-500/60 bg-sky-950/60 text-sky-300' : 'text-ink-mute'}`}
              title="Toggle Heron MK-II UAV Autonomous Patrol Track"
            >
              <Drone size={11} /> UAV
            </button>
            <button
              onClick={() => setShowEwJammer((v) => !v)}
              className={`btn btn-sm flex-1 font-mono text-[10px] ${showEwJammer ? 'border-amber-500/60 bg-amber-950/60 text-amber-300' : 'text-ink-mute'}`}
              title="Toggle C-UAS Anti-Drone Electronic Warfare (EW) Jammer Bubble"
            >
              <ShieldAlert size={11} /> EW Shield
            </button>
            <button
              onClick={() => setShowVectors((v) => !v)}
              className={`btn btn-sm flex-1 font-mono text-[10px] ${showVectors ? 'border-rose-500/60 bg-rose-950/60 text-rose-300' : 'text-ink-mute'}`}
              title="Toggle Predictive Cross-Camera Intercept Trajectory Vectors"
            >
              <Navigation size={11} /> Vectors
            </button>
          </div>

          <div className="flex gap-2">
            <select className="field min-w-0 flex-1" value={type} onChange={(e) => setType(e.target.value as AlertType | '')} aria-label="Alert type">
              <option value="">All alert types</option>
              {ALERT_TYPES.map((a) => (
                <option key={a} value={a}>{t(`type.${a}`)}</option>
              ))}
            </select>
            <div className="flex shrink-0 gap-0.5" role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button key={w.id} className={`btn btn-sm font-mono ${win === w.id ? 'btn-primary' : ''}`} onClick={() => setWin(w.id)}>
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {marking && (
          <DronePanel
            draft={draft}
            linkedAlertId={linkedAlertId}
            onCancel={() => {
              setMarking(false)
              setDraft(null)
            }}
            onDone={(w) => {
              setMarking(false)
              setDraft(null)
              setParams({ watch: w.id })
            }}
          />
        )}
        {!marking && focusWatch && <WatchInfo watch={focusWatch} cameras={cameras} now={now} />}

        {selected && (
          <div className="border-b border-base-700 p-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{selected.name}</span>
              <Link to={`/cameras?cam=${selected.id}`} className="text-ink-mute hover:text-ink" title="Open focused view" aria-label="Open focused view">
                <Maximize2 size={13} />
              </Link>
              <button className="text-ink-mute hover:text-ink" aria-label="Close live feed" onClick={() => setParams({})}>
                <X size={14} />
              </button>
            </div>
            <CameraFeed camera={selected} hideTopBar className="aspect-video w-full rounded-sm" />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !cameras.length ? (
            <SkeletonRows />
          ) : !cameras.length ? (
            <EmptyState title="No cameras configured" hint="Add cameras with their coordinates in Settings." />
          ) : (
            <HierarchyTree cameras={cameras} renderCamera={(c) => {
              const s = stats[c.id] ?? empty
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`flex w-full items-start gap-2 border-b border-base-800 px-3 py-2 text-left hover:bg-base-850 ${selected?.id === c.id ? 'bg-accent/10' : ''}`}
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: pulse[c.id] ?? STATUS_COLOR[c.status] }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{c.name}</span>
                    <span className="block truncate text-[10px] text-ink-mute">{c.locationName}</span>
                    {s.latest && (
                      <span className={`block truncate font-mono text-[10px] ${SEV[s.latest.severity].text}`}>
                        {t(`type.${s.latest.type}`)} · {relTime(s.latest.timestamp, now)}
                      </span>
                    )}
                  </span>
                  <span className={`rounded px-1.5 font-mono text-[10px] font-bold ${s.count ? 'bg-base-700 text-ink' : 'text-ink-mute'}`}>{s.count}</span>
                </button>
              )
            }} />
          )}
        </div>
        <div className="border-t border-base-700 px-3 py-1.5 text-[10px] text-ink-mute">Counts = alerts per camera for the selected type and window.</div>
      </aside>
    </div>
  )
}
