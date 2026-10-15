import { useMemo, useState, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Drone, Loader2, Share2 } from 'lucide-react'
import type { Alert, DroneWatch, Naka } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { audit } from '@/lib/audit'
import { distanceKm, isWatchActive } from '@/lib/geo'
import { fmtTime } from '@/lib/format'
import { useT } from '@/i18n'
import { Modal, useNow } from './ui'

export function fmtLeft(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export function useActiveWatches() {
  const now = useNow(10_000)
  const watches = useData((s) => s.droneWatches)
  return useMemo(() => watches.filter((w) => isWatchActive(w, now)), [watches, now])
}

/** Top-bar chip with countdown while a drone watch is active. */
export function WatchBanner() {
  const t = useT()
  const now = useNow(1000)
  const active = useActiveWatches()
  if (!active.length) return null
  const w = active[0]
  return (
    <Link
      to={`/map?watch=${w.id}`}
      className="flex items-center gap-1.5 rounded border border-accent/60 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-accent"
      title={w.reason}
    >
      <Drone size={13} className="animate-pulse" />
      <span className="hidden 2xl:inline">{t('drone.active')}</span> {w.radiusKm} km
      <span className="font-mono">{fmtLeft(Date.parse(w.expiresAt) - now)}</span> {t('drone.left')}
      {active.length > 1 && <span className="font-mono">+{active.length - 1}</span>}
    </Link>
  )
}

/** "In drone watch area" tag, with the severity raise when there was one. */
export function InWatchTag({ alert, compact = false }: { alert: Pick<Alert, 'details'>; compact?: boolean }) {
  const t = useT()
  if (!alert.details.droneWatchId) return null
  const from = alert.details.severityRaisedFrom
  return (
    <span className="inline-flex items-center gap-1 rounded border border-accent/50 bg-accent/10 px-1 text-[9px] font-semibold whitespace-nowrap text-accent uppercase" title={from ? `${t('drone.raised')} ${t(`sev.${from}`)}` : undefined}>
      <Drone size={10} /> {compact ? 'Drone watch' : t('drone.inArea')}
      {from && !compact && <span className="font-mono normal-case">↑ {t(`sev.${from}`)}</span>}
    </span>
  )
}

/** Nakas near a point: those inside the watch first, then the closest others (max 6). */
export function nearbyNakas(nakas: Naka[], lat: number, lng: number, watch?: DroneWatch) {
  return nakas
    .map((n) => ({ ...n, km: distanceKm(lat, lng, n.lat, n.lng), inside: !!watch && distanceKm(watch.lat, watch.lng, n.lat, n.lng) <= watch.radiusKm }))
    .filter((n) => n.km <= (watch?.radiusKm ?? 0) + 12)
    .sort((a, b) => Number(b.inside) - Number(a.inside) || a.km - b.km)
    .slice(0, 6)
}

/** Simulated hand-off of an incident or plate read to police nakas. Writes history kind "shared" + audit. */
export function ShareNakaButton({ target, label, lat, lng, watchId, sharedAt, className = 'btn btn-sm' }: {
  target: { alertIds?: string[]; plateReadId?: string }
  label: string
  lat: number
  lng: number
  watchId?: string
  sharedAt?: string
  className?: string
}) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const nakas = useData((s) => s.nakas)
  const watch = useData((s) => s.droneWatches.find((w) => w.id === watchId))
  const near = useMemo(() => nearbyNakas(nakas, lat, lng, watch), [nakas, lat, lng, watch])
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const show = (e: MouseEvent) => {
    e.stopPropagation()
    setPicked(near.filter((n) => n.inside).map((n) => n.id).slice(0, 3).concat(near.some((n) => n.inside) ? [] : near.slice(0, 1).map((n) => n.id)))
    setState('idle')
    setOpen(true)
  }
  const send = async () => {
    setState('sending')
    try {
      await service.shareWithNaka(target, picked, user?.name ?? 'Operator')
      const names = nakas.filter((n) => picked.includes(n.id)).map((n) => n.name).join(', ')
      audit('DRONE', 'Shared with police naka', label, names)
      setState('sent')
    } catch {
      setState('failed')
    }
  }
  return (
    <>
      <button className={className} onClick={show} title={t('drone.share')}>
        <Share2 size={12} /> {t('drone.share')}
        {sharedAt && <span className="font-mono text-[10px] text-low">{fmtTime(sharedAt)}</span>}
      </button>
      {open && (
        <Modal title={`${t('drone.share')}: ${label}`} onClose={() => setOpen(false)}>
          <div className="space-y-2 text-xs" onClick={(e) => e.stopPropagation()}>
            {near.length ? (
              <ul className="divide-y divide-base-700 rounded border border-base-700">
                {near.map((n) => (
                  <li key={n.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-2 py-1.5">
                      <input type="checkbox" checked={picked.includes(n.id)} disabled={state === 'sent'} onChange={() => setPicked((p) => (p.includes(n.id) ? p.filter((x) => x !== n.id) : [...p, n.id]))} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{n.name}</span>
                        <span className="text-[10px] text-ink-mute">{n.agency}</span>
                      </span>
                      {n.inside && <span className="rounded bg-accent/15 px-1 text-[9px] font-semibold text-accent uppercase">{t('drone.inside')}</span>}
                      <span className="font-mono text-[10px] text-ink-dim">{n.km.toFixed(1)} km</span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-ink-mute">No nakas within 12 km.</div>
            )}
            <div className="text-[10px] text-ink-mute">{t('drone.shareHint')}</div>
            {state === 'sent' ? (
              <button className="btn w-full" onClick={() => setOpen(false)}>
                <span className="text-low">{t('drone.shared')}</span> · Close
              </button>
            ) : (
              <button className="btn btn-primary w-full" disabled={!picked.length || state === 'sending'} onClick={() => void send()}>
                {state === 'sending' ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} {t('drone.send')} ({picked.length})
              </button>
            )}
            {state === 'failed' && <div className="text-crit">Not shared: backend not reachable.</div>}
          </div>
        </Modal>
      )}
    </>
  )
}
