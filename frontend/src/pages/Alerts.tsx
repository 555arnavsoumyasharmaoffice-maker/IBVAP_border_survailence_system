import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Search } from 'lucide-react'
import type { AlertStatus, AlertType, Severity } from '@/types'
import { useData } from '@/store/data'
import { ALERT_TYPES, SEV, SEVERITIES, STATUSES, downloadFile, fmtDateTime, isActive, keyDetail, pct, toCsv } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { AlertActions } from '@/components/AlertCard'
import { EmptyState, ErrorState, PageHeader, SeverityBadge, SkeletonRows, StatusBadge, TYPE_ICON } from '@/components/ui'

const MAX_ROWS = 200

export default function Alerts() {
  const t = useT()
  const navigate = useNavigate()
  const { alerts, cameras, loading, error, load } = useData()
  const [type, setType] = useState<AlertType | ''>('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [status, setStatus] = useState<AlertStatus | 'ACTIVE' | ''>('')
  const [cameraId, setCameraId] = useState('')
  const [search, setSearch] = useState('')

  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/\s/g, '')
    return alerts.filter(
      (a) =>
        (!type || a.type === type) &&
        (!severity || a.severity === severity) &&
        (!status || (status === 'ACTIVE' ? isActive(a) : a.status === status)) &&
        (!cameraId || a.cameraId === cameraId) &&
        (!q || `${a.id}${keyDetail(a)}${camName[a.cameraId] ?? ''}`.toLowerCase().replace(/\s/g, '').includes(q)),
    )
  }, [alerts, type, severity, status, cameraId, search, camName])

  const exportCsv = () =>
    downloadFile(
      'ibvap_alerts.csv',
      toCsv(
        filtered.map((a) => ({
          id: a.id, time: fmtDateTime(a.timestamp), camera: camName[a.cameraId] ?? a.cameraId, type: a.type,
          severity: a.severity, status: a.status, confidence: a.confidence.toFixed(2), detail: keyDetail(a), assignedTo: a.assignedTo ?? '',
        })),
      ),
    )

  return (
    <Page>
      <PageHeader title={t('nav.alerts')} subtitle={`${filtered.length} of ${alerts.length} events (last 14 days)`}>
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={13} /> Export CSV
        </button>
      </PageHeader>

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
      </div>

      <div className="panel overflow-x-auto">
        {loading && !alerts.length ? (
          <SkeletonRows rows={10} />
        ) : error && !alerts.length ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !filtered.length ? (
          <EmptyState title="No alerts match these filters" hint="Clear a filter or widen the search." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
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
            <tbody>
              {filtered.slice(0, MAX_ROWS).map((a) => {
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
              })}
            </tbody>
          </table>
        )}
        {filtered.length > MAX_ROWS && (
          <div className="px-3 py-2 text-center text-[11px] text-ink-mute">
            Showing the newest {MAX_ROWS} of {filtered.length}. Narrow the filters or export CSV for the full list.
          </div>
        )}
      </div>
    </Page>
  )
}
