import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Siren, Timer, Video, type LucideIcon } from 'lucide-react'
import type { Alert, Severity } from '@/types'
import { useData, useIncidents } from '@/store/data'
import { SEV, SEVERITIES, fmtDuration, fmtTime, isShelved, keyDetail } from '@/lib/format'
import { useT } from '@/i18n'
import { CameraFeed } from '@/components/CameraFeed'
import { AlertCard } from '@/components/AlertCard'
import { useHierarchy } from '@/components/HierarchyTree'
import { LastHandover } from '@/pages/Shift'
import { EmptyState, Skeleton, useNow } from '@/components/ui'

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
  for (const i of incidents) if (open(i.status) && Date.now() - Date.parse(i.lastSeen) < 86_400_000) counts[camBop[i.cameraId]] = (counts[camBop[i.cameraId]] ?? 0) + 1
  if (!groups.length) return null
  return (
    <div className="panel flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-xs">
      <span className="panel-title">{t('hier.overview')}</span>
      {groups.map(({ sector, bops }) => (
        <span key={sector.id} className="flex items-center gap-2">
          <span className="text-ink-mute">{sector.name.replace(/ Sector.*/, '')}:</span>
          {bops.map(({ bop }) => (
            <button key={bop.id} onClick={() => navigate('/alerts')} className={`rounded border px-1.5 py-px ${counts[bop.id] ? 'border-high/50 text-high' : 'border-base-700 text-ink-dim'}`}>
              {bop.name.replace(/^(BOP|ICP|Check Post) /, '')} <span className="font-mono font-bold">{counts[bop.id] ?? 0}</span>
            </button>
          ))}
        </span>
      ))}
      <LastHandover />
    </div>
  )
}

export default function CommandCenter() {
  const t = useT()
  const navigate = useNavigate()
  const now = useNow(1000)
  const { alerts, cameras, loading, error } = useData()
  const incidents = useIncidents()

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

  const tiles = useMemo(() => cameras.filter((c) => c.status !== 'offline').slice(0, 4), [cameras])

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="grid shrink-0 grid-cols-4 gap-2">
        {loading && !alerts.length
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
          : kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

      <SectorOverview />

      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2">
            {loading && !cameras.length
              ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-full" />)
              : tiles.map((c) => (
                  <button key={c.id} className="min-h-0 overflow-hidden rounded border border-base-700 text-left" onClick={() => navigate(`/cameras?cam=${c.id}`)}>
                    <CameraFeed camera={c} className="h-full w-full" />
                  </button>
                ))}
            {!loading && !tiles.length && (
              <div className="panel col-span-2 row-span-2">
                <EmptyState title="No cameras online" hint={error ?? 'Add a camera in Settings, or check the network link to the outpost.'} icon={Video} />
              </div>
            )}
          </div>
          <Timeline alerts={alerts} now={now} />
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
