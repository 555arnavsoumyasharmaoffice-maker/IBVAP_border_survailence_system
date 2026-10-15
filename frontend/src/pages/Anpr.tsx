import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Lock, Pencil, Plus, Search, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react'
import type { BlacklistReason, BlacklistVehicle, Level, PlateRead } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useCan } from '@/store/auth'
import { fmtDate, fmtDateTime, pct } from '@/lib/format'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { MiniMap } from '@/components/MiniMap'
import { Chip, EmptyState, ErrorState, Field, InlineWarning, Modal, PageHeader, PlateTag, SkeletonRows, Tabs } from '@/components/ui'
import { InWatchTag, ShareNakaButton } from '@/components/DroneWatch'

const REASON_LABEL: Record<BlacklistReason, string> = { STOLEN: 'Stolen', SMUGGLING: 'Suspected smuggling', WANTED: 'Wanted', OTHER: 'Other' }
const LEVEL_STYLE: Record<Level, string> = {
  HIGH: 'border-crit/50 bg-crit/15 text-crit',
  MEDIUM: 'border-med/50 bg-med/15 text-med',
  LOW: 'border-low/50 bg-low/15 text-low',
}
const norm = (s: string) => s.replace(/\s/g, '').toUpperCase()

function VehicleHistory({ plate, onClose }: { plate: string; onClose: () => void }) {
  const cameras = useData((s) => s.cameras)
  const [reads, setReads] = useState<PlateRead[] | null>(null)
  useEffect(() => {
    let live = true
    service.getPlateReads({ search: plate }).then((r) => live && setReads(r.filter((x) => x.plate === plate)), () => live && setReads([]))
    return () => {
      live = false
    }
  }, [plate])
  const camById = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c])), [cameras])
  // Route = sightings in chronological order, collapsing consecutive reads at the same camera.
  const route = useMemo(() => {
    const out: { lat: number; lng: number; label: string; color: string }[] = []
    let last = ''
    for (const r of [...(reads ?? [])].reverse()) {
      const c = camById[r.cameraId]
      if (!c || r.cameraId === last) continue
      last = r.cameraId
      out.push({ lat: c.lat, lng: c.lng, label: `${out.length + 1}. ${c.name}`, color: '#38bdf8' })
    }
    return out
  }, [reads, camById])

  return (
    <Modal title="Vehicle history" onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-3">
        <PlateTag plate={plate} size="lg" flagged={reads?.[0]?.blacklisted} />
        {reads?.[0]?.blacklisted && <Chip className="border-crit/50 bg-crit/15 text-crit">Blacklisted</Chip>}
        {reads && (
          <span className="text-xs text-ink-dim">
            {reads.length} sighting(s) at {new Set(reads.map((r) => r.cameraId)).size} camera(s)
          </span>
        )}
      </div>
      {!reads ? (
        <SkeletonRows rows={4} />
      ) : !reads.length ? (
        <EmptyState title="No sightings recorded" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody>
                {reads.map((r) => (
                  <tr key={r.id} className="border-b border-base-800">
                    <td className="py-1.5 font-mono text-ink-dim">{fmtDateTime(r.timestamp)}</td>
                    <td className="px-2">{camById[r.cameraId]?.name ?? r.cameraId}</td>
                    <td className="font-mono text-ink-mute">{pct(r.confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <MiniMap points={route} route className="h-64" />
            <div className="mt-1 text-[10px] text-ink-mute">Route across cameras, oldest to newest sighting.</div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ReadsTab() {
  const cameras = useData((s) => s.cameras)
  const [reads, setReads] = useState<PlateRead[] | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [history, setHistory] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])
  const camAt = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c])), [cameras])
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : undefined
  const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : undefined

  const fetchReads = useCallback(() => {
    setError('')
    let live = true
    service.getPlateReads({ search: norm(search), from: fromIso, to: toIso, limit: 300 }).then(
      (r) => live && setReads(r),
      (e: Error) => live && (setError(e.message), setReads([])),
    )
    return () => {
      live = false
    }
  }, [search, fromIso, toIso])

  useEffect(() => {
    const timer = setTimeout(fetchReads, 250)
    return () => clearTimeout(timer)
  }, [fetchReads])

  // Live reads: prepend when they match the current filters.
  useEffect(
    () =>
      service.subscribePlateReads((r) => {
        if (toIso && r.timestamp > toIso) return
        if (search && !r.plate.includes(norm(search))) return
        setReads((list) => (list ? [r, ...list].slice(0, 300) : list))
      }),
    [search, toIso],
  )

  const saveCorrection = async () => {
    if (!editing) return
    const updated = await service.correctPlateRead(editing.id, norm(editing.value))
    audit('ANPR', 'Plate corrected', updated.correctedFrom ?? '', `corrected to ${updated.plate}`)
    setReads((list) => list?.map((r) => (r.id === updated.id ? updated : r)) ?? null)
    setEditing(null)
  }

  return (
    <>
      <div className="panel mb-2 flex flex-wrap items-end gap-2 p-2">
        <Field label="Plate (full or partial)">
          <div className="relative">
            <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-mute" />
            <input className="field w-52 pl-7 font-mono uppercase" placeholder="RJ14 or 4521" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Field>
        <Field label="From">
          <input type="date" className="field" value={from} max={to || fmtDate(Date.now())} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="field" value={to} min={from} max={fmtDate(Date.now())} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {(search || from || to) && (
          <button className="btn" onClick={() => { setSearch(''); setFrom(''); setTo('') }}>
            Clear
          </button>
        )}
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-low">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-low" /> LIVE · {reads?.length ?? 0} reads
        </span>
      </div>

      <div className="panel overflow-x-auto">
        {!reads ? (
          <SkeletonRows rows={10} />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchReads} />
        ) : !reads.length ? (
          <EmptyState title="No plate reads match" hint="Try a shorter plate fragment or a wider date range." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="px-2 py-2">Time</th>
                <th className="px-2">Camera</th>
                <th className="px-2">Plate</th>
                <th className="px-2">Crop</th>
                <th className="px-2">Class</th>
                <th className="px-2">Colour</th>
                <th className="px-2">OCR conf.</th>
                <th className="px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {reads.map((r) => (
                <tr key={r.id} className={`border-b border-base-800 ${r.blacklisted ? 'bg-crit/10' : 'hover:bg-base-850'}`}>
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap text-ink-dim">{fmtDateTime(r.timestamp)}</td>
                  <td className="max-w-48 truncate px-2 text-ink-dim">{camName[r.cameraId] ?? r.cameraId}</td>
                  <td className="px-2">
                    {editing?.id === r.id ? (
                      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); void saveCorrection() }}>
                        <input autoFocus className="field w-32 py-0.5 font-mono uppercase" value={editing.value} onChange={(e) => setEditing({ id: r.id, value: e.target.value })} aria-label="Corrected plate" />
                        <button className="btn btn-sm btn-primary" type="submit" disabled={norm(editing.value).length < 4} aria-label="Save correction">
                          <Check size={12} />
                        </button>
                        <button className="btn btn-sm" type="button" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <button onClick={() => setHistory(r.plate)} title="Show vehicle history">
                        <PlateTag plate={r.plate} flagged={r.blacklisted} />
                      </button>
                    )}
                    {r.correctedFrom && <div className="mt-0.5 font-mono text-[9px] text-ink-mute">corrected from {r.correctedFrom}</div>}
                  </td>
                  <td className="px-2">
                    <img src={r.cropUrl} alt="" className="h-5 rounded-sm" />
                  </td>
                  <td className="px-2">{r.vehicleClass}</td>
                  <td className="px-2 text-ink-dim">{r.color ?? '-'}</td>
                  <td className={`px-2 font-mono ${r.confidence < 0.7 ? 'text-med' : 'text-ink-dim'}`}>{pct(r.confidence)}</td>
                  <td className="px-2">
                    <div className="flex items-center gap-1.5">
                      {r.blacklisted ? (
                        <Chip className="border-crit/50 bg-crit/15 text-crit">
                          <ShieldAlert size={10} className="mr-1" /> Blacklisted
                        </Chip>
                      ) : (
                        <Chip className="border-low/40 bg-low/10 text-low">Clear</Chip>
                      )}
                      {r.needsVerification && (
                        <>
                          <Chip className="border-med/50 bg-med/15 text-med">
                            <TriangleAlert size={10} className="mr-1" /> Verify
                          </Chip>
                          <button className="btn btn-sm" onClick={() => setEditing({ id: r.id, value: r.plate })}>
                            <Pencil size={11} /> Correct
                          </button>
                        </>
                      )}
                      {r.droneWatchId && camAt[r.cameraId] && (
                        <>
                          <InWatchTag alert={{ details: { droneWatchId: r.droneWatchId } }} compact />
                          <ShareNakaButton
                            target={{ plateReadId: r.id }}
                            label={`${r.plate} @ ${camName[r.cameraId]}`}
                            lat={camAt[r.cameraId].lat}
                            lng={camAt[r.cameraId].lng}
                            watchId={r.droneWatchId}
                            sharedAt={r.sharedAt}
                          />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {history && <VehicleHistory plate={history} onClose={() => setHistory(null)} />}
    </>
  )
}

function BlacklistTab() {
  const canManage = useCan('manage')
  const [list, setList] = useState<BlacklistVehicle[] | null>(null)
  const [error, setError] = useState('')
  const [plate, setPlate] = useState('')
  const [reason, setReason] = useState<BlacklistReason>('STOLEN')
  const [priority, setPriority] = useState<Level>('MEDIUM')
  const [notes, setNotes] = useState('')

  const load = useCallback(() => {
    setError('')
    service.getBlacklist().then(setList, (e: Error) => (setError(e.message), setList([])))
  }, [])
  useEffect(load, [load])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    await service.addBlacklistVehicle({ plate: norm(plate), reason, priority, notes })
    audit('BLACKLIST', 'Plate added', norm(plate), `reason ${reason}, priority ${priority}`)
    setPlate('')
    setNotes('')
    load()
  }
  const duplicate = !!list?.some((b) => b.plate === norm(plate))

  return (
    <div className="grid grid-cols-12 gap-3">
      <form onSubmit={add} className="panel col-span-12 space-y-2 self-start p-3 lg:col-span-4">
        <div className="panel-title">Add plate to blacklist</div>
        {!canManage && (
          <InlineWarning>
            <Lock size={11} className="mr-1 inline" />
            Only Commander / Admin can edit the blacklist.
          </InlineWarning>
        )}
        <fieldset disabled={!canManage} className="space-y-2">
          <Field label="Number plate">
            <input className="field font-mono uppercase" value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="RJ14AB1234" required />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Reason">
              <select className="field" value={reason} onChange={(e) => setReason(e.target.value as BlacklistReason)}>
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as Level)}>
                <option value="HIGH">High (critical alert)</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="FIR number, vehicle description..." />
          </Field>
          {duplicate && <div className="text-[11px] text-med">This plate is already blacklisted.</div>}
          <button className="btn btn-primary w-full" type="submit" disabled={norm(plate).length < 4 || duplicate}>
            <Plus size={13} /> Add to blacklist
          </button>
        </fieldset>
        <div className="text-[11px] text-ink-mute">Any ANPR read matching this list raises an ANPR_MATCH alert on every screen.</div>
      </form>

      <div className="panel col-span-12 overflow-x-auto lg:col-span-8">
        {!list ? (
          <SkeletonRows />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !list.length ? (
          <EmptyState title="Blacklist is empty" hint="Add stolen, wanted or suspect vehicle numbers." icon={ShieldAlert} />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="px-2 py-2">Plate</th>
                <th className="px-2">Reason</th>
                <th className="px-2">Priority</th>
                <th className="px-2">Notes</th>
                <th className="px-2">Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id} className="border-b border-base-800">
                  <td className="px-2 py-1.5"><PlateTag plate={b.plate} flagged /></td>
                  <td className="px-2">{REASON_LABEL[b.reason]}</td>
                  <td className="px-2"><Chip className={LEVEL_STYLE[b.priority]}>{b.priority}</Chip></td>
                  <td className="max-w-64 truncate px-2 text-ink-dim">{b.notes}</td>
                  <td className="px-2 font-mono text-ink-mute">{fmtDate(b.addedAt)}</td>
                  <td className="px-2 text-right">
                    <button className="btn btn-sm" disabled={!canManage} onClick={() => void service.removeBlacklistVehicle(b.id).then(() => { audit('BLACKLIST', 'Plate removed', b.plate); load() })}>
                      <Trash2 size={11} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function Anpr() {
  const t = useT()
  const [tab, setTab] = useState<'reads' | 'blacklist'>('reads')
  return (
    <Page>
      <PageHeader title={t('nav.anpr')} subtitle="Automatic Number Plate Recognition: live reads, vehicle history and blacklist" />
      <Tabs tabs={[{ id: 'reads', label: 'Plate reads' }, { id: 'blacklist', label: 'Blacklist manager' }]} value={tab} onChange={setTab} />
      {tab === 'reads' ? <ReadsTab /> : <BlacklistTab />}
    </Page>
  )
}
