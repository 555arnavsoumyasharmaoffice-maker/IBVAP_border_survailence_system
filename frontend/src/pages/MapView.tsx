import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L, { type LatLngTuple, type Marker as LeafletMarker } from 'leaflet'
import { Drone, Flame, Maximize2, ScanLine, WifiOff, X } from 'lucide-react'
import type { Alert, AlertType, Camera, DroneWatch } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'
import { audit } from '@/lib/audit'
import { distanceKm } from '@/lib/geo'
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
  const now = useNow(2000)
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

          {activeWatches.map((w) => (
            <Circle key={w.id} center={[w.lat, w.lng]} radius={w.radiusKm * 1000} pathOptions={{ color: '#06b6d4', weight: 2, dashArray: '6 4', fillColor: '#06b6d4', fillOpacity: 0.12 }}>
              <Tooltip sticky>
                {t('drone.active')} {w.radiusKm} km · {fmtLeft(Date.parse(w.expiresAt) - now)} {t('drone.left')}
              </Tooltip>
            </Circle>
          ))}
          {draft && <Circle center={[draft.lat, draft.lng]} radius={2000} interactive={false} pathOptions={{ color: '#06b6d4', weight: 1.5, fillOpacity: 0.06 }} />}
          {nakas.map((n) => (
            <Marker key={n.id} position={[n.lat, n.lng]} icon={nakaIcon(inWatch(n.lat, n.lng))}>
              <Tooltip direction="top" offset={[0, -6]}>
                {n.name} · {n.agency}
              </Tooltip>
            </Marker>
          ))}

          <Polyline positions={BORDER_LINE} pathOptions={{ color: '#f5b40b', weight: 2.5, dashArray: '10 8', opacity: 0.9 }}>
            <Tooltip sticky>{t('map.border')}</Tooltip>
          </Polyline>

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
