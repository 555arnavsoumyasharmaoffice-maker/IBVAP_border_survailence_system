import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { Fence, History, Lock, Minus, Pentagon, Save, Trash2, Undo2 } from 'lucide-react'
import type { Severity, TripwireDirection, Zone, ZoneAuditEntry, ZoneClass } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth, useCan } from '@/store/auth'
import { SEV, SEVERITIES, fmtDateTime } from '@/lib/format'
import { DIRECTION_LABEL, tripwireArrows } from '@/lib/zones'
import { useT } from '@/i18n'
import { CameraFeed } from '@/components/CameraFeed'
import { Chip, EmptyState, Field, InlineWarning, Skeleton, Tabs } from '@/components/ui'

type Draft = Omit<Zone, 'id'> & { id?: string }
type Pt = [number, number]

const CLASSES: { id: ZoneClass; label: string }[] = [
  { id: 'person', label: 'Person' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'animal', label: 'Animal' },
]
const ACTION_STYLE: Record<ZoneAuditEntry['action'], string> = {
  CREATE: 'border-low/50 bg-low/15 text-low',
  UPDATE: 'border-accent/50 bg-accent/15 text-accent',
  DELETE: 'border-crit/50 bg-crit/15 text-crit',
}

const newDraft = (cameraId: string, type: Zone['type']): Draft => ({
  cameraId,
  name: '',
  type,
  points: [],
  active: true,
  schedule: 'always',
  severity: type === 'line' ? 'CRITICAL' : 'HIGH',
  classes: ['person', 'vehicle'], // animals ignored by default
  minDwellSec: type === 'line' ? 0 : 5,
  direction: 'both',
})

const minPoints = (type: Zone['type']) => (type === 'line' ? 2 : 3)

export default function Zones() {
  const t = useT()
  const canManage = useCan('manage')
  const userName = useAuth((s) => s.user?.name ?? 'Unknown')
  const { cameras, zones, loading, refreshZones } = useData()
  const [cameraId, setCameraId] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  /** True while points are still being placed for a new shape. */
  const [drawing, setDrawing] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'zones' | 'log'>('zones')
  const [audit, setAudit] = useState<ZoneAuditEntry[] | null>(null)
  const [size, setSize] = useState({ w: 1, h: 1 })
  const stageRef = useRef<HTMLDivElement>(null)

  const camera = cameras.find((c) => c.id === cameraId) ?? cameras.find((c) => c.status !== 'offline') ?? cameras[0]
  const camZones = zones.filter((z) => z.cameraId === camera?.id)
  const camName = (id: string) => cameras.find((c) => c.id === id)?.name ?? id

  const loadAudit = useCallback(() => {
    service.getZoneAudit().then(setAudit, () => setAudit([]))
  }, [])
  useEffect(loadAudit, [loadAudit])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1, h: el.clientHeight || 1 }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [camera?.id])

  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await refreshZones()
      loadAudit()
    } finally {
      setBusy(false)
    }
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const cancel = () => {
    setDraft(null)
    setDrawing(false)
    setDrag(null)
  }
  const startNew = (type: Zone['type']) => {
    if (!camera) return
    setDraft(newDraft(camera.id, type))
    setDrawing(true)
    setTab('zones')
  }
  const select = (z: Zone) => {
    setDraft(structuredClone(z))
    setDrawing(false)
  }
  const redraw = () => {
    patch({ points: [] })
    setDrawing(true)
  }

  const toNorm = (e: { clientX: number; clientY: number; currentTarget: Element }): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    const clamp = (v: number) => Number(Math.min(1, Math.max(0, v)).toFixed(4))
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]
  }

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    // detail > 1 is the second click of a double-click: that one finishes the polygon instead.
    if (!draft || !drawing || e.detail > 1) return
    const points = [...draft.points, toNorm(e)]
    patch({ points })
    if (draft.type === 'line' && points.length === 2) setDrawing(false)
  }
  const onDoubleClick = () => {
    if (draft && drawing && draft.type === 'polygon' && draft.points.length >= 3) setDrawing(false)
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (drag === null || !draft) return
    const p = toNorm(e)
    patch({ points: draft.points.map((q, i) => (i === drag ? p : q)) })
  }

  const save = () =>
    mutate(async () => {
      if (!draft) return
      const saved = await service.saveZone({ ...draft, name: draft.name.trim() || (draft.type === 'line' ? 'New tripwire' : 'New zone') }, userName)
      setDraft(structuredClone(saved))
    })
  const remove = (z: { id?: string }) =>
    mutate(async () => {
      if (z.id) await service.deleteZone(z.id, userName)
      cancel()
    })

  if (loading && !cameras.length) {
    return (
      <div className="flex h-full gap-2 p-2">
        <Skeleton className="h-full flex-1" />
        <Skeleton className="h-full w-80" />
      </div>
    )
  }
  if (!camera) {
    return (
      <div className="h-full p-2">
        <div className="panel h-full">
          <EmptyState title="No cameras configured" hint="Zones are drawn on a camera view. Add a camera first." icon={Fence} />
        </div>
      </div>
    )
  }

  const px = (p: Pt) => `${p[0] * size.w},${p[1] * size.h}`
  const shapeComplete = !!draft && !drawing && draft.points.length >= minPoints(draft.type)
  const canSave = canManage && shapeComplete && draft.classes.length > 0 && !busy
  const hint = !draft
    ? ''
    : drawing
      ? draft.type === 'polygon'
        ? `Click to add points (${draft.points.length} placed). Double-click to finish.`
        : `Click point ${draft.points.length === 0 ? 'A' : 'B'} of the tripwire.`
      : canManage
        ? 'Drag the white handles to adjust the shape.'
        : ''

  return (
    <div className="flex h-full gap-2 p-2">
      <div className="panel flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-2 py-1.5">
          <h1 className="text-base font-semibold">{t('zones.title')}</h1>
          <select
            className="field"
            value={camera.id}
            aria-label="Camera"
            onChange={(e) => {
              setCameraId(e.target.value)
              cancel()
            }}
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <button className={`btn btn-sm ${draft && !draft.id && draft.type === 'polygon' ? 'btn-primary' : ''}`} disabled={!canManage} onClick={() => startNew('polygon')}>
              <Pentagon size={12} /> {t('zones.polygon')}
            </button>
            <button className={`btn btn-sm ${draft && !draft.id && draft.type === 'line' ? 'btn-primary' : ''}`} disabled={!canManage} onClick={() => startNew('line')}>
              <Minus size={12} /> {t('zones.line')}
            </button>
            <button className="btn btn-sm" disabled={!drawing || !draft?.points.length} onClick={() => draft && patch({ points: draft.points.slice(0, -1) })}>
              <Undo2 size={12} /> Undo point
            </button>
          </div>
          {hint && <span className="text-xs text-accent">{hint}</span>}
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1">
          <CameraFeed camera={camera} showBoxes={!draft} hideZoneId={draft?.id} className="h-full w-full" />
          {draft && (
            <svg
              className={`absolute inset-0 h-full w-full touch-none ${drawing ? 'cursor-crosshair' : ''}`}
              viewBox={`0 0 ${size.w} ${size.h}`}
              onClick={onClick}
              onDoubleClick={onDoubleClick}
              onPointerMove={onPointerMove}
              onPointerUp={() => setDrag(null)}
              onPointerLeave={() => setDrag(null)}
            >
              <g stroke="#38bdf8" strokeWidth="2.5" fill="none" strokeLinejoin="round" strokeLinecap="round">
                {draft.points.length > 1 &&
                  (draft.type === 'polygon' && !drawing ? (
                    <polygon points={draft.points.map(px).join(' ')} fill="rgba(56,189,248,0.18)" />
                  ) : (
                    <polyline points={draft.points.map(px).join(' ')} strokeDasharray={draft.type === 'line' ? '10 6' : undefined} />
                  ))}
                {draft.type === 'line' &&
                  draft.points.length === 2 &&
                  tripwireArrows(draft.points, draft.direction, size.w, size.h, 30).map((line, i) => (
                    <polyline key={i} points={line.map((p) => p.join(',')).join(' ')} stroke="#fde047" strokeWidth="3" />
                  ))}
              </g>
              {draft.points.map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p[0] * size.w}
                    cy={p[1] * size.h}
                    r={drag === i ? 9 : 7}
                    fill="#fff"
                    stroke="#0ea5e9"
                    strokeWidth="3"
                    className={!drawing && canManage ? 'cursor-grab' : ''}
                    onPointerDown={(e) => {
                      if (drawing || !canManage) return
                      e.stopPropagation()
                      e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId)
                      setDrag(i)
                    }}
                  />
                  {draft.type === 'line' && (
                    <text x={p[0] * size.w + 12} y={p[1] * size.h - 10} fill="#fff" fontSize="13" fontWeight="700" fontFamily="JetBrains Mono, monospace" className="pointer-events-none">
                      {i === 0 ? 'A' : 'B'}
                    </text>
                  )}
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>

      <aside className="panel flex w-80 shrink-0 flex-col">
        <div className="px-2 pt-2">
          <Tabs
            tabs={[
              { id: 'zones', label: 'Zones', count: camZones.length },
              { id: 'log', label: t('zones.log'), count: audit?.length },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {tab === 'log' ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {!audit ? (
              <Skeleton className="h-24" />
            ) : !audit.length ? (
              <EmptyState title="No zone changes logged yet" hint="Every create, edit and delete is recorded with user and time." icon={History} />
            ) : (
              <ul className="space-y-1.5">
                {audit.map((a) => (
                  <li key={a.id} className="rounded border border-base-700 bg-base-850 p-2 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <Chip className={ACTION_STYLE[a.action]}>{a.action}</Chip>
                      <span className="truncate font-semibold">{a.zoneName}</span>
                    </div>
                    <div className="mt-0.5 text-ink-dim">{a.changes}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-ink-mute">
                      {fmtDateTime(a.at)} · {a.by} · {camName(a.cameraId)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
            {!canManage && (
              <InlineWarning>
                <Lock size={11} className="mr-1 inline" />
                {t('zones.readOnly')}
              </InlineWarning>
            )}

            {!camZones.length && !draft && <EmptyState title="No zones on this camera" hint="Use Polygon zone for a restricted area or Tripwire line for a virtual fence." icon={Fence} />}

            {camZones.map((z) => (
              <button
                key={z.id}
                onClick={() => select(z)}
                className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left ${draft?.id === z.id ? 'border-accent bg-accent/10' : 'border-base-700 bg-base-850 hover:bg-base-800'} ${z.active ? '' : 'opacity-60'}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${SEV[z.severity].bg}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{z.name}</span>
                  <span className="block truncate text-[10px] text-ink-mute">
                    {z.type === 'line' ? 'tripwire' : 'polygon'} · {z.schedule} · {z.classes.join('+')}
                    {z.minDwellSec ? ` · ${z.minDwellSec}s dwell` : ''}
                  </span>
                </span>
                {!z.active && <Chip>off</Chip>}
              </button>
            ))}

            {draft && (
              <fieldset disabled={!canManage || busy} className="space-y-2.5 rounded border border-accent/50 bg-base-850 p-2">
                <div className="panel-title">{draft.id ? 'Zone settings' : `New ${draft.type === 'line' ? 'tripwire' : 'polygon zone'}`}</div>
                <Field label="Name">
                  <input className="field" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Fence Line West" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Type">
                    <input className="field" value={draft.type === 'line' ? 'Tripwire line' : 'Polygon zone'} readOnly />
                  </Field>
                  <Field label="Schedule">
                    <select className="field" value={draft.schedule} onChange={(e) => patch({ schedule: e.target.value as Zone['schedule'] })}>
                      <option value="always">Always armed</option>
                      <option value="night-only">Night only</option>
                    </select>
                  </Field>
                  <Field label="Severity raised">
                    <select className="field" value={draft.severity} onChange={(e) => patch({ severity: e.target.value as Severity })}>
                      {SEVERITIES.map((s) => (
                        <option key={s} value={s}>{t(`sev.${s}`)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Min dwell (seconds)">
                    <input
                      type="number"
                      min={0}
                      max={600}
                      className="field font-mono"
                      value={draft.minDwellSec}
                      onChange={(e) => patch({ minDwellSec: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
                    />
                  </Field>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-mute uppercase">Triggered by</div>
                  <div className="flex gap-3">
                    {CLASSES.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="checkbox"
                          checked={draft.classes.includes(c.id)}
                          onChange={(e) => patch({ classes: e.target.checked ? [...draft.classes, c.id] : draft.classes.filter((x) => x !== c.id) })}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                  {!draft.classes.length && <div className="mt-1 text-[11px] text-med">Pick at least one object class.</div>}
                </div>
                {draft.type === 'line' && (
                  <Field label="Crossing direction that triggers">
                    <select className="field" value={draft.direction} onChange={(e) => patch({ direction: e.target.value as TripwireDirection })}>
                      {(Object.keys(DIRECTION_LABEL) as TripwireDirection[]).map((d) => (
                        <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
                      ))}
                    </select>
                    <span className="text-[10px] normal-case">The yellow arrow on the video shows the triggering direction.</span>
                  </Field>
                )}
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={draft.active} onChange={(e) => patch({ active: e.target.checked })} />
                  Active (armed)
                </label>
                <div className="text-[10px] text-ink-mute">A longer dwell time reduces false alarms from people or animals briefly passing through.</div>
                <div className="flex flex-wrap gap-1.5">
                  <button className="btn btn-primary flex-1" disabled={!canSave} onClick={() => void save()}>
                    <Save size={13} /> {draft.id ? 'Save changes' : 'Create zone'}
                  </button>
                  <button className="btn" onClick={redraw} title="Clear the shape and draw it again">
                    Redraw
                  </button>
                  {draft.id && (
                    <button className="btn btn-danger" aria-label="Delete zone" title="Delete zone" onClick={() => void remove(draft)}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </fieldset>
            )}
            {draft && (
              <button className="btn w-full" onClick={cancel}>
                {canManage ? 'Cancel / close' : 'Close'}
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}
