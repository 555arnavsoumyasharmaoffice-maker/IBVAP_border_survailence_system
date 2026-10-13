import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileText, Loader2, Printer } from 'lucide-react'
import type { Alert } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { downloadFile, fmtDateTime, fmtDuration, keyDetail, pct, toCsv } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { EmptyState, ErrorState, Field, PageHeader, PlateTag, SeverityBadge, SkeletonRows, Stat, StatusBadge } from '@/components/ui'

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

interface Report {
  from: string
  to: string
  cameraId: string
  generatedAt: string
  alerts: Alert[]
}

export default function Reports() {
  const t = useT()
  const [params] = useSearchParams()
  const cameras = useData((s) => s.cameras)
  const user = useAuth((s) => s.user)
  const [from, setFrom] = useState(toLocalInput(Date.now() - 12 * 3_600_000))
  const [to, setTo] = useState(toLocalInput(Date.now()))
  const [cameraId, setCameraId] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])

  const generate = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const q = { from: new Date(from).toISOString(), to: new Date(to).toISOString(), cameraId: cameraId || undefined }
      setReport({ ...q, cameraId, generatedAt: new Date().toISOString(), alerts: await service.getAlerts(q) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setBusy(false)
    }
  }, [from, to, cameraId])

  // Demo Mode opens /reports?auto=1 to generate straight away.
  const auto = params.get('auto')
  useEffect(() => {
    if (auto) void generate()
  }, [auto]) // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    if (!report) return null
    const list = report.alerts
    const responses = list.flatMap((a) => {
      const ack = a.history.find((h) => h.status === 'ACKNOWLEDGED')
      return ack ? [(Date.parse(ack.at) - Date.parse(a.timestamp)) / 1000] : []
    })
    return {
      critical: list.filter((a) => a.severity === 'CRITICAL'),
      plates: list.filter((a) => a.type === 'ANPR_MATCH'),
      faces: list.filter((a) => a.type === 'FACE_MATCH'),
      intrusions: list.filter((a) => a.type === 'FENCE_INTRUSION').length,
      open: list.filter((a) => a.status === 'NEW' || a.status === 'ESCALATED').length,
      falseAlarms: list.filter((a) => a.status === 'FALSE_ALARM').length,
      avgResponse: responses.length ? responses.reduce((s, v) => s + v, 0) / responses.length : NaN,
    }
  }, [report])

  const exportCsv = () => {
    if (!report) return
    downloadFile(
      `ibvap_shift_report_${report.from.slice(0, 10)}.csv`,
      toCsv(
        report.alerts.map((a) => ({
          id: a.id, time: fmtDateTime(a.timestamp), camera: camName[a.cameraId] ?? a.cameraId, type: a.type, severity: a.severity,
          status: a.status, confidence: a.confidence.toFixed(2), plate: a.details.plateNumber ?? '', person: a.details.matchedPersonName ?? '',
          zone: a.details.zoneName ?? '', assignedTo: a.assignedTo ?? '', notes: a.notes,
        })),
      ),
    )
  }

  return (
    <Page>
      <PageHeader title={t('nav.reports')} subtitle="Shift report: summary, critical incidents, plates and faces matched">
        <button className="btn" onClick={exportCsv} disabled={!report?.alerts.length}>
          <Download size={13} /> Export CSV
        </button>
        <button className="btn" onClick={() => window.print()} disabled={!report}>
          <Printer size={13} /> Print / Save as PDF
        </button>
      </PageHeader>

      <div className="panel no-print mb-3 flex flex-wrap items-end gap-2 p-2">
        <Field label="Shift start">
          <input type="datetime-local" className="field" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Shift end">
          <input type="datetime-local" className="field" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Camera">
          <select className="field" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            <option value="">All cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <button className="btn btn-primary" onClick={() => void generate()} disabled={busy || !from || !to || from > to}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Generate report
        </button>
      </div>

      {busy && !report ? (
        <div className="panel"><SkeletonRows rows={8} /></div>
      ) : error ? (
        <div className="panel"><ErrorState message={error} onRetry={() => void generate()} /></div>
      ) : !report || !summary ? (
        <div className="panel"><EmptyState title="No report generated yet" hint="Choose the shift window and camera, then press Generate report." icon={FileText} /></div>
      ) : (
        <div className="print-dark space-y-3">
          <div className="panel p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-base font-bold tracking-wide">IBVAP SHIFT REPORT</div>
                <div className="text-xs text-ink-dim">Intelligent Border Video Analytics Platform</div>
              </div>
              <dl className="grid grid-cols-[84px_1fr] gap-x-2 text-[11px]">
                <dt className="text-ink-mute">Period</dt>
                <dd className="font-mono">{fmtDateTime(report.from)} → {fmtDateTime(report.to)}</dd>
                <dt className="text-ink-mute">Camera</dt>
                <dd>{report.cameraId ? camName[report.cameraId] : 'All cameras'}</dd>
                <dt className="text-ink-mute">Generated</dt>
                <dd className="font-mono">{fmtDateTime(report.generatedAt)} by {user?.name} ({user?.role})</dd>
              </dl>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
            <Stat label="Total alerts" value={report.alerts.length} />
            <Stat label="Critical" value={summary.critical.length} tone="text-crit" />
            <Stat label="Intrusions" value={summary.intrusions} tone="text-high" />
            <Stat label="Still open" value={summary.open} tone="text-accent" />
            <Stat label="False alarms" value={summary.falseAlarms} tone="text-ink-dim" />
            <Stat label="Avg response" value={fmtDuration(summary.avgResponse)} tone="text-low" />
          </div>

          <div className="panel p-3">
            <div className="panel-title mb-2">Critical incidents ({summary.critical.length})</div>
            {summary.critical.length ? (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {summary.critical.map((a) => (
                  <div key={a.id} className="flex gap-3 rounded border border-base-700 p-2" style={{ breakInside: 'avoid' }}>
                    <img src={a.snapshotUrl} alt="" className="h-20 w-36 shrink-0 rounded-sm border border-base-700 object-cover" />
                    <div className="min-w-0 text-xs">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{t(`type.${a.type}`)}</span>
                        <SeverityBadge severity={a.severity} />
                        <StatusBadge status={a.status} />
                      </div>
                      <div className="font-mono text-[11px] text-ink-dim">{a.id} · {fmtDateTime(a.timestamp)}</div>
                      <div className="truncate">{camName[a.cameraId] ?? a.cameraId}</div>
                      <div className="truncate font-mono">{keyDetail(a)}</div>
                      {a.notes && <div className="truncate text-ink-mute">Notes: {a.notes}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-ink-mute">No critical incidents in this period.</div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="panel p-3">
              <div className="panel-title mb-2">Blacklisted plates matched ({summary.plates.length})</div>
              {summary.plates.length ? (
                <table className="w-full text-xs">
                  <tbody>
                    {summary.plates.map((a) => (
                      <tr key={a.id} className="border-b border-base-800">
                        <td className="py-1.5 font-mono text-ink-dim">{fmtDateTime(a.timestamp)}</td>
                        <td className="px-2"><PlateTag plate={a.details.plateNumber ?? ''} size="sm" /></td>
                        <td className="px-2">{a.details.blacklistReason}</td>
                        <td className="truncate text-ink-dim">{camName[a.cameraId]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-ink-mute">No blacklist matches in this period.</div>
              )}
            </div>
            <div className="panel p-3">
              <div className="panel-title mb-2">Watchlist faces matched ({summary.faces.length})</div>
              {summary.faces.length ? (
                <table className="w-full text-xs">
                  <tbody>
                    {summary.faces.map((a) => (
                      <tr key={a.id} className="border-b border-base-800">
                        <td className="py-1.5 font-mono text-ink-dim">{fmtDateTime(a.timestamp)}</td>
                        <td className="px-2 font-medium">{a.details.matchedPersonName}</td>
                        <td className="px-2 font-mono">{pct(a.details.similarity ?? 0)}</td>
                        <td className="truncate text-ink-dim">{camName[a.cameraId]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-ink-mute">No watchlist matches in this period.</div>
              )}
              <div className="mt-2 text-[10px] text-ink-mute">Face matches are decision support only; final identification by authorised personnel.</div>
            </div>
          </div>
        </div>
      )}
    </Page>
  )
}
