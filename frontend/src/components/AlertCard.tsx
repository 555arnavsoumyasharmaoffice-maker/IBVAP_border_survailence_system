import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpCircle, Ban, Check, CheckCheck } from 'lucide-react'
import type { Alert } from '@/types'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useCan } from '@/store/auth'
import { SEV, keyDetail, relTime } from '@/lib/format'
import { useT } from '@/i18n'
import { StatusBadge, TYPE_ICON } from './ui'

/** Workflow buttons. Operators: acknowledge / escalate / false alarm. Commander+: resolve. */
export function AlertActions({ alert, showResolve = false, size = 'sm' }: { alert: Alert; showResolve?: boolean; size?: 'sm' | 'md' }) {
  const t = useT()
  const setStatus = useData((s) => s.setStatus)
  const canResolve = useCan('resolve')
  const closed = alert.status === 'RESOLVED' || alert.status === 'FALSE_ALARM'
  const cls = size === 'sm' ? 'btn btn-sm' : 'btn'
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div className="flex flex-wrap gap-1">
      <button className={cls} disabled={alert.status !== 'NEW'} onClick={stop(() => void setStatus(alert.id, 'ACKNOWLEDGED'))}>
        <Check size={12} /> {t('act.ack')}
      </button>
      <button className={cls} disabled={closed || alert.status === 'ESCALATED'} onClick={stop(() => void setStatus(alert.id, 'ESCALATED'))}>
        <ArrowUpCircle size={12} /> {t('act.escalate')}
      </button>
      <button className={cls} disabled={closed} onClick={stop(() => void setStatus(alert.id, 'FALSE_ALARM'))}>
        <Ban size={12} /> {t('act.false')}
      </button>
      {showResolve && (
        <button
          className={`${cls} btn-primary`}
          disabled={closed || !canResolve}
          title={canResolve ? undefined : 'Only Commander / Admin can resolve alerts'}
          onClick={stop(() => void setStatus(alert.id, 'RESOLVED'))}
        >
          <CheckCheck size={12} /> {t('act.resolve')}
        </button>
      )}
    </div>
  )
}

export function AlertCard({ alert, now, compact = false }: { alert: Alert; now: number; compact?: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const camera = useData((s) => s.cameras.find((c) => c.id === alert.cameraId))
  const focused = useUi((s) => s.focusedAlertId === alert.id)
  const Icon = TYPE_ICON[alert.type]
  const sev = SEV[alert.severity]
  const detail = keyDetail(alert)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/alerts/${alert.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/alerts/${alert.id}`)}
      onMouseEnter={() => useUi.getState().set({ focusedAlertId: alert.id })}
      className={`flex overflow-hidden rounded border bg-base-850 text-left hover:bg-base-800 ${focused ? 'border-accent/70' : 'border-base-700'} ${alert.status === 'NEW' ? '' : 'opacity-75'}`}
    >
      <div className={`w-1 shrink-0 ${sev.bg}`} />
      <div className="min-w-0 flex-1 p-2">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={`shrink-0 ${sev.text}`} />
          <span className="truncate text-xs font-semibold">{t(`type.${alert.type}`)}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-mute">{relTime(alert.timestamp, now)}</span>
        </div>
        <div className="mt-1 flex gap-2">
          <img src={alert.snapshotUrl} alt="" className="h-10 w-[72px] shrink-0 rounded-sm border border-base-700 object-cover" />
          <div className="min-w-0 text-[11px]">
            <div className="truncate text-ink-dim">{camera?.name ?? alert.cameraId}</div>
            <div className="truncate font-mono text-ink">{detail || '-'}</div>
          </div>
        </div>
        {!compact && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {alert.status === 'NEW' ? <AlertActions alert={alert} /> : <StatusBadge status={alert.status} />}
          </div>
        )}
      </div>
    </div>
  )
}
