import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowLeft, Camera as CameraIcon, ChevronLeft, ChevronRight, Fence, Hash, MapPin, Maximize2, Moon, Square, Sun, Video } from 'lucide-react'
import type { Camera } from '@/types'
import { useData } from '@/store/data'
import { useUi, type CameraLayout } from '@/store/ui'
import { downloadFile, fmtDateTime } from '@/lib/format'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { CameraFeed, type CameraFeedHandle } from '@/components/CameraFeed'
import { AlertCard } from '@/components/AlertCard'
import { Chip, EmptyState, Skeleton, VisibilityBadge, useNow } from '@/components/ui'

interface Overlay {
  boxes: boolean
  zones: boolean
  ids: boolean
}
const DEFAULT_OVERLAY: Overlay = { boxes: true, zones: true, ids: true }

function OverlayToggles({ value, onChange }: { value: Overlay; onChange: (v: Overlay) => void }) {
  const items = [
    { key: 'boxes', icon: Square, label: 'Bounding boxes' },
    { key: 'zones', icon: Fence, label: 'Zones' },
    { key: 'ids', icon: Hash, label: 'Track IDs' },
  ] as const
  return (
    <div className="flex gap-0.5">
      {items.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          title={`${value[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-label={label}
          aria-pressed={value[key]}
          onClick={(e) => {
            e.stopPropagation()
            onChange({ ...value, [key]: !value[key] })
          }}
          className={`flex h-5 w-5 items-center justify-center rounded ${value[key] ? 'bg-accent/20 text-accent' : 'text-ink-mute hover:text-ink'}`}
        >
          <Icon size={12} />
        </button>
      ))}
    </div>
  )
}

function StatusChip({ camera }: { camera: Camera }) {
  const t = useT()
  if (camera.status === 'offline') return <Chip className="border-crit/50 bg-crit/15 text-crit">{t('feed.offline')}</Chip>
  if (camera.status === 'degraded') return <Chip className="border-med/50 bg-med/15 text-med">DEGRADED</Chip>
  return <Chip className="border-low/50 bg-low/15 text-low">{t('feed.live')}</Chip>
}

function Tile({ camera, onFocus }: { camera: Camera; onFocus: () => void }) {
  const [overlay, setOverlay] = useState(DEFAULT_OVERLAY)
  return (
    <div className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-2 py-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{camera.name}</div>
          <div className="flex items-center gap-1 truncate text-[10px] text-ink-mute">
            <MapPin size={9} className="shrink-0" />
            <span className="truncate">{camera.locationName}</span>
          </div>
        </div>
        <span className="font-mono text-[10px] text-ink-dim">{camera.fps} FPS</span>
        {camera.isNightMode ? <Moon size={12} className="text-indigo-300" aria-label="Night mode" /> : <Sun size={12} className="text-amber-300" aria-label="Day mode" />}
        <VisibilityBadge visibility={camera.visibility} />
        <StatusChip camera={camera} />
        <OverlayToggles value={overlay} onChange={setOverlay} />
        <button onClick={onFocus} title="Open focused view" aria-label="Open focused view" className="text-ink-mute hover:text-ink">
          <Maximize2 size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 cursor-pointer" onClick={onFocus}>
        <CameraFeed camera={camera} showBoxes={overlay.boxes} showZones={overlay.zones} showTrackIds={overlay.ids} hideTopBar className="h-full w-full" />
      </div>
    </div>
  )
}

function Focused({ camera, onBack }: { camera: Camera; onBack: () => void }) {
  const now = useNow(1000)
  const feedRef = useRef<CameraFeedHandle>(null)
  const [overlay, setOverlay] = useState(DEFAULT_OVERLAY)
  const [snapMsg, setSnapMsg] = useState('')
  const alerts = useData((s) => s.alerts)
  const recent = alerts.filter((a) => a.cameraId === camera.id).slice(0, 25)
  useEffect(() => audit('CAMERA_VIEW', 'Opened live view', camera.name), [camera.id, camera.name])

  const takeSnapshot = async () => {
    const url = feedRef.current?.snapshot()
    if (!url) {
      setSnapMsg('Snapshot not available for this stream')
      return
    }
    const blob = await (await fetch(url)).blob()
    const name = `${camera.id}_${fmtDateTime(Date.now()).replace(/[: ]/g, '-')}.png`
    downloadFile(name, blob)
    setSnapMsg(`Saved ${name}`)
  }

  return (
    <div className="flex h-full gap-2 p-2">
      <div className="panel flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 px-2 py-1.5">
          <button className="btn btn-sm" onClick={onBack}>
            <ArrowLeft size={12} /> All cameras
          </button>
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold">{camera.name}</span>
            <span className="ml-2 text-xs text-ink-mute">{camera.locationName}</span>
          </div>
          <VisibilityBadge visibility={camera.visibility} />
        <StatusChip camera={camera} />
          <OverlayToggles value={overlay} onChange={setOverlay} />
          <button className="btn btn-sm btn-primary" onClick={() => void takeSnapshot()} disabled={camera.status === 'offline'}>
            <CameraIcon size={12} /> Snapshot
          </button>
        </div>
        <CameraFeed ref={feedRef} camera={camera} showBoxes={overlay.boxes} showZones={overlay.zones} showTrackIds={overlay.ids} className="min-h-0 w-full flex-1" />
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-2 py-1 font-mono text-[10px] text-ink-mute">
          <span>ID {camera.id}</span>
          <span>{camera.streamUrl}</span>
          <span>
            {camera.lat.toFixed(4)}, {camera.lng.toFixed(4)}
          </span>
          <span>{camera.isNightMode ? 'NIGHT / IR' : 'DAY'}</span>
          {snapMsg && <span className="text-accent">{snapMsg}</span>}
        </div>
      </div>
      <aside className="panel flex w-80 shrink-0 flex-col">
        <div className="border-b border-base-700 px-3 py-2">
          <span className="panel-title">Recent alerts - this camera</span>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
          {recent.length ? recent.map((a) => <AlertCard key={a.id} alert={a} now={now} />) : <EmptyState title="No alerts from this camera" />}
        </div>
      </aside>
    </div>
  )
}

const LAYOUTS: CameraLayout[] = [1, 2, 3]

export default function LiveCameras() {
  const t = useT()
  const [params, setParams] = useSearchParams()
  const { cameras, loading } = useData()
  const layout = useUi((s) => s.cameraLayout)
  const [page, setPage] = useState(0)
  const focusId = params.get('cam')
  const focused = cameras.find((c) => c.id === focusId)

  if (focused) return <Focused key={focused.id} camera={focused} onBack={() => setParams({})} />

  const perPage = layout * layout
  const pages = Math.max(1, Math.ceil(cameras.length / perPage))
  const current = Math.min(page, pages - 1)
  const visible = cameras.slice(current * perPage, current * perPage + perPage)

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-2">
        <h1 className="text-base font-semibold">Live Cameras</h1>
        <span className="font-mono text-xs text-ink-mute">
          {cameras.filter((c) => c.status !== 'offline').length}/{cameras.length} online
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1 text-[10px] text-ink-mute">{t('cams.maxNote')}</span>
          {LAYOUTS.map((n) => (
            <button
              key={n}
              title={`${n}x${n} layout (key ${n})`}
              onClick={() => {
                useUi.getState().set({ cameraLayout: n })
                setPage(0)
              }}
              className={`btn btn-sm font-mono ${layout === n ? 'btn-primary' : ''}`}
            >
              {n}x{n}
            </button>
          ))}
          {pages > 1 && (
            <span className="ml-2 flex items-center gap-1">
              <button className="btn btn-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
                <ChevronLeft size={12} />
              </button>
              <span className="font-mono text-xs text-ink-dim">
                {current + 1}/{pages}
              </span>
              <button className="btn btn-sm" aria-label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                <ChevronRight size={12} />
              </button>
            </span>
          )}
        </div>
      </div>

      {loading && !cameras.length ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-full" />
          ))}
        </div>
      ) : !cameras.length ? (
        <div className="panel flex-1">
          <EmptyState title="No cameras configured" hint="Add an RTSP / HTTP camera in Settings > Cameras." icon={Video} />
        </div>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-2"
          style={{ gridTemplateColumns: `repeat(${layout}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout}, minmax(0, 1fr))` }}
        >
          {visible.map((c) => (
            <Tile key={c.id} camera={c} onFocus={() => setParams({ cam: c.id })} />
          ))}
        </div>
      )}
    </div>
  )
}
