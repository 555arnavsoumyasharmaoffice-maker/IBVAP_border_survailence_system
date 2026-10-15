import { useState, type MouseEvent } from 'react'
import { ArchiveRestore, Clock, Loader2, PowerOff, Wrench } from 'lucide-react'
import type { Alert, Camera } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth, useCan } from '@/store/auth'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { Field, Modal } from './ui'

const MINUTES = [15, 30, 60] as const

/** Shelve (snooze) one alert or a whole incident for 15/30/60 min. A reason is mandatory. */
export function ShelveButton({ alerts, label, className = 'btn btn-sm' }: { alerts: Alert[]; label: string; className?: string }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState<number>(30)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const show = (e: MouseEvent) => {
    e.stopPropagation()
    setReason('')
    setErr('')
    setOpen(true)
  }
  const save = async () => {
    setBusy(true)
    try {
      const out = await service.shelveAlerts(alerts.map((a) => a.id), minutes, reason.trim(), user?.name ?? 'Operator')
      out.forEach((a) => useData.getState().ingest(a))
      audit('ALERT', 'Shelved', label, `${minutes} min: ${reason.trim()}`)
      useData.getState().notice(`${t('shelve.done')}: ${label} (${minutes} min)`)
      setOpen(false)
    } catch {
      setErr(t('shelve.failed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className={className} onClick={show} title={t('shelve.hint')}>
        <Clock size={12} /> {t('shelve.btn')}
      </button>
      {open && (
        <Modal title={`${t('shelve.btn')}: ${label}`} onClose={() => setOpen(false)}>
          <div className="space-y-3 text-xs" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-2">
              {MINUTES.map((m) => (
                <button key={m} className={`btn flex-1 font-mono ${minutes === m ? 'btn-primary' : ''}`} onClick={() => setMinutes(m)}>
                  {m} min
                </button>
              ))}
            </div>
            <Field label={`${t('shelve.reason')} *`}>
              <input autoFocus className="field w-full normal-case" placeholder={t('shelve.reasonPh')} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="text-[11px] text-ink-mute">{t('shelve.explain')}</div>
            {err && <div className="text-crit">{err}</div>}
            <button className="btn btn-primary w-full" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Clock size={13} />} {t('shelve.btn')} {minutes} min
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

/** Commander / Admin: return shelved alerts to the live feed early. */
export function UnshelveButton({ alerts, label }: { alerts: Alert[]; label: string }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const can = useCan('resolve')
  return (
    <button
      className="btn btn-sm"
      disabled={!can}
      title={can ? undefined : t('shelve.onlyCmd')}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          const out = await service.unshelveAlerts(alerts.map((a) => a.id), user?.name ?? 'Commander', 'Unshelved by commander')
          out.forEach((a) => useData.getState().ingest(a))
          audit('ALERT', 'Unshelved', label, 'returned to live feed early')
        } catch {
          /* link down */
        }
      }}
    >
      <ArchiveRestore size={12} /> {t('shelve.unshelve')}
    </button>
  )
}

/** Commander / Admin: mark a camera out of service with a reason, or bring it back. */
export function OutOfServiceControl({ camera }: { camera: Camera }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const can = useCan('manage')
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (!can) return null
  const apply = async (r: string | null) => {
    try {
      await service.setCameraOutOfService(camera.id, r, user?.name ?? 'Commander')
      audit('CAMERA', r ? 'Set out of service' : 'Back in service', camera.name, r ?? '')
      await useData.getState().refreshCameras()
      setOpen(false)
    } catch {
      /* link down */
    }
  }
  if (camera.outOfService) {
    return (
      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); void apply(null) }} title={t('oos.restore')}>
        <Wrench size={11} /> {t('oos.restore')}
      </button>
    )
  }
  return (
    <>
      <button
        className="flex h-5 w-5 items-center justify-center rounded text-ink-mute hover:text-ink"
        title={t('oos.set')}
        aria-label={t('oos.set')}
        onClick={(e) => {
          e.stopPropagation()
          setReason('')
          setOpen(true)
        }}
      >
        <PowerOff size={12} />
      </button>
      {open && (
        <Modal title={`${t('oos.set')}: ${camera.name}`} onClose={() => setOpen(false)}>
          <div className="space-y-3 text-xs">
            <Field label={`${t('shelve.reason')} *`}>
              <input autoFocus className="field w-full normal-case" placeholder={t('oos.reasonPh')} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="text-[11px] text-ink-mute">{t('oos.explain')}</div>
            <button className="btn btn-danger w-full" disabled={reason.trim().length < 3} onClick={() => void apply(reason.trim())}>
              <PowerOff size={13} /> {t('oos.set')}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
