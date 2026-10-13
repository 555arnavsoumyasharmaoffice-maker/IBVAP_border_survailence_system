import { useMemo, useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Alert, AlertType } from '@/types'
import { useData } from '@/store/data'
import { ALERT_TYPES, TYPE_COLOR, fmtDate, fmtDuration } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { EmptyState, ErrorState, Field, PageHeader, Skeleton, Stat } from '@/components/ui'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const PRESETS = [
  { id: '24h', label: '24 h', ms: DAY },
  { id: '7d', label: '7 days', ms: 7 * DAY },
  { id: '14d', label: '14 days', ms: 14 * DAY },
] as const
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const AXIS = { stroke: '#6b7c96', fontSize: 10, tickLine: false } as const
const TOOLTIP = {
  contentStyle: { background: '#0e1728', border: '1px solid #2b3d5e', borderRadius: 4, fontSize: 11 },
  itemStyle: { padding: 0 },
  cursor: { fill: 'rgba(255,255,255,0.05)' },
} as const
const isNight = (a: Alert) => {
  const h = new Date(a.timestamp).getHours()
  return h >= 19 || h < 6
}

function Card({ title, note, children, className = '' }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`panel flex flex-col p-3 ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="panel-title">{title}</span>
        {note && <span className="text-[10px] text-ink-mute">{note}</span>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

export default function Analytics() {
  const t = useT()
  const { alerts, cameras, loading, error, load } = useData()
  const [preset, setPreset] = useState<(typeof PRESETS)[number]['id'] | 'custom'>('7d')
  const [from, setFrom] = useState(fmtDate(Date.now() - 7 * DAY))
  const [to, setTo] = useState(fmtDate(Date.now()))

  const [start, end] = useMemo(() => {
    if (preset === 'custom') return [new Date(`${from}T00:00:00`).getTime(), new Date(`${to}T23:59:59`).getTime()]
    const now = Date.now()
    return [now - PRESETS.find((p) => p.id === preset)!.ms, now]
    // `alerts` keeps the preset window sliding as live data arrives
  }, [preset, from, to, alerts]) // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    const list = alerts.filter((a) => {
      const ts = Date.parse(a.timestamp)
      return ts >= start && ts <= end
    })

    // Alerts over time, stacked by type
    const byHour = end - start <= 2 * DAY
    const step = byHour ? HOUR : DAY
    const first = byHour ? Math.floor(start / HOUR) * HOUR : new Date(start).setHours(0, 0, 0, 0)
    const buckets: Record<string, number | string>[] = []
    for (let ts = first; ts <= end; ts += step) {
      const d = new Date(ts)
      const row: Record<string, number | string> = { label: byHour ? `${String(d.getHours()).padStart(2, '0')}:00` : `${d.getDate()}/${d.getMonth() + 1}` }
      ALERT_TYPES.forEach((type) => (row[type] = 0))
      buckets.push(row)
    }
    const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
    const perCamera: Record<string, number> = {}
    const perType = {} as Record<AlertType, number>
    const dayNight = { Humans: [0, 0], Vehicles: [0, 0], Intrusions: [0, 0], Other: [0, 0] }
    let falseAlarms = 0
    let handled = 0
    let responseSum = 0
    let responseN = 0

    for (const a of list) {
      const ts = Date.parse(a.timestamp)
      const d = new Date(ts)
      const row = buckets[Math.floor((ts - first) / step)]
      if (row) row[a.type] = (row[a.type] as number) + 1
      if (a.type === 'FENCE_INTRUSION') heat[(d.getDay() + 6) % 7][d.getHours()]++
      perCamera[a.cameraId] = (perCamera[a.cameraId] ?? 0) + 1
      perType[a.type] = (perType[a.type] ?? 0) + 1
      const group =
        a.type === 'FENCE_INTRUSION' ? 'Intrusions'
          : a.type === 'VEHICLE_DETECTED' || a.type === 'ANPR_MATCH' ? 'Vehicles'
            : a.type === 'CAMERA_OFFLINE' || a.type === 'SUSPICIOUS_ACTIVITY' ? 'Other' : 'Humans'
      dayNight[group][isNight(a) ? 1 : 0]++
      if (a.status !== 'NEW') handled++
      if (a.status === 'FALSE_ALARM') falseAlarms++
      const ack = a.history.find((h) => h.status === 'ACKNOWLEDGED')
      if (ack) {
        responseSum += (Date.parse(ack.at) - ts) / 1000
        responseN++
      }
    }

    return {
      total: list.length,
      byHour,
      buckets,
      heat,
      heatMax: Math.max(1, ...heat.flat()),
      perCamera: cameras.map((c) => ({ name: c.name.replace(/^(BOP|Check Post|ICP) /, ''), count: perCamera[c.id] ?? 0 })).sort((a, b) => b.count - a.count),
      perType: ALERT_TYPES.filter((type) => perType[type]).map((type) => ({ type, name: t(`type.${type}`), value: perType[type] })),
      dayNight: Object.entries(dayNight).map(([name, [day, night]]) => ({ name, Day: day, Night: night })),
      falseRate: handled ? falseAlarms / handled : 0,
      falseAlarms,
      avgResponse: responseN ? responseSum / responseN : NaN,
      responseN,
      critical: list.filter((a) => a.severity === 'CRITICAL').length,
    }
  }, [alerts, cameras, start, end, t])

  return (
    <Page>
      <PageHeader title={t('nav.analytics')} subtitle={`${data.total} alerts in the selected range`}>
        {PRESETS.map((p) => (
          <button key={p.id} className={`btn btn-sm ${preset === p.id ? 'btn-primary' : ''}`} onClick={() => setPreset(p.id)}>
            {p.label}
          </button>
        ))}
        <button className={`btn btn-sm ${preset === 'custom' ? 'btn-primary' : ''}`} onClick={() => setPreset('custom')}>
          Custom
        </button>
        {preset === 'custom' && (
          <>
            <Field label="From">
              <input type="date" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <input type="date" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
      </PageHeader>

      {loading && !alerts.length ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-16" />)}
          <Skeleton className="col-span-4 h-64" />
        </div>
      ) : error && !alerts.length ? (
        <div className="panel"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : !data.total ? (
        <div className="panel"><EmptyState title="No alerts in this date range" hint="Pick a wider range. History is kept for 14 days in this build." /></div>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total alerts" value={data.total} />
            <Stat label="Critical alerts" value={data.critical} tone="text-crit" />
            <Stat label="Avg response time (NEW → ACK)" value={fmtDuration(data.avgResponse)} tone="text-low" />
            <Stat label="False alarm rate" value={`${(data.falseRate * 100).toFixed(1)}%`} tone="text-med" />
          </div>

          <Card title={`Alerts over time (per ${data.byHour ? 'hour' : 'day'}, by type)`} className="col-span-12 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.buckets} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#1c2a45" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip {...TOOLTIP} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                {ALERT_TYPES.map((type) => (
                  <Bar key={type} dataKey={type} name={t(`type.${type}`)} stackId="a" fill={TYPE_COLOR[type]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Fence intrusions: hour of day × day of week" note="Darker = more intrusions. Shows when the border is most vulnerable." className="col-span-12 lg:col-span-7">
            <div className="grid gap-px text-[9px]" style={{ gridTemplateColumns: '28px repeat(24, minmax(0, 1fr))' }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="text-center font-mono text-ink-mute">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>
              ))}
              {data.heat.map((row, d) => (
                <div key={d} className="contents">
                  <div className="flex items-center text-ink-mute">{DAYS[d]}</div>
                  {row.map((v, h) => (
                    <div
                      key={h}
                      title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00 - ${v} intrusion(s)`}
                      className="flex h-6 items-center justify-center rounded-[2px] font-mono text-white/90"
                      style={{ background: v ? `rgba(239,68,68,${0.2 + (v / data.heatMax) * 0.8})` : '#131e33' }}
                    >
                      {v || ''}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Day vs night detections" note="Night = 19:00-06:00" className="col-span-12 h-56 lg:col-span-5 lg:h-auto">
            <ResponsiveContainer width="100%" height="100%" minHeight={180}>
              <BarChart data={data.dayNight} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="#1c2a45" vertical={false} />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} allowDecimals={false} />
                <Tooltip {...TOOLTIP} />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="Day" fill="#f5b40b" isAnimationActive={false} />
                <Bar dataKey="Night" fill="#6366f1" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Alerts per camera" className="col-span-12 h-72 lg:col-span-6">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.perCamera} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#1c2a45" horizontal={false} />
                <XAxis type="number" {...AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={150} {...AXIS} />
                <Tooltip {...TOOLTIP} />
                <Bar dataKey="count" name="Alerts" fill="#38bdf8" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Alert type distribution" className="col-span-12 h-72 lg:col-span-6">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.perType} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="80%" paddingAngle={1} stroke="none" isAnimationActive={false}>
                  {data.perType.map((p) => (
                    <Cell key={p.type} fill={TYPE_COLOR[p.type]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP} itemStyle={{ color: '#e8eef8' }} />
                <Legend layout="vertical" align="right" verticalAlign="middle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <div className="col-span-12 text-[11px] text-ink-mute">
            Response time is measured from alert creation (NEW) to the first ACKNOWLEDGED entry in the alert history ({data.responseN} acknowledged alerts in range). False alarm rate = {data.falseAlarms} false alarms ÷ alerts that have been handled.
          </div>
        </div>
      )}
    </Page>
  )
}
