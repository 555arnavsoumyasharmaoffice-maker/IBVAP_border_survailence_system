import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Search as SearchIcon, Video } from 'lucide-react'
import type { Alert, DetectionRecord, Heading, VehicleClass } from '@/types'
import type { SearchQuery } from '@/services/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { VEHICLE_CLASS_LIST, fmtDate, fmtDateTime, fmtPlate, pct } from '@/lib/format'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { ClipPlayer } from '@/components/ClipPlayer'
import { EmptyState, ErrorState, Field, Modal, PageHeader, PlateTag, Skeleton } from '@/components/ui'

const COLORS = ['Black', 'White', 'Red', 'Blue', 'Green', 'Khaki', 'Grey', 'Brown', 'Silver'] as const
const DIRECTIONS: (Heading | 'toward' | 'away')[] = ['toward', 'away', 'N', 'S', 'E', 'W']

/** A detection shown in the clip player (which takes an alert-shaped object). */
function asAlert(r: DetectionRecord): Alert {
  return {
    id: r.alertId ?? r.id, timestamp: r.at, cameraId: r.cameraId, type: r.objectClass === 'vehicle' ? 'VEHICLE_DETECTED' : 'HUMAN_DETECTED',
    severity: 'LOW', status: 'ACKNOWLEDGED', confidence: r.confidence, snapshotUrl: r.thumbUrl, trackId: r.trackId, bbox: r.bbox,
    clip: service.mode === 'mock' ? { url: null, startOffsetSec: -10, endOffsetSec: 20, simulated: true } : undefined,
    details: { objectClass: r.vehicleClass ?? r.objectClass }, assignedTo: null, notes: '', history: [],
  }
}

function DetectionModal({ r, onClose }: { r: DetectionRecord; onClose: () => void }) {
  const t = useT()
  const camera = useData((s) => s.cameras.find((c) => c.id === r.cameraId))
  const alert = useMemo(() => asAlert(r), [r])
  return (
    <Modal title={`${camera?.name ?? r.cameraId} · ${fmtDateTime(r.at)}`} onClose={onClose} wide>
      <div className="space-y-2">
        <ClipPlayer alert={alert} compact autoPlay className="aspect-[16/10] overflow-hidden rounded border border-base-700" />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="capitalize">{r.vehicleClass ? t(`veh.${r.vehicleClass}`) : t('search.person')}</span>
          <span className="text-ink-dim">{r.color}</span>
          <span className="font-mono text-ink-dim">#{r.trackId}</span>
          <span className="font-mono">{pct(r.confidence)}</span>
          <span className="text-ink-dim">
            {t('search.heading')} {r.heading} · {t(r.towardBorder ? 'search.toward' : 'search.away')}
          </span>
          {r.plate && <PlateTag plate={r.plate} />}
          <span className="ml-auto flex gap-2">
            {r.alertId && (
              <Link className="btn btn-sm" to={`/alerts/${r.alertId}`}>
                {t('search.openAlert')}
              </Link>
            )}
            <Link className="btn btn-sm btn-primary" to={`/cameras?cam=${r.cameraId}`}>
              <Video size={12} /> {t('act.viewCamera')}
            </Link>
          </span>
        </div>
      </div>
    </Modal>
  )
}

export default function Search() {
  const t = useT()
  const cameras = useData((s) => s.cameras)
  const zones = useData((s) => s.zones)
  const [q, setQ] = useState<SearchQuery>({})
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [results, setResults] = useState<DetectionRecord[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<DetectionRecord | null>(null)
  const set = (patch: Partial<SearchQuery>) => setQ((x) => ({ ...x, ...patch }))
  const query = useMemo<SearchQuery>(
    () => ({ ...q, from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined, to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined, limit: 120 }),
    [q, from, to],
  )

  useEffect(() => {
    let live = true
    setError('')
    const timer = setTimeout(() => {
      service.searchDetections(query).then(
        (r) => live && setResults(r),
        (e: Error) => live && (setError(e.message), setResults([])),
      )
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])

  // Searching people's movements is sensitive: log each distinct search (debounced).
  useEffect(() => {
    const active = Object.entries(query).filter(([k, v]) => v && k !== 'limit')
    if (!active.length) return
    const timer = setTimeout(() => audit('CAMERA_VIEW', 'Forensic search', 'Search', active.map(([k, v]) => `${k}=${v}`).join(', ')), 1500)
    return () => clearTimeout(timer)
  }, [query])

  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])
  const camZones = zones.filter((z) => !q.cameraId || z.cameraId === q.cameraId)
  const any = Object.values(q).some(Boolean) || from || to

  return (
    <Page>
      <PageHeader title={t('nav.search')} subtitle={t('search.subtitle')} />
      <div className="panel mb-2 flex flex-wrap items-end gap-2 p-2">
        <Field label={t('search.object')}>
          <select className="field" value={q.objectClass ?? ''} onChange={(e) => set({ objectClass: (e.target.value || undefined) as SearchQuery['objectClass'], vehicleClass: undefined })}>
            <option value="">{t('search.any')}</option>
            <option value="person">{t('search.person')}</option>
            <option value="vehicle">{t('search.vehicle')}</option>
          </select>
        </Field>
        {q.objectClass !== 'person' && (
          <Field label={t('veh.label')}>
            <select className="field" value={q.vehicleClass ?? ''} onChange={(e) => set({ vehicleClass: (e.target.value || undefined) as VehicleClass | undefined, objectClass: e.target.value ? 'vehicle' : q.objectClass })}>
              <option value="">{t('veh.all')}</option>
              {VEHICLE_CLASS_LIST.map((v) => (
                <option key={v} value={v}>{t(`veh.${v}`)}</option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t(q.objectClass === 'vehicle' ? 'search.vehColor' : q.objectClass === 'person' ? 'search.upper' : 'search.color')}>
          <select className="field" value={q.color ?? ''} onChange={(e) => set({ color: e.target.value || undefined })}>
            <option value="">{t('search.any')}</option>
            {COLORS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <Field label={t('search.direction')}>
          <select className="field" value={q.direction ?? ''} onChange={(e) => set({ direction: (e.target.value || undefined) as SearchQuery['direction'] })}>
            <option value="">{t('search.any')}</option>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>{d === 'toward' ? t('search.toward') : d === 'away' ? t('search.away') : `${t('search.heading')} ${d}`}</option>
            ))}
          </select>
        </Field>
        <Field label={t('common.camera')}>
          <select className="field max-w-44" value={q.cameraId ?? ''} onChange={(e) => set({ cameraId: e.target.value || undefined, zoneId: undefined })}>
            <option value="">{t('search.anyCam')}</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label={t('nav.zones')}>
          <select className="field max-w-40" value={q.zoneId ?? ''} onChange={(e) => set({ zoneId: e.target.value || undefined })}>
            <option value="">{t('search.any')}</option>
            {camZones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" className="field" value={from} max={to || fmtDate(Date.now())} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="field" value={to} min={from} max={fmtDate(Date.now())} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('search.plate')}>
          <div className="relative">
            <SearchIcon size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-mute" />
            <input className="field w-32 pl-7 font-mono uppercase" placeholder="PB02 / 4410" value={q.plate ?? ''} onChange={(e) => set({ plate: e.target.value.replace(/\s/g, '').toUpperCase() || undefined })} />
          </div>
        </Field>
        {any && (
          <button className="btn" onClick={() => { setQ({}); setFrom(''); setTo('') }}>
            Clear
          </button>
        )}
        <span className="ml-auto font-mono text-[10px] text-ink-mute">
          {results?.length ?? 0} {t('search.results')}
        </span>
      </div>

      {!results ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      ) : error ? (
        <div className="panel"><ErrorState message={error} /></div>
      ) : !results.length ? (
        <div className="panel"><EmptyState title={t('search.none')} hint={t('search.noneHint')} icon={SearchIcon} /></div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
          {results.map((r) => (
            <button key={r.id} className="panel overflow-hidden text-left hover:border-accent/60" onClick={() => setOpen(r)}>
              <div className="relative aspect-video bg-black">
                <img src={r.thumbUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                <span className="absolute top-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px]">{pct(r.confidence)}</span>
                {r.alertId && <span className="absolute top-1 left-1 rounded bg-crit px-1 text-[9px] font-bold text-white">ALERT</span>}
              </div>
              <div className="space-y-0.5 p-1.5 text-[11px]">
                <div className="flex items-center gap-1">
                  <span className="font-semibold">{r.vehicleClass ? t(`veh.${r.vehicleClass}`) : t('search.person')}</span>
                  <span className="text-ink-dim">· {r.color}</span>
                  <span className="ml-auto flex items-center gap-0.5 font-mono text-[10px] text-ink-mute" title={t(r.towardBorder ? 'search.toward' : 'search.away')}>
                    {r.towardBorder ? <ArrowUpRight size={11} className="text-high" /> : <ArrowDownLeft size={11} />} {r.heading}
                  </span>
                </div>
                <div className="truncate text-ink-dim">{camName[r.cameraId] ?? r.cameraId}</div>
                <div className="flex items-center justify-between font-mono text-[10px] text-ink-mute">
                  <span>{fmtDateTime(r.at)}</span>
                  {r.plate && <span className="text-ink">{fmtPlate(r.plate)}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <DetectionModal r={open} onClose={() => setOpen(null)} />}
    </Page>
  )
}
