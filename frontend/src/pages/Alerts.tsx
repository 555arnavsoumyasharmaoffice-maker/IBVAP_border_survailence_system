import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Layers, Search } from 'lucide-react'
import type { Alert, AlertStatus, AlertType, Incident, Severity } from '@/types'
import { useData, useIncidents } from '@/store/data'
import { audit } from '@/lib/audit'
import { ALERT_TYPES, SEV, SEVERITIES, STATUSES, downloadFile, fmtDateTime, fmtDuration, isActive, keyDetail, pct, toCsv } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { AlertActions } from '@/components/AlertCard'
import { EmptyState, ErrorState, PageHeader, SeverityBadge, SkeletonRows, StatusBadge, TYPE_ICON, Tabs } from '@/components/ui'

const MAX_ROWS = 200
const TH = 'border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase'

export default function Alerts() {
  const t = useT()
  const navigate = useNavigate()
  const { alerts, cameras, loading, error, load } = useData()
  const incidents = useIncidents()
  const [view, setView] = useState<'incidents' | 'alerts'>('incidents')
  const [type, setType] = useState<AlertType | ''>('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [status, setStatus] = useState<AlertStatus | 'ACTIVE' | ''>('')
  const [cameraId, setCameraId] = useState('')
  const [search, setSearch] = useState('')

  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])
  const q = search.trim().toLowerCase().replace(/\s/g, '')
  const hay = (a: Alert) => `${a.id}${keyDetail(a)}${camName[a.cameraId] ?? ''}`.toLowerCase().replace(/\s/g, '')
  const statusOk = (s: AlertStatus) => !status || (status === 'ACTIVE' ? s === 'NEW' || s === 'ESCALATED' : s === status)

  const filteredAlerts = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (!type || a.type === type) && (!severity || a.severity === severity) && (!status || (status === 'ACTIVE' ? isActive(a) : a.status === status)) &&
          (!cameraId || a.cameraId === cameraId) && (!q || hay(a).includes(q)),
      ),
    [alerts, type, severity, status, cameraId, q, camName], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const filteredIncidents = useMemo(
    () =>
      incidents.filter(
        (i) =>
          (!type || i.alerts.some((a) => a.type === type)) && (!severity || i.severity === severity) && statusOk(i.status) &&
          (!cameraId || i.cameraId === cameraId) && (!q || i.id.toLowerCase().includes(q) || i.alerts.some((a) => hay(a).includes(q))),
      ),
    [incidents, type, severity, status, cameraId, q, camName], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const rows = view === 'incidents' ? filteredIncidents.length : filteredAlerts.length

  const exportCsv = () => {
    const data =
      view === 'incidents'
        ? filteredIncidents.map((i) => ({
            incident: i.id, firstSeen: fmtDateTime(i.firstSeen), lastSeen: fmtDateTime(i.lastSeen), camera: camName[i.cameraId] ?? i.cameraId,
            type: i.type, alerts: i.alerts.length, severity: i.severity, status: i.status, detail: keyDetail(i.alerts[0]), alertIds: i.alerts.map((a) => a.id).join(' '),
          }))
        : filteredAlerts.map((a) => ({
            id: a.id, time: fmtDateTime(a.timestamp), camera: camName[a.cameraId] ?? a.cameraId, type: a.type,
            severity: a.severity, status: a.status, confidence: a.confidence.toFixed(2), detail: keyDetail(a), assignedTo: a.assignedTo ?? '',
          }))
    downloadFile(`ibvap_${view}.csv`, toCsv(data))
    audit('EXPORT', 'CSV export', view === 'incidents' ? 'Incidents' : 'Alerts', `${data.length} rows`)
  }

  const incidentRow = (i: Incident) => {
    const latest = i.alerts[0]
    const Icon = TYPE_ICON[i.type]
    const span = (Date.parse(i.lastSeen) - Date.parse(i.firstSeen)) / 1000
    return (
      <tr key={i.id} onClick={() => navigate(`/alerts/${latest.id}`)} className="cursor-pointer border-b border-base-800 hover:bg-base-850">
        <td className={SEV[i.severity].bg} />
        <td className="px-2 py-1.5 font-mono whitespace-nowrap text-ink-dim">{fmtDateTime(i.lastSeen)}</td>
        <td className="px-2 whitespace-nowrap">
          <span className="flex items-center gap-1.5 font-medium">
            <Icon size={13} className={SEV[i.severity].text} /> {t(`type.${i.type}`)}
          </span>
        </td>
        <td className="px-2">
          <span className={`inline-flex items-center gap-1 rounded px-1.5 font-mono text-[11px] font-bold ${i.alerts.length > 1 ? 'bg-base-600 text-ink' : 'text-ink-mute'}`}>
            <Layers size={10} /> x{i.alerts.length}
          </span>
        </td>
        <td className="px-2 font-mono text-ink-mute">{i.alerts.length > 1 ? fmtDuration(span) : '-'}</td>
        <td className="max-w-44 truncate px-2 text-ink-dim">{camName[i.cameraId] ?? i.cameraId}</td>
        <td className="max-w-52 truncate px-2 font-mono">{keyDetail(latest)}</td>
        <td className="px-2"><SeverityBadge severity={i.severity} /></td>
        <td className="px-2"><StatusBadge status={i.status} /></td>
        <td className="px-2 py-1">{i.status === 'NEW' || i.status === 'ACKNOWLEDGED' ? <AlertActions alert={latest} incident={i} /> : <span className="text-ink-mute">-</span>}</td>
      </tr>
    )
  }

  const alertRow = (a: Alert) => {
    const Icon = TYPE_ICON[a.type]
    return (
      <tr key={a.id} onClick={() => navigate(`/alerts/${a.id}`)} className="cursor-pointer border-b border-base-800 hover:bg-base-850">
        <td className={SEV[a.severity].bg} />
        <td className="px-2 py-1.5 font-mono whitespace-nowrap text-ink-dim">{fmtDateTime(a.timestamp)}</td>
        <td className="px-2 whitespace-nowrap">
          <span className="flex items-center gap-1.5 font-medium">
            <Icon size={13} className={SEV[a.severity].text} /> {t(`type.${a.type}`)}
          </span>
        </td>
        <td className="max-w-44 truncate px-2 text-ink-dim">{camName[a.cameraId] ?? a.cameraId}</td>
        <td className="max-w-56 truncate px-2 font-mono">{keyDetail(a)}</td>
        <td className="px-2 font-mono text-ink-dim">{pct(a.confidence)}</td>
        <td className="px-2"><SeverityBadge severity={a.severity} /></td>
        <td className="px-2"><StatusBadge status={a.status} /></td>
        <td className="px-2 py-1">{a.status === 'NEW' || a.status === 'ACKNOWLEDGED' ? <AlertActions alert={a} /> : <span className="text-ink-mute">-</span>}</td>
      </tr>
    )
  }

  return (
    <Page>
      <PageHeader
        title={t('nav.alerts')}
        subtitle={`${alerts.length} alerts grouped into ${incidents.length} incidents (last 14 days). Showing ${rows}.`}
      >
        <button className="btn" onClick={exportCsv} disabled={!rows}>
          <Download size={13} /> Export CSV
        </button>
      </PageHeader>

      <Tabs
        tabs={[
          { id: 'incidents', label: 'Incidents', count: filteredIncidents.length },
          { id: 'alerts', label: 'All alerts', count: filteredAlerts.length },
        ]}
        value={view}
        onChange={setView}
      />

      <div className="panel mb-2 flex flex-wrap items-center gap-2 p-2">
        <div className="relative">
          <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-mute" />
          <input className="field w-52 pl-7" placeholder="Search ID, plate, person, camera" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="ACTIVE">Active (new + escalated)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{t(`status.${s}`)}</option>
          ))}
        </select>
        <select className="field" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | '')} aria-label="Severity">
          <option value="">All severities</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>{t(`sev.${s}`)}</option>
          ))}
        </select>
        <select className="field" value={type} onChange={(e) => setType(e.target.value as AlertType | '')} aria-label="Type">
          <option value="">All types</option>
          {ALERT_TYPES.map((s) => (
            <option key={s} value={s}>{t(`type.${s}`)}</option>
          ))}
        </select>
        <select className="field" value={cameraId} onChange={(e) => setCameraId(e.target.value)} aria-label="Camera">
          <option value="">All cameras</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        {view === 'incidents' && <span className="text-[11px] text-ink-mute">Same track, or same camera + type within 2 min, is one incident.</span>}
      </div>

      <div className="panel overflow-x-auto">
        {loading && !alerts.length ? (
          <SkeletonRows rows={10} />
        ) : error && !alerts.length ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !rows ? (
          <EmptyState title={`No ${view === 'incidents' ? 'incidents' : 'alerts'} match these filters`} hint="Clear a filter or widen the search." />
        ) : view === 'incidents' ? (
          <table className="w-full text-xs">
            <thead>
              <tr className={TH}>
                <th className="w-1" />
                <th className="px-2 py-2">Last seen</th>
                <th className="px-2">Type</th>
                <th className="px-2">Alerts</th>
                <th className="px-2">Duration</th>
                <th className="px-2">Camera</th>
                <th className="px-2">Latest detail</th>
                <th className="px-2">Severity</th>
                <th className="px-2">Status</th>
                <th className="px-2">Actions (whole incident)</th>
              </tr>
            </thead>
            <tbody>{filteredIncidents.slice(0, MAX_ROWS).map(incidentRow)}</tbody>
          </table>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className={TH}>
                <th className="w-1" />
                <th className="px-2 py-2">Time</th>
                <th className="px-2">Type</th>
                <th className="px-2">Camera</th>
                <th className="px-2">Detail</th>
                <th className="px-2">Conf.</th>
                <th className="px-2">Severity</th>
                <th className="px-2">Status</th>
                <th className="px-2">Actions</th>
              </tr>
            </thead>
            <tbody>{filteredAlerts.slice(0, MAX_ROWS).map(alertRow)}</tbody>
          </table>
        )}
        {rows > MAX_ROWS && (
          <div className="px-3 py-2 text-center text-[11px] text-ink-mute">
            Showing the newest {MAX_ROWS} of {rows}. Narrow the filters or export CSV for the full list.
          </div>
        )}
      </div>
    </Page>
  )
}
