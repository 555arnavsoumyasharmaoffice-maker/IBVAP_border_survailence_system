import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Car, Fence, ScanFace, Siren, Video, type LucideIcon } from 'lucide-react'
import type { Alert } from '@/types'
import { useData, useIncidents } from '@/store/data'
import { SEV, SEVERITIES, fmtTime, isActive, keyDetail } from '@/lib/format'
import { useT } from '@/i18n'
import { CameraFeed } from '@/components/CameraFeed'
import { AlertCard } from '@/components/AlertCard'
import { EmptyState, Skeleton, useNow } from '@/components/ui'

const HOUR = 3_600_000

/** Count of matching alerts in each of the last 24 hours (oldest first). */
function hourly(alerts: Alert[], now: number, pred: (a: Alert) => boolean) {
  const buckets = new Array<number>(24).fill(0)
  for (const a of alerts) {
    const age = now - Date.parse(a.timestamp)
    if (age > 24 * HOUR) break
    if (age >= 0 && pred(a)) buckets[23 - Math.floor(age / HOUR)]++
  }
  return buckets
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${22 - (v / max) * 20}`).join(' ')
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full">
      <polygon points={`0,24 ${pts} 100,24`} fill={color} opacity="0.15" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Kpi({ label, value, icon: Icon, color, data }: { label: string; value: string | number; icon: LucideIcon; color: string; data: number[] }) {
  return (
    <div className="panel min-w-0 px-2.5 pt-2 pb-1">
      <div className="flex items-center gap-1.5">
        <Icon size={13} style={{ color }} className="shrink-0" />
        <span className="panel-title truncate">{label}</span>
      </div>
      <div className="font-mono text-2xl leading-tight font-semibold" style={{ color }}>
        {value}
      </div>
      <Sparkline data={data} color={color} />
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

export default function CommandCenter() {
  const t = useT()
  const navigate = useNavigate()
  const now = useNow(1000)
  const { alerts, cameras, loading, error } = useData()
  const incidents = useIncidents()

  const kpis = useMemo(() => {
    const ts = Date.now()
    const midnight = new Date().setHours(0, 0, 0, 0)
    const today = alerts.filter((a) => Date.parse(a.timestamp) >= midnight)
    const count = (list: Alert[], pred: (a: Alert) => boolean) => list.reduce((n, a) => n + (pred(a) ? 1 : 0), 0)
    const isVehicle = (a: Alert) => a.type === 'VEHICLE_DETECTED' || a.type === 'ANPR_MATCH'
    return [
      { label: 'Active alerts', value: count(alerts, isActive), icon: BellRing, color: '#38bdf8', data: hourly(alerts, ts, () => true) },
      {
        label: 'Critical (24h)', icon: Siren, color: SEV.CRITICAL.hex,
        value: count(alerts, (a) => a.severity === 'CRITICAL' && ts - Date.parse(a.timestamp) < 24 * HOUR),
        data: hourly(alerts, ts, (a) => a.severity === 'CRITICAL'),
      },
      { label: 'Intrusions today', value: count(today, (a) => a.type === 'FENCE_INTRUSION'), icon: Fence, color: SEV.HIGH.hex, data: hourly(alerts, ts, (a) => a.type === 'FENCE_INTRUSION') },
      { label: 'Vehicles today', value: count(today, isVehicle), icon: Car, color: SEV.LOW.hex, data: hourly(alerts, ts, isVehicle) },
      { label: 'Faces today', value: count(today, (a) => a.type === 'FACE_MATCH'), icon: ScanFace, color: '#ec4899', data: hourly(alerts, ts, (a) => a.type === 'FACE_MATCH') },
      {
        label: 'Cameras online', icon: Video, color: '#a3b3cb',
        value: `${cameras.filter((c) => c.status !== 'offline').length}/${cameras.length}`,
        data: hourly(alerts, ts, (a) => a.type === 'CAMERA_OFFLINE'),
      },
    ]
  }, [alerts, cameras])

  const tiles = useMemo(() => cameras.filter((c) => c.status !== 'offline').slice(0, 4), [cameras])

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="grid shrink-0 grid-cols-6 gap-2">
        {loading && !alerts.length
          ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[84px]" />)
          : kpis.map((k) => <Kpi key={k.label} {...k} />)}
      </div>

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
              incidents.slice(0, 40).map((i) => <AlertCard key={i.id} alert={i.alerts[0]} incident={i} now={now} />)
            ) : (
              <EmptyState title={t('common.noAlerts')} hint="All quiet. New detections will appear here in real time." />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
