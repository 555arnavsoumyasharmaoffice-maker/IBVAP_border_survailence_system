import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpCircle, Check, RefreshCw, Siren, Video, X } from 'lucide-react'
import { useData, type Toast } from '@/store/data'
import { SEV, fmtDateTime, keyDetail } from '@/lib/format'
import { useT } from '@/i18n'
import { SeverityBadge, TYPE_ICON } from './ui'

const TOAST_MS = 8000

function ToastItem({ toast }: { toast: Toast }) {
  const t = useT()
  const navigate = useNavigate()
  const alert = useData((s) => s.alerts.find((a) => a.id === toast.alertId))
  const camera = useData((s) => s.cameras.find((c) => c.id === alert?.cameraId))
  const dismiss = useData((s) => s.dismissToast)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.key), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast.key, dismiss])
  if (!alert) return null
  const Icon = TYPE_ICON[alert.type]
  return (
    <div
      role="alert"
      onClick={() => {
        dismiss(toast.key)
        navigate(`/alerts/${alert.id}`)
      }}
      className={`toast-in pointer-events-auto flex w-80 cursor-pointer overflow-hidden rounded border bg-base-850 shadow-xl shadow-black/60 ${SEV[alert.severity].border}`}
    >
      <div className={`w-1.5 ${SEV[alert.severity].bg}`} />
      <div className="min-w-0 flex-1 p-2.5">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={SEV[alert.severity].text} />
          <span className="truncate text-xs font-semibold">{t(`type.${alert.type}`)}</span>
          {toast.repeat && (
            <span className="flex items-center gap-0.5 rounded bg-crit/20 px-1 text-[9px] font-bold text-crit">
              <RefreshCw size={9} /> UNACKNOWLEDGED
            </span>
          )}
          <button
            aria-label="Dismiss"
            className="ml-auto text-ink-mute hover:text-ink"
            onClick={(e) => {
              e.stopPropagation()
              dismiss(toast.key)
            }}
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-ink-dim">{camera?.name}</div>
        <div className="truncate font-mono text-[11px]">{keyDetail(alert)}</div>
      </div>
    </div>
  )
}

export function AlertToasts() {
  const toasts = useData((s) => s.toasts)
  return (
    <div className="no-print pointer-events-none fixed right-3 bottom-3 z-[1800] flex flex-col-reverse gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.key} toast={toast} />
      ))}
    </div>
  )
}

/** Full-screen modal for FENCE_INTRUSION / FACE_MATCH. Shows one at a time from a queue. */
export function CriticalModal() {
  const t = useT()
  const navigate = useNavigate()
  const queue = useData((s) => s.modalQueue)
  const alert = useData((s) => s.alerts.find((a) => a.id === s.modalQueue[0]))
  const camera = useData((s) => s.cameras.find((c) => c.id === alert?.cameraId))
  const setStatus = useData((s) => s.setStatus)
  const dismissModal = useData((s) => s.dismissModal)

  // Drop queue entries that no longer need attention (handled elsewhere / unknown id).
  useEffect(() => {
    if (queue.length && (!alert || alert.status !== 'NEW')) dismissModal(queue[0])
  }, [queue, alert, dismissModal])

  if (!alert || alert.status !== 'NEW') return null
  const Icon = TYPE_ICON[alert.type]
  return (
    <div className="no-print crit-backdrop fixed inset-0 z-[2000] flex items-center justify-center p-6 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-lg border-2 border-crit bg-base-900 shadow-2xl shadow-black">
        <div className="flex items-center gap-3 bg-crit px-4 py-2 text-white">
          <Siren size={22} className="animate-pulse" />
          <div className="text-lg font-bold tracking-widest">{t('critical.title')}</div>
          {queue.length > 1 && <span className="rounded bg-black/30 px-2 py-0.5 font-mono text-xs">+{queue.length - 1} queued</span>}
          <button className="ml-auto opacity-80 hover:opacity-100" aria-label="Dismiss" title="Dismiss (alert stays NEW and will re-notify)" onClick={() => dismissModal(alert.id)}>
            <X size={18} />
          </button>
        </div>
        <div className="grid grid-cols-5 gap-4 p-4">
          <div className="relative col-span-3 aspect-video overflow-hidden rounded border border-base-600 bg-black">
            <img src={alert.snapshotUrl} alt="Alert snapshot" className="h-full w-full object-cover" />
          </div>
          <div className="col-span-2 flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Icon size={20} className="text-crit" />
              <span className="text-base font-semibold">{t(`type.${alert.type}`)}</span>
            </div>
            <SeverityBadge severity={alert.severity} />
            <dl className="mt-1 grid grid-cols-[72px_1fr] gap-y-1 text-xs">
              <dt className="text-ink-mute">{t('common.camera')}</dt>
              <dd className="font-medium">{camera?.name}</dd>
              <dt className="text-ink-mute">Location</dt>
              <dd>{camera?.locationName}</dd>
              <dt className="text-ink-mute">{t('common.time')}</dt>
              <dd className="font-mono">{fmtDateTime(alert.timestamp)}</dd>
              <dt className="text-ink-mute">Detail</dt>
              <dd className="font-mono">{keyDetail(alert)}</dd>
              <dt className="text-ink-mute">ID</dt>
              <dd className="font-mono">{alert.id}</dd>
            </dl>
            <div className="mt-auto flex flex-col gap-2">
              <button className="btn btn-danger py-2 text-sm" onClick={() => void setStatus(alert.id, 'ACKNOWLEDGED')}>
                <Check size={16} /> {t('act.ack')} <kbd className="rounded bg-black/30 px-1 font-mono text-[10px]">A</kbd>
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn" onClick={() => void setStatus(alert.id, 'ESCALATED')}>
                  <ArrowUpCircle size={14} /> {t('act.escalate')}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    dismissModal(alert.id)
                    navigate(`/cameras?cam=${alert.cameraId}`)
                  }}
                >
                  <Video size={14} /> {t('act.viewCamera')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
