import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, BellRing, ChevronLeft, ChevronRight, Clock, Siren, Timer, Video, type LucideIcon } from 'lucide-react'
import type { Alert, Severity } from '@/types'
import { useData, useIncidents } from '@/store/data'
import { SEV, SEVERITIES, fmtDuration, fmtTime, isShelved, keyDetail } from '@/lib/format'
import { useT } from '@/i18n'
import { CameraFeed } from '@/components/CameraFeed'
import { AlertCard } from '@/components/AlertCard'
import { useHierarchy } from '@/components/HierarchyTree'
import { LastHandover } from '@/pages/Shift'
import { EmptyState, Skeleton, useNow } from '@/components/ui'
import { SeismicGrid } from '@/components/SeismicGrid'

const HOUR = 3_600_000

/**
 * High-performance HMI tile: neutral grey when normal, severity-coloured only when abnormal,
 * so colour itself means "look here".
 */
function Kpi({ label, value, icon: Icon, tone, hint }: { label: string; value: string | number; icon: LucideIcon; tone: Severity | null; hint: string }) {
  const sev = tone ? SEV[tone] : null
  return (
    <div className={`panel min-w-0 px-3 py-2 ${sev ? sev.border : ''}`} title={hint}>
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={`shrink-0 ${sev ? sev.text : 'text-ink-mute'}`} />
        <span className="panel-title truncate">{label}</span>
      </div>
      <div className={`font-mono text-2xl leading-tight font-semibold ${sev ? sev.text : 'text-ink'}`}>{value}</div>
      <div className="truncate text-[10px] text-ink-mute">{hint}</div>
    </div>
  )
}

function Timeline({ alerts, now }: { alerts: Alert[]; now: number }) {
  const t = useT()
  const navigate = useNavigate()
  const recent = alerts.filter((a) => now - Date.parse(a.timestamp) <= HOUR)
  return (
    <div className="panel shrink-0 px-3 pt-1.5 pb-1">
      <div className="flex items-center justify-between">
        <span className="panel-title">{t('cc.timeline')}</span>
        <span className="flex gap-3 text-[10px] text-ink-mute">
          {SEVERITIES.map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${SEV[s].bg}`} />
              {t(`sev.${s}`)}
            </span>
          ))}
        </span>
      </div>
      <div className="relative mt-1 h-9 border-b border-base-600">
        {[0, 15, 30, 45, 60].map((m) => (
          <div key={m} className="absolute top-0 bottom-0 border-l border-base-700" style={{ left: `${(m / 60) * 100}%` }} />
        ))}
        {recent.map((a) => (
          <button
            key={a.id}
            title={`${fmtTime(a.timestamp)}  ${t(`type.${a.type}`)}  ${keyDetail(a)}`}
            onClick={() => navigate(`/alerts/${a.id}`)}
            className={`absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-1 ring-black/60 hover:scale-150 ${SEV[a.severity].bg} ${a.status === 'NEW' ? '' : 'opacity-50'}`}
            style={{ left: `${(1 - (now - Date.parse(a.timestamp)) / HOUR) * 100}%`, top: `${SEVERITIES.indexOf(a.severity) * 8 + 2}px` }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-ink-mute">
        <span>-60m</span>
        <span>-45m</span>
        <span>-30m</span>
        <span>-15m</span>
        <span>now</span>
      </div>
    </div>
  )
}

/** Open incidents per BOP, grouped by sector, on one line. */
function SectorOverview() {
  const t = useT()
  const navigate = useNavigate()
  const cameras = useData((s) => s.cameras)
  const incidents = useIncidents()
  const groups = useHierarchy(cameras)
  const open = (st: string) => st === 'NEW' || st === 'ACKNOWLEDGED' || st === 'ESCALATED' || st === 'ON_HOLD'
  const camBop = Object.fromEntries(cameras.map((c) => [c.id, c.bopId]))
  const counts: Record<string, number> = {}
  // Neutral unless something still needs an operator (NEW / ESCALATED): high-performance HMI.
  const urgent: Record<string, boolean> = {}
  for (const i of incidents) {
    if (!open(i.status) || Date.now() - Date.parse(i.lastSeen) >= 86_400_000) continue
    const b = camBop[i.cameraId]
    counts[b] = (counts[b] ?? 0) + 1
    if (i.status === 'NEW' || i.status === 'ESCALATED') urgent[b] = true
  }
  if (!groups.length) return null
  return (
    <div className="panel flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs">
      <span className="panel-title">{t('hier.overview')}</span>
      {groups.map(({ sector, bops }) => (
        <span key={sector.id} className="flex items-center gap-2">
          <span className="text-ink-mute">{sector.name.replace(/ Sector.*/, '')}:</span>
          {bops.map(({ bop }) => (
            <button key={bop.id} onClick={() => navigate('/alerts')} className={`rounded border px-1.5 py-px ${urgent[bop.id] ? 'border-high/50 text-high' : 'border-base-700 text-ink-dim'}`}>
              {bop.name.replace(/^(BOP|ICP|Check Post) /, '')} <span className="font-mono font-bold">{counts[bop.id] ?? 0}</span>
            </button>
          ))}
        </span>
      ))}
      <LastHandover />
    </div>
  )
}

type CcLayout = 1 | 2 | 4 | 6 | 'all'

const LAYOUT_OPTIONS: { id: CcLayout; label: string; title: string }[] = [
  { id: 1, label: '1x1', title: 'Single camera view (1 feed)' },
  { id: 2, label: '2x1', title: 'Dual camera split (2 feeds)' },
  { id: 4, label: '2x2', title: 'Quad grid (4 feeds)' },
  { id: 6, label: '3x2', title: '6-camera grid (6 feeds)' },
  { id: 'all', label: 'All', title: 'All online cameras simultaneously' },
]

export default function CommandCenter() {
  const t = useT()
  const navigate = useNavigate()
  const now = useNow(1000)
  const { alerts, cameras, loading, error } = useData()
  const incidents = useIncidents()

  const [bottomTab, setBottomTab] = useState<'timeline' | 'seismic'>('timeline')

  const kpis = useMemo(() => {
    const ts = now
    const midnight = new Date().setHours(0, 0, 0, 0)
    const today = alerts.filter((a) => Date.parse(a.timestamp) >= midnight)
    const open = (st: string) => st === 'NEW' || st === 'ACKNOWLEDGED' || st === 'ESCALATED'
    const openCrit = incidents.filter((i) => i.severity === 'CRITICAL' && open(i.status) && ts - Date.parse(i.lastSeen) < 24 * HOUR).length
    const unack = incidents.filter((i) => i.status === 'NEW' && ts - Date.parse(i.firstSeen) > 60_000).length
    const times = today.flatMap((a) => {
      const ack = a.history.find((h) => h.status === 'ACKNOWLEDGED')
      return ack ? [(Date.parse(ack.at) - Date.parse(a.timestamp)) / 1000] : []
    })
    const avg = times.length ? times.reduce((x, y) => x + y, 0) / times.length : null
    const online = cameras.filter((c) => c.status !== 'offline').length
    return [
      { label: t('kpi.openCrit'), value: openCrit, icon: Siren, tone: openCrit ? ('CRITICAL' as const) : null, hint: openCrit ? t('kpi.openCritHint') : t('kpi.normal') },
      { label: t('kpi.unack'), value: unack, icon: BellRing, tone: unack ? ('HIGH' as const) : null, hint: unack ? t('kpi.unackHint') : t('kpi.normal') },
      { label: t('kpi.avgResp'), value: avg === null ? '-' : fmtDuration(avg), icon: Timer, tone: avg !== null && avg > 60 ? ('MEDIUM' as const) : null, hint: `${times.length} ${t('kpi.acked')}` },
      { label: t('cc.camerasOnline'), value: `${online}/${cameras.length}`, icon: Video, tone: online < cameras.length ? ('HIGH' as const) : null, hint: online < cameras.length ? `${cameras.length - online} ${t('kpi.offline')}` : t('kpi.normal') },
    ]
  }, [alerts, cameras, incidents, t, now])

  const [layout, setLayout] = useState<CcLayout>(() => {
    const saved = localStorage.getItem('ibvap.cc_layout')
    if (saved === '1' || saved === '2' || saved === '4' || saved === '6' || saved === 'all') {
      return saved === 'all' ? 'all' : (Number(saved) as CcLayout)
    }
    return 4
  })
  const [bopFilter, setBopFilter] = useState<string>('ALL')
  const [page, setPage] = useState(0)
  const [autoTour, setAutoTour] = useState(false)
  const bops = useData((s) => s.bops)

  const onlineCameras = useMemo(() => cameras.filter((c) => c.status !== 'offline'), [cameras])
  const filteredCameras = useMemo(() => {
    if (bopFilter === 'ALL') return onlineCameras
    return onlineCameras.filter((c) => c.bopId === bopFilter)
  }, [onlineCameras, bopFilter])

  const perPage = layout === 'all' ? Math.max(1, filteredCameras.length) : (layout as number)
  const totalPages = Math.max(1, Math.ceil(filteredCameras.length / perPage))
  const currentPage = Math.min(page, totalPages - 1)

  const visibleCameras = useMemo(() => {
    if (layout === 'all') return filteredCameras
    return filteredCameras.slice(currentPage * perPage, currentPage * perPage + perPage)
  }, [filteredCameras, layout, currentPage, perPage])

  const handleLayoutChange = (newLayout: CcLayout) => {
    setLayout(newLayout)
    setPage(0)
    localStorage.setItem('ibvap.cc_layout', String(newLayout))
  }

  useEffect(() => {
    if (!autoTour || totalPages <= 1 || layout === 'all') return
    const timer = setInterval(() => {
      setPage((p) => (p + 1) % totalPages)
    }, 10000)
    return () => clearInterval(timer)
  }, [autoTour, totalPages, layout])

  const gridStyle = useMemo(() => {
    const count = visibleCameras.length
    if (count <= 1) return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' }
    if (count === 2) return { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: '1fr' }
    if (count <= 4) return { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }
    if (count <= 6) return { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }
    if (count <= 8) return { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }
    return { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'repeat(3, minmax(0, 1fr))' }
  }, [visibleCameras.length])

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="grid shrink-0 grid-cols-4 gap-2">
        {loading && !alerts.length
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
          : kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <SectorOverview />

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Camera Toolbar / View Switcher */}
          <div className="panel flex shrink-0 items-center justify-between gap-2 px-2.5 py-1 text-xs">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <Video size={13} className="text-accent" />
                <span className="text-[11px] uppercase tracking-wider">CCTV Feeds</span>
                <span className="font-mono text-[11px] font-normal text-ink-mute">
                  ({visibleCameras.length}/{onlineCameras.length} online)
                </span>
              </div>

              {bops.length > 1 && (
                <div className="flex items-center gap-1">
                  <select
                    value={bopFilter}
                    onChange={(e) => {
                      setBopFilter(e.target.value)
                      setPage(0)
                    }}
                    className="field h-6 px-1.5 py-0 text-[11px] font-mono text-ink-dim"
                    title="Filter cameras by Border Outpost"
                  >
                    <option value="ALL">All BOPs ({onlineCameras.length} cams)</option>
                    {bops.map((b) => {
                      const count = onlineCameras.filter((c) => c.bopId === b.id).length
                      return (
                        <option key={b.id} value={b.id}>
                          {b.name.replace(/^(BOP|ICP|Check Post) /, '')} ({count})
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mute">Layout:</span>
              <div className="flex rounded border border-base-700 bg-base-850 p-0.5">
                {LAYOUT_OPTIONS.map((opt) => {
                  const active = layout === opt.id
                  return (
                    <button
                      key={opt.id}
                      title={opt.title}
                      onClick={() => handleLayoutChange(opt.id)}
                      className={`rounded px-2 py-0.5 font-mono text-[11px] font-medium transition-colors ${
                        active ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-mute hover:text-ink'
                      }`}
                    >
                      {opt.id === 'all' ? `All (${onlineCameras.length})` : opt.label}
                    </button>
                  )
                })}
              </div>

              {totalPages > 1 && layout !== 'all' && (
                <div className="flex items-center gap-1 border-l border-base-700 pl-1.5">
                  <button
                    className="btn btn-sm h-6 w-6 p-0"
                    disabled={currentPage === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    title="Previous page"
                  >
                    <ChevronLeft size={12} />
                  </button>
                  <span className="font-mono text-[10px] text-ink-dim px-0.5">
                    {currentPage + 1}/{totalPages}
                  </span>
                  <button
                    className="btn btn-sm h-6 w-6 p-0"
                    disabled={currentPage >= totalPages - 1}
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    title="Next page"
                  >
                    <ChevronRight size={12} />
                  </button>
                </div>
              )}

              {totalPages > 1 && layout !== 'all' && (
                <button
                  onClick={() => setAutoTour((v) => !v)}
                  className={`btn btn-sm h-6 px-1.5 py-0 text-[10px] font-mono ${
                    autoTour ? 'border-accent bg-accent/15 text-accent' : 'text-ink-mute hover:text-ink'
                  }`}
                  title="Automatically cycle camera pages every 10 seconds"
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${autoTour ? 'bg-accent animate-pulse' : 'bg-ink-mute'} mr-1`} />
                  Tour
                </button>
              )}
            </div>
          </div>

          <div
            className="grid min-h-0 flex-1 gap-2"
            style={gridStyle}
          >
            {loading && !cameras.length
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-full" />)
              : visibleCameras.map((c) => (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    className="group relative min-h-0 overflow-hidden rounded border border-base-700 bg-black text-left cursor-pointer hover:border-accent/80 transition-colors focus:outline-none focus:ring-1 focus:ring-accent"
                    onClick={() => navigate(`/cameras?cam=${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        navigate(`/cameras?cam=${c.id}`)
                      }
                    }}
                    title={`Click to open full view for ${c.name}`}
                  >
                    <CameraFeed camera={c} className="h-full w-full" />
                  </div>
                ))}
            {!loading && !visibleCameras.length && (
              <div className="panel col-span-full row-span-full flex items-center justify-center p-8">
                <EmptyState
                  title="No cameras matching filter"
                  hint={error ?? "Try selecting 'All BOPs' or check camera connections in Settings."}
                  icon={Video}
                />
              </div>
            )}
          </div>

          {/* Bottom Multi-Domain Telemetry Switcher: Timeline vs. Seismic Grid */}
          <div className="flex flex-col gap-1 shrink-0">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setBottomTab('timeline')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded font-mono text-[10px] font-semibold transition-colors ${
                    bottomTab === 'timeline'
                      ? 'bg-accent/25 text-accent border border-accent/50'
                      : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  <Clock size={11} /> {t('cc.timeline').toUpperCase()}
                </button>
                <button
                  onClick={() => setBottomTab('seismic')}
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded font-mono text-[10px] font-semibold transition-colors ${
                    bottomTab === 'seismic'
                      ? 'bg-accent/25 text-accent border border-accent/50'
                      : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  <Activity size={11} className="text-accent" /> SEISMIC UGS GROUND GRID
                </button>
              </div>
            </div>

            {bottomTab === 'timeline' ? (
              <Timeline alerts={alerts} now={now} />
            ) : (
              <SeismicGrid />
            )}
          </div>
        </div>

        <aside className="panel flex w-80 shrink-0 flex-col 2xl:w-96">
          <div className="flex items-center justify-between border-b border-base-700 px-3 py-2">
            <span className="panel-title">{t('cc.liveFeed')}</span>
            <span className="flex items-center gap-1 font-mono text-[10px] text-low">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-low" /> LIVE
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-1.5">
            {loading && !alerts.length ? (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)
            ) : alerts.length ? (
              incidents.filter((i) => !i.alerts.some((a) => isShelved(a, now))).slice(0, 40).map((i) => <AlertCard key={i.id} alert={i.alerts[0]} incident={i} now={now} />)
            ) : (
              <EmptyState title={t('common.noAlerts')} hint="All quiet. New detections will appear here in real time." />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
