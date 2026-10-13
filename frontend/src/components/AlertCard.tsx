import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpCircle, Ban, Check, CheckCheck, Layers } from 'lucide-react'
import type { Alert, AlertStatus, Incident } from '@/types'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useCan } from '@/store/auth'
import { SEV, isLowVisibility, keyDetail, relTime, whyFired } from '@/lib/format'
import { useT } from '@/i18n'
import { StatusBadge, TYPE_ICON } from './ui'

/**
 * Workflow buttons. Operators: acknowledge / escalate / false alarm. Commander+: resolve.
 * With `incident`, the action applies to every eligible alert in that incident.
 */
export function AlertActions({ alert, incident, showResolve = false, size = 'sm' }: { alert: Alert; incident?: Incident; showResolve?: boolean; size?: 'sm' | 'md' }) {
  const t = useT()
  const setStatus = useData((s) => s.setStatus)
  const setMany = useData((s) => s.setStatusMany)
  const canResolve = useCan('resolve')
  const status = incident?.status ?? alert.status
  const closed = status === 'RESOLVED' || status === 'FALSE_ALARM'
  const cls = size === 'sm' ? 'btn btn-sm' : 'btn'
  const apply = (next: AlertStatus) => (e: MouseEvent) => {
    e.stopPropagation()
    void (incident ? setMany(incident.alerts.map((a) => a.id), next) : setStatus(alert.id, next))
  }
  return (
    <div className="flex flex-wrap gap-1">
      <button className={cls} disabled={status !== 'NEW'} onClick={apply('ACKNOWLEDGED')}>
        <Check size={12} /> {t('act.ack')}
      </button>
      <button className={cls} disabled={closed || status === 'ESCALATED'} onClick={apply('ESCALATED')}>
        <ArrowUpCircle size={12} /> {t('act.escalate')}
      </button>
      <button className={cls} disabled={closed} onClick={apply('FALSE_ALARM')}>
        <Ban size={12} /> {t('act.false')}
      </button>
      {showResolve && (
        <button
          className={`${cls} btn-primary`}
          disabled={closed || !canResolve}
          title={canResolve ? undefined : 'Only Commander / Admin can resolve alerts'}
          onClick={apply('RESOLVED')}
        >
          <CheckCheck size={12} /> {t('act.resolve')}
        </button>
      )}
    </div>
  )
}

/** One alert, or (with `incident`) a whole incident shown once with an "xN" counter. */
export function AlertCard({ alert, incident, now, compact = false }: { alert: Alert; incident?: Incident; now: number; compact?: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const camera = useData((s) => s.cameras.find((c) => c.id === alert.cameraId))
  const focused = useUi((s) => s.focusedAlertId === alert.id)
  const type = incident?.type ?? alert.type
  const severity = incident?.severity ?? alert.severity
  const status = incident?.status ?? alert.status
  const count = incident?.alerts.length ?? 1
  const Icon = TYPE_ICON[type]
  const sev = SEV[severity]
  const detail = keyDetail(alert)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/alerts/${alert.id}`)}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/alerts/${alert.id}`)}
      onMouseEnter={() => useUi.getState().set({ focusedAlertId: alert.id })}
      className={`flex overflow-hidden rounded border bg-base-850 text-left hover:bg-base-800 ${focused ? 'border-accent/70' : 'border-base-700'} ${status === 'NEW' ? '' : 'opacity-75'}`}
    >
      <div className={`w-1 shrink-0 ${sev.bg}`} />
      <div className="min-w-0 flex-1 p-2">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={`shrink-0 ${sev.text}`} />
          <span className="truncate text-xs font-semibold">{t(`type.${type}`)}</span>
          {count > 1 && (
            <span className="flex shrink-0 items-center gap-0.5 rounded bg-base-600 px-1 font-mono text-[10px] font-bold text-ink" title={`${count} alerts grouped into one incident`}>
              <Layers size={9} /> x{count}
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-mute">{relTime(alert.timestamp, now)}</span>
        </div>
        <div className="mt-1 flex gap-2">
          <img src={alert.snapshotUrl} alt="" className="h-11 w-[72px] shrink-0 rounded-sm border border-base-700 object-cover" />
          <div className="min-w-0 text-[11px]">
            <div className="truncate text-ink-dim">{camera?.name ?? alert.cameraId}</div>
            <div className="truncate font-mono text-ink">{detail || '-'}</div>
            <div className="truncate text-[10px] text-ink-mute" title="Why this alert fired">
              {isLowVisibility(alert.visibility) && <span className="mr-1 rounded bg-med/20 px-1 font-semibold text-med">LOW VISIBILITY</span>}
              {whyFired(alert).join(' · ')}
            </div>
          </div>
        </div>
        {!compact && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {status === 'NEW' ? <AlertActions alert={alert} incident={incident} /> : <StatusBadge status={status} />}
          </div>
        )}
      </div>
    </div>
  )
}
