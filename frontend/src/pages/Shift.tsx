import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, CheckCheck, Loader2, Send } from 'lucide-react'
import type { ShiftHandover } from '@/types'
import { service } from '@/services'
import { useData, useIncidents } from '@/store/data'
import { useAuth } from '@/store/auth'
import { fmtDateTime, isShelved, keyDetail } from '@/lib/format'
import { isWatchActive } from '@/lib/geo'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { EmptyState, ErrorState, Field, PageHeader, SkeletonRows } from '@/components/ui'

let cache: ShiftHandover[] | null = null
const subs = new Set<(h: ShiftHandover[]) => void>()
async function refresh() {
  cache = await service.getHandovers()
  subs.forEach((cb) => cb(cache!))
  return cache
}

function useHandovers() {
  const [list, setList] = useState<ShiftHandover[] | null>(cache)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    refresh().catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    subs.add(setList)
    if (!cache) load()
    return () => void subs.delete(setList)
  }, [load])
  return { list, error, load }
}

/** One line for the Command Center: last accepted handover, or a pending one. */
export function LastHandover() {
  const t = useT()
  const { list } = useHandovers()
  const h = list?.[0]
  if (!h) return null
  return (
    <Link to="/shift" className="ml-auto flex items-center gap-1.5 text-[11px] text-ink-dim hover:text-ink">
      <ArrowLeftRight size={12} className="text-accent" />
      {h.acceptedAt ? (
        <>
          {t('shift.last')}: {h.from} → {h.acceptedBy} <span className="font-mono">{fmtDateTime(h.acceptedAt).slice(11, 16)}</span>
        </>
      ) : (
        <span className="font-semibold text-med">{t('shift.pending')}: {h.from}</span>
      )}
    </Link>
  )
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="mb-1 text-[10px] tracking-wide text-ink-mute uppercase">
        {title} <span className="font-mono">({items.length})</span>
      </div>
      {items.length ? (
        <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
          {items.map((i) => (
            <li key={i} className="truncate">• {i}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-ink-mute">-</div>
      )}
    </div>
  )
}

export default function Shift() {
  const t = useT()
  const user = useAuth((s) => s.user)
  const cameras = useData((s) => s.cameras)
  const watches = useData((s) => s.droneWatches)
  const incidents = useIncidents()
  const { list, error, load } = useHandovers()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const camName = useMemo(() => Object.fromEntries(cameras.map((c) => [c.id, c.name])), [cameras])

  const summary = useMemo(() => {
    const now = Date.now()
    const open = incidents.filter((i) => ['NEW', 'ACKNOWLEDGED', 'ESCALATED', 'ON_HOLD'].includes(i.status) && now - Date.parse(i.lastSeen) < 86_400_000)
    return {
      openIncidents: open.filter((i) => !i.alerts.some((a) => isShelved(a, now))).slice(0, 30).map((i) => `${i.id} · ${i.status} · ${camName[i.cameraId] ?? i.cameraId} · ${keyDetail(i.alerts[0])}`),
      shelved: open.filter((i) => i.alerts.some((a) => isShelved(a, now))).map((i) => `${i.id} · ${i.alerts.find((a) => a.shelveReason)?.shelveReason ?? ''}`),
      droneWatches: watches.filter((w) => isWatchActive(w, now)).map((w) => `${w.radiusKm} km until ${fmtDateTime(w.expiresAt).slice(11, 16)} · ${w.reason}`),
      camerasOutOfService: cameras.filter((c) => c.outOfService || c.status === 'offline').map((c) => `${c.name} · ${c.outOfService?.reason ?? 'offline'}`),
    }
  }, [incidents, watches, cameras, camName])

  const pending = list?.find((h) => !h.acceptedAt)

  const create = async () => {
    setBusy(true)
    setMsg('')
    try {
      const h = await service.createHandover({ from: user?.name ?? 'Operator', summary, notes: notes.trim() })
      audit('SHIFT', 'Handover created', h.id, `${summary.openIncidents.length} open, ${summary.shelved.length} shelved`)
      setNotes('')
      await refresh()
      setMsg(t('shift.created'))
    } catch {
      setMsg(t('shift.failed'))
    } finally {
      setBusy(false)
    }
  }
  const accept = async (h: ShiftHandover) => {
    setBusy(true)
    try {
      await service.acceptHandover(h.id, user?.name ?? 'Operator')
      audit('SHIFT', 'Handover accepted', h.id, `from ${h.from}`)
      setReviewed(false)
      await refresh()
    } catch {
      setMsg(t('shift.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader title={t('nav.shift')} subtitle={t('shift.subtitle')} />
      <div className="grid grid-cols-12 gap-3">
        <div className="panel col-span-12 space-y-3 p-3 lg:col-span-7">
          <div className="panel-title">{t('shift.outgoing')}</div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryList title={t('shift.open')} items={summary.openIncidents} />
            <SummaryList title={t('shelve.tab')} items={summary.shelved} />
            <SummaryList title={t('shift.watches')} items={summary.droneWatches} />
            <SummaryList title={t('shift.oos')} items={summary.camerasOutOfService} />
          </div>
          <Field label={t('shift.notes')}>
            <textarea className="field h-20 w-full resize-y normal-case" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('shift.notesPh')} />
          </Field>
          <div className="flex items-center gap-2">
            <button className="btn btn-primary" disabled={busy || !!pending} onClick={() => void create()} title={pending ? t('shift.pending') : undefined}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t('shift.create')}
            </button>
            {msg && <span className="text-xs text-low">{msg}</span>}
          </div>
        </div>

        <div className="panel col-span-12 space-y-3 p-3 lg:col-span-5">
          <div className="panel-title">{t('shift.incoming')}</div>
          {!list ? (
            error ? <ErrorState message={error} onRetry={load} /> : <SkeletonRows rows={4} />
          ) : pending ? (
            <div className="space-y-2 rounded border border-med/50 bg-med/5 p-2">
              <div className="text-xs">
                <span className="font-semibold">{pending.from}</span> · <span className="font-mono">{fmtDateTime(pending.createdAt)}</span>
              </div>
              <SummaryList title={t('shift.open')} items={pending.summary.openIncidents} />
              <SummaryList title={t('shelve.tab')} items={pending.summary.shelved} />
              <SummaryList title={t('shift.watches')} items={pending.summary.droneWatches} />
              <SummaryList title={t('shift.oos')} items={pending.summary.camerasOutOfService} />
              {pending.notes && <div className="rounded bg-base-850 p-2 text-xs whitespace-pre-wrap">{pending.notes}</div>}
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> {t('shift.reviewed')}
              </label>
              <button className="btn btn-primary w-full" disabled={!reviewed || busy} onClick={() => void accept(pending)}>
                <CheckCheck size={13} /> {t('shift.accept')}
              </button>
            </div>
          ) : (
            <EmptyState title={t('shift.nonePending')} hint={t('shift.nonePendingHint')} icon={ArrowLeftRight} />
          )}
          <div>
            <div className="mb-1 text-[10px] tracking-wide text-ink-mute uppercase">{t('shift.history')}</div>
            <ul className="divide-y divide-base-800 text-xs">
              {(list ?? []).filter((h) => h.acceptedAt).slice(0, 8).map((h) => (
                <li key={h.id} className="py-1.5">
                  <span className="font-mono text-ink-mute">{fmtDateTime(h.acceptedAt!)}</span> {h.from} → <span className="font-semibold">{h.acceptedBy}</span>
                  {h.notes && <div className="truncate text-ink-dim">{h.notes}</div>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Page>
  )
}
