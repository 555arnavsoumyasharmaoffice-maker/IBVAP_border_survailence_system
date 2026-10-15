import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Map as MapIcon, Save, Video } from 'lucide-react'
import type { Alert, WatchlistPerson } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { SEV, VISIBILITY, fmtDateTime, fmtDuration, isLowVisibility, keyDetail, pct, relTime } from '@/lib/format'
import { groupIncidents } from '@/lib/incidents'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { AlertActions } from '@/components/AlertCard'
import { MiniMap } from '@/components/MiniMap'
import { ZoneShapes } from '@/components/ZoneShapes'
import { NotifyQrt, Playbook, ResponseTimer } from '@/components/Playbook'
import { hasPlaybook } from '@/lib/playbooks'
import { EvidencePanel } from '@/components/EvidencePanel'
import { ClipPlayer } from '@/components/ClipPlayer'
import { Chip, EmptyState, PlateTag, SeverityBadge, Skeleton, StatusBadge, TYPE_ICON, useNow } from '@/components/ui'

const DAY = 86_400_000

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-mute">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

export default function AlertDetail() {
  const { id } = useParams()
  const t = useT()
  const navigate = useNavigate()
  const now = useNow(5000)
  const storeAlert = useData((s) => s.alerts.find((a) => a.id === id))
  const loading = useData((s) => s.loading)
  const alerts = useData((s) => s.alerts)
  const [fetched, setFetched] = useState<Alert | null>(null)
  const [missing, setMissing] = useState(false)
  const [person, setPerson] = useState<WatchlistPerson | null>(null)
  const [notes, setNotes] = useState('')
  const [saved, setSaved] = useState(false)
  const alert = storeAlert ?? fetched
  const camera = useData((s) => s.cameras.find((c) => c.id === alert?.cameraId))
  const zones = useData((s) => s.zones)
  const [showZones, setShowZones] = useState(true)
  const [view, setView] = useState<'clip' | 'snapshot'>('clip')

  // Older alerts may not be in the 14-day store: fetch on demand.
  useEffect(() => {
    if (storeAlert || loading || !id) return
    let live = true
    service.getAlert(id).then((a) => live && setFetched(a), () => live && setMissing(true))
    return () => {
      live = false
    }
  }, [id, storeAlert, loading])

  useEffect(() => {
    if (!id) return
    useUi.getState().set({ selectedAlertId: id })
  }, [id])

  useEffect(() => setNotes(alert?.notes ?? ''), [alert?.id, alert?.notes])

  const personId = alert?.details.matchedPersonId
  useEffect(() => {
    if (!personId) return setPerson(null)
    let live = true
    service.getWatchlist().then((list) => live && setPerson(list.find((p) => p.id === personId) ?? null), () => {})
    return () => {
      live = false
    }
  }, [personId])

  if (!alert) {
    return (
      <Page>
        {missing ? (
          <div className="panel">
            <EmptyState title={`Alert ${id} not found`} hint="It may have been archived. Go back to the alert list." />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="col-span-2 aspect-video" />
            <Skeleton className="h-full min-h-60" />
          </div>
        )}
      </Page>
    )
  }

  const d = alert.details
  const Icon = TYPE_ICON[alert.type]
  const ts = Date.parse(alert.timestamp)
  const related = alerts.filter(
    (a) =>
      a.id !== alert.id &&
      Math.abs(Date.parse(a.timestamp) - ts) <= DAY &&
      ((alert.trackId !== null && a.trackId === alert.trackId) || (!!d.plateNumber && a.details.plateNumber === d.plateNumber)),
  )
  const ack = alert.history.find((h) => h.status === 'ACKNOWLEDGED')
  const incident = groupIncidents(alerts).find((i) => i.alerts.some((a) => a.id === alert.id))

  const saveNotes = async () => {
    await useData.getState().saveNotes(alert.id, notes)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Page>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button className="btn btn-sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={12} /> Back
        </button>
        <Icon size={18} className={SEV[alert.severity].text} />
        <h1 className="text-lg font-semibold">{t(`type.${alert.type}`)}</h1>
        <span className="font-mono text-xs text-ink-mute">{alert.id}</span>
        <SeverityBadge severity={alert.severity} />
        <StatusBadge status={alert.status} />
        <div className="ml-auto flex gap-2">
          <Link className="btn btn-sm" to={`/cameras?cam=${alert.cameraId}`}>
            <Video size={12} /> {t('act.viewCamera')}
          </Link>
          <Link className="btn btn-sm" to={`/map?cam=${alert.cameraId}`}>
            <MapIcon size={12} /> Map
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 space-y-3 lg:col-span-7">
          <div className="panel overflow-hidden">
            <div className="flex items-center gap-1 border-b border-base-700 px-2 py-1">
              {(['clip', 'snapshot'] as const).map((v) => (
                <button key={v} className={`btn btn-sm ${view === v ? 'btn-primary' : ''}`} onClick={() => setView(v)}>
                  {t(v === 'clip' ? 'clip.tab' : 'clip.snapshotTab')}
                </button>
              ))}
              {alert.clip && <span className="ml-auto font-mono text-[10px] text-ink-mute">{alert.clip.startOffsetSec}s .. +{alert.clip.endOffsetSec}s</span>}
            </div>
            {view === 'clip' ? (
              <ClipPlayer alert={alert} className="aspect-[16/10]" />
            ) : (
            <div className="relative aspect-video bg-black">
              <img src={alert.snapshotUrl} alt="Alert snapshot" className="h-full w-full object-cover" />
              {showZones && <ZoneShapes zones={zones.filter((z) => z.cameraId === alert.cameraId)} highlightId={d.zoneId} />}
              <button
                className={`btn btn-sm absolute top-2 right-2 ${showZones ? 'btn-primary' : ''}`}
                aria-pressed={showZones}
                onClick={() => setShowZones((v) => !v)}
              >
                Zones
              </button>
              {alert.bbox && (
                <div
                  className="absolute border-2 border-crit shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                  style={{ left: `${alert.bbox[0] * 100}%`, top: `${alert.bbox[1] * 100}%`, width: `${alert.bbox[2] * 100}%`, height: `${alert.bbox[3] * 100}%` }}
                >
                  <span className="absolute -top-5 left-[-2px] bg-crit px-1 font-mono text-[10px] font-bold whitespace-nowrap text-white">
                    {alert.trackId !== null ? `#${alert.trackId} ` : ''}
                    {pct(alert.confidence)}
                  </span>
                </div>
              )}
            </div>
            )}
          </div>

          {alert.type === 'FACE_MATCH' && (
            <div className="panel p-3">
              <div className="panel-title mb-2">Face comparison (decision support only)</div>
              <div className="flex items-center gap-4">
                <figure className="text-center">
                  <img src={d.faceCropUrl} alt="Captured face" className="h-36 w-28 rounded border border-base-600 object-cover" />
                  <figcaption className="mt-1 text-[10px] text-ink-mute">Captured</figcaption>
                </figure>
                <div className="text-center">
                  <div className={`font-mono text-3xl font-bold ${(d.similarity ?? 0) >= 0.85 ? 'text-crit' : 'text-med'}`}>{pct(d.similarity ?? 0)}</div>
                  <div className="text-[10px] text-ink-mute uppercase">similarity</div>
                </div>
                <figure className="text-center">
                  {person ? <img src={person.photos[0]} alt="Watchlist" className="h-36 w-28 rounded border border-base-600 object-cover" /> : <Skeleton className="h-36 w-28" />}
                  <figcaption className="mt-1 text-[10px] text-ink-mute">Watchlist photo</figcaption>
                </figure>
                <div className="min-w-0 text-xs">
                  <div className="font-semibold">{d.matchedPersonName}</div>
                  {person && (
                    <>
                      <div className="text-ink-dim">
                        {person.category} · risk {person.riskLevel}
                      </div>
                      <div className="mt-1 text-ink-mute">{person.notes}</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {incident && incident.alerts.length > 1 && (
            <div className="panel p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="panel-title">
                  Incident {incident.id} - {incident.alerts.length} alerts grouped
                </span>
                <StatusBadge status={incident.status} />
                <span className="ml-auto"><AlertActions alert={alert} incident={incident} /></span>
              </div>
              <ul className="max-h-44 divide-y divide-base-800 overflow-y-auto text-xs">
                {incident.alerts.map((a) => (
                  <li key={a.id}>
                    <Link to={`/alerts/${a.id}`} replace className={`flex items-center gap-2 py-1.5 hover:text-accent ${a.id === alert.id ? 'font-semibold text-accent' : ''}`}>
                      <span className={`h-2 w-2 rounded-full ${SEV[a.severity].bg}`} />
                      <span className="font-mono text-ink-mute">{fmtDateTime(a.timestamp)}</span>
                      <span>{t(`type.${a.type}`)}</span>
                      <span className="truncate font-mono text-ink-dim">{keyDetail(a)}</span>
                      <span className="ml-auto"><StatusBadge status={a.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-1 text-[10px] text-ink-mute">Buttons above act on every open alert in this incident.</div>
            </div>
          )}

          <div className="panel p-3">
            <div className="panel-title mb-2">Related alerts (same track or plate, ±24h)</div>
            {related.length ? (
              <ul className="divide-y divide-base-800 text-xs">
                {related.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <Link to={`/alerts/${a.id}`} className="flex items-center gap-2 py-1.5 hover:text-accent">
                      <span className={`h-2 w-2 rounded-full ${SEV[a.severity].bg}`} />
                      <span className="font-mono text-ink-mute">{fmtDateTime(a.timestamp)}</span>
                      <span className="font-medium">{t(`type.${a.type}`)}</span>
                      <span className="truncate font-mono text-ink-dim">{keyDetail(a)}</span>
                      <span className="ml-auto"><StatusBadge status={a.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-ink-mute">No related alerts found.</div>
            )}
          </div>
        </div>

        <div className="col-span-12 space-y-3 lg:col-span-5">
          <div className="panel p-3">
            <div className="panel-title mb-2">Details</div>
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
              <Row label="Time"><span className="font-mono">{fmtDateTime(alert.timestamp)}</span> <span className="text-ink-mute">({relTime(alert.timestamp, now)})</span></Row>
              <Row label="Camera">{camera?.name ?? alert.cameraId}</Row>
              <Row label="Location">
                {camera ? (
                  <Link to={`/map?cam=${camera.id}`} className="text-accent hover:underline" title="Open in Map View">
                    {camera.locationName} ({camera.lat.toFixed(4)}, {camera.lng.toFixed(4)})
                  </Link>
                ) : (
                  '-'
                )}
              </Row>
              <Row label="Confidence"><span className="font-mono">{pct(alert.confidence)}</span></Row>
              {d.objectClass && <Row label="Object class"><span className="capitalize">{d.objectClass}</span></Row>}
              {alert.confirmFrames !== undefined && (
                <Row label="Why it fired">
                  Confirmed over <span className="font-mono font-semibold">{alert.confirmFrames}</span> consecutive frames
                  {camera ? ` (camera minimum ${camera.minConfirmFrames})` : ''}
                </Row>
              )}
              {alert.visibility && (
                <Row label="Visibility">
                  <Chip className={VISIBILITY[alert.visibility].style}>{VISIBILITY[alert.visibility].label}</Chip>
                  {isLowVisibility(alert.visibility) && <span className="ml-2 text-med">Low visibility: verify before acting</span>}
                </Row>
              )}
              <Row label="Track ID"><span className="font-mono">{alert.trackId ?? '-'}</span></Row>
              {d.plateNumber && <Row label="Plate"><PlateTag plate={d.plateNumber} flagged={alert.type === 'ANPR_MATCH'} /></Row>}
              {d.vehicleClass && <Row label="Vehicle">{[d.vehicleColor, d.vehicleClass].filter(Boolean).join(' ')}</Row>}
              {d.blacklistReason && <Row label="Blacklist reason"><span className="font-semibold text-crit">{d.blacklistReason}</span></Row>}
              {d.matchedPersonName && <Row label="Matched person">{d.matchedPersonName}</Row>}
              {d.zoneName && <Row label="Zone">{d.zoneName}</Row>}
              {d.dwellTimeSec !== undefined && <Row label="Dwell time"><span className="font-mono">{fmtDuration(d.dwellTimeSec)}</span></Row>}
              {d.objectCount !== undefined && <Row label="Objects">{d.objectCount}</Row>}
              {d.description && <Row label="Description">{d.description}</Row>}
              <Row label="Assigned to">{alert.assignedTo ?? 'Unassigned'}</Row>
              {ack && <Row label="Response time"><span className="font-mono text-low">{fmtDuration((Date.parse(ack.at) - ts) / 1000)}</span></Row>}
            </dl>
            {camera && (
              <div role="link" tabIndex={0} title="Open in Map View" className="mt-3 cursor-pointer" onClick={() => navigate(`/map?cam=${camera.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/map?cam=${camera.id}`)}>
                <MiniMap className="pointer-events-none h-40" points={[{ lat: camera.lat, lng: camera.lng, label: camera.name, color: SEV[alert.severity].hex }]} />
                <div className="mt-1 text-[10px] text-accent">Open camera location in Map View →</div>
              </div>
            )}
          </div>

          <EvidencePanel alert={alert} incident={incident} />

          {hasPlaybook(alert) && (
            <div className="panel space-y-3 p-3">
              <Playbook alert={alert} />
              <NotifyQrt alert={alert} className="btn w-full" />
            </div>
          )}

          <div className="panel p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="panel-title">Workflow</span>
              <ResponseTimer alert={alert} />
            </div>
            <AlertActions alert={alert} showResolve size="md" />
            <ol className="mt-3 space-y-0 border-l border-base-600 pl-4 text-xs">
              {alert.history.map((h, i) => (
                <li key={i} className="relative pb-2.5">
                  <span className="absolute top-1 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-base-900 bg-accent" />
                  <div className="flex items-center gap-2">
                    {h.kind && h.kind !== 'status' ? <Chip className="border-accent/40 bg-accent/10 text-accent">{h.kind}</Chip> : <StatusBadge status={h.status} />}
                    <span className="font-mono text-ink-mute">{fmtDateTime(h.at)}</span>
                  </div>
                  <div className="text-ink-dim">
                    by {h.by}
                    {h.note ? ` - "${h.note}"` : ''}
                  </div>
                </li>
              ))}
            </ol>
            <label className="mt-1 block text-[11px] font-medium tracking-wide text-ink-mute uppercase">
              Operator notes
              <textarea className="field mt-1 h-20 w-full resize-y normal-case" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, action taken, QRT details..." />
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <button className="btn btn-sm" onClick={() => void saveNotes()} disabled={notes === alert.notes}>
                <Save size={12} /> Save notes
              </button>
              {saved && <span className="text-[11px] text-low">Saved</span>}
            </div>
          </div>
        </div>
      </div>
    </Page>
  )
}
