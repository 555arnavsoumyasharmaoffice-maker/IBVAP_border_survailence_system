import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, CheckCheck, Loader2, MapPin, Navigation, ShieldCheck, Siren } from 'lucide-react'
import type { Incident, QrtStatus } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'
import { useData, useIncidents } from '@/store/data'
import { SEV, fmtTime, keyDetail, relTime } from '@/lib/format'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { EmptyState, Skeleton, useNow } from '@/components/ui'
import { DemoBanner } from '@/components/layout/Layout'

const NEXT: Partial<Record<QrtStatus, { status: QrtStatus; key: 'qrt.accept' | 'qrt.onScene' | 'qrt.clear'; cls: string }>> = {
  ASSIGNED: { status: 'ACCEPTED', key: 'qrt.accept', cls: 'bg-accent text-black' },
  ACCEPTED: { status: 'ON_SCENE', key: 'qrt.onScene', cls: 'bg-high text-black' },
  ON_SCENE: { status: 'CLEARED', key: 'qrt.clear', cls: 'bg-low text-black' },
}
const STEPS: QrtStatus[] = ['ASSIGNED', 'ACCEPTED', 'ON_SCENE', 'CLEARED']

/** Status of the QRT task for an incident: the furthest step any of its alerts reached. */
export const qrtStatusOf = (i: Incident): QrtStatus | undefined =>
  i.alerts.reduce<QrtStatus | undefined>((best, a) => (a.qrtStatus && (!best || STEPS.indexOf(a.qrtStatus) > STEPS.indexOf(best)) ? a.qrtStatus : best), undefined)

function Task({ incident, now }: { incident: Incident; now: number }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const camera = useData((s) => s.cameras.find((c) => c.id === incident.cameraId))
  const status = qrtStatusOf(incident)!
  const next = NEXT[status]
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const a = incident.alerts[0]
  const advance = async () => {
    if (!next) return
    setBusy(true)
    setErr('')
    try {
      const out = await service.updateQrtStatus(incident.alerts.map((x) => x.id), next.status, `QRT (${user?.name ?? 'team'})`)
      out.forEach((x) => useData.getState().ingest(x))
      audit('ALERT', `QRT ${t(`qrt.s.${next.status}`)}`, incident.id, camera?.name ?? '')
    } catch {
      setErr(t('qrt.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={`overflow-hidden rounded-lg border bg-base-850 ${status === 'CLEARED' ? 'border-base-700 opacity-60' : SEV[incident.severity].border}`}>
      <div className={`flex items-center gap-2 px-3 py-2 ${status === 'CLEARED' ? 'bg-base-800' : 'bg-base-800'}`}>
        <Siren size={18} className={SEV[incident.severity].text} />
        <span className="text-base font-semibold">{t(`type.${incident.type}`)}</span>
        <span className="ml-auto font-mono text-xs text-ink-mute">{relTime(incident.firstSeen, now)}</span>
      </div>
      <div className="space-y-1 px-3 py-2 text-sm">
        <div className="flex items-center gap-1.5 font-medium">
          <MapPin size={14} className="text-accent" /> {camera?.name ?? incident.cameraId}
        </div>
        <div className="text-xs text-ink-dim">{camera?.locationName}</div>
        {camera && (
          <div className="font-mono text-xs text-ink-dim">
            {camera.lat.toFixed(5)}, {camera.lng.toFixed(5)}
          </div>
        )}
        <div className="font-mono text-xs">{keyDetail(a)}</div>
        <div className="text-[11px] text-ink-mute">
          {incident.id} · {fmtTime(incident.firstSeen)} · x{incident.alerts.length}
        </div>
      </div>
      <ol className="flex gap-1 px-3 pb-2">
        {STEPS.map((st) => (
          <li key={st} className={`flex-1 rounded py-0.5 text-center text-[10px] font-semibold uppercase ${STEPS.indexOf(st) <= STEPS.indexOf(status) ? 'bg-accent/25 text-accent' : 'bg-base-800 text-ink-mute'}`}>
            {t(`qrt.s.${st}`)}
          </li>
        ))}
      </ol>
      {next ? (
        <button className={`flex w-full items-center justify-center gap-2 py-4 text-lg font-bold ${next.cls} disabled:opacity-50`} disabled={busy} onClick={() => void advance()}>
          {busy ? <Loader2 size={20} className="animate-spin" /> : next.status === 'CLEARED' ? <CheckCheck size={20} /> : next.status === 'ON_SCENE' ? <Navigation size={20} /> : <ShieldCheck size={20} />}
          {t(next.key)}
        </button>
      ) : (
        <div className="py-3 text-center text-sm font-semibold text-low">{t('qrt.s.CLEARED')}</div>
      )}
      {err && <div className="px-3 pb-2 text-xs text-crit">{err}</div>}
    </div>
  )
}

/** Phone-width view for the Quick Reaction Team: their assigned incidents with big Accept / On scene / Cleared buttons. */
export default function QrtView() {
  const t = useT()
  const user = useAuth((s) => s.user)
  const loading = useData((s) => s.loading)
  const incidents = useIncidents()
  const now = useNow(5000)
  // This route sits outside the dashboard layout, so it starts the live data itself.
  useEffect(() => (user ? useData.getState().start() : undefined), [user])
  const tasks = useMemo(
    () =>
      incidents
        .filter((i) => qrtStatusOf(i))
        .sort((a, b) => Number(qrtStatusOf(a) === 'CLEARED') - Number(qrtStatusOf(b) === 'CLEARED') || b.lastSeen.localeCompare(a.lastSeen))
        .slice(0, 20),
    [incidents],
  )
  if (!user) return <Navigate to="/login" replace />
  const open = tasks.filter((i) => qrtStatusOf(i) !== 'CLEARED').length
  return (
    <div className="h-full overflow-y-auto bg-base-950">
      <div className="mx-auto flex min-h-full max-w-sm flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-base-700 bg-base-900 px-3 py-2.5">
          <Link to="/" className="text-ink-mute hover:text-ink" aria-label={t('qrt.back')} title={t('qrt.back')}>
            <ArrowLeft size={18} />
          </Link>
          <ShieldCheck size={18} className="text-accent" />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">{t('qrt.title')}</div>
            <div className="text-[10px] text-ink-mute">{user.name}</div>
          </div>
          <span className="ml-auto rounded bg-crit px-2 py-0.5 font-mono text-xs font-bold text-white">{open}</span>
        </header>
        <main className="flex-1 space-y-3 p-3">
          {loading && !incidents.length ? (
            Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-56" />)
          ) : tasks.length ? (
            tasks.map((i) => <Task key={i.id} incident={i} now={now} />)
          ) : (
            <EmptyState title={t('qrt.none')} hint={t('qrt.noneHint')} />
          )}
        </main>
        {service.mode === 'mock' && <div className="p-3 pb-16 text-center text-[10px] text-ink-mute">{t('qrt.mockNote')}</div>}
        <DemoBanner />
      </div>
    </div>
  )
}
