import { useEffect, useState, type ReactNode } from 'react'
import {
  Car, Fence, Inbox, Moon, ScanFace, ScanLine, Timer, TriangleAlert, User, VideoOff, X, Activity, WifiOff,
  type LucideIcon,
} from 'lucide-react'
import type { AlertStatus, AlertType, Severity, Visibility } from '@/types'
import { SEV, STATUS_STYLE, VISIBILITY, fmtPlate } from '@/lib/format'
import { useT } from '@/i18n'

/** Re-renders the caller every `ms` and returns the current time. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

export const TYPE_ICON: Record<AlertType, LucideIcon> = {
  FENCE_INTRUSION: Fence,
  HUMAN_DETECTED: User,
  VEHICLE_DETECTED: Car,
  ANPR_MATCH: ScanLine,
  FACE_MATCH: ScanFace,
  LOITERING: Timer,
  NIGHT_MOVEMENT: Moon,
  SUSPICIOUS_ACTIVITY: Activity,
  CAMERA_OFFLINE: VideoOff,
}

const chip = 'inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap'

export function SeverityBadge({ severity }: { severity: Severity }) {
  const t = useT()
  return <span className={`${chip} ${SEV[severity].soft}`}>{t(`sev.${severity}`)}</span>
}

export function StatusBadge({ status }: { status: AlertStatus }) {
  const t = useT()
  return <span className={`${chip} ${STATUS_STYLE[status]}`}>{t(`status.${status}`)}</span>
}

/** Per-camera visibility condition (Clear / Low light / Fog / Dust). */
export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return (
    <span className={`${chip} ${VISIBILITY[visibility].style}`} title="Visibility condition estimated at this camera">
      {VISIBILITY[visibility].label}
    </span>
  )
}

export function Chip({ children, className = 'bg-base-800 text-ink-dim border-base-600' }: { children: ReactNode; className?: string }) {
  return <span className={`${chip} ${className}`}>{children}</span>
}

/** Styled like an Indian high-security registration plate. */
export function PlateTag({ plate, size = 'md', flagged }: { plate: string; size?: 'sm' | 'md' | 'lg'; flagged?: boolean }) {
  const sz = size === 'lg' ? 'text-xl h-9' : size === 'sm' ? 'text-[11px] h-5' : 'text-[13px] h-6'
  return (
    <span className={`inline-flex items-stretch overflow-hidden rounded-[3px] border-2 font-mono font-bold ${sz} ${flagged ? 'border-crit' : 'border-black'} bg-slate-50 text-black`}>
      <span className="flex w-3 items-end justify-center bg-blue-700 pb-px text-[5px] leading-none text-white">IND</span>
      <span className="flex items-center px-1.5 tracking-wider whitespace-nowrap">{fmtPlate(plate)}</span>
    </span>
  )
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  )
}

export function EmptyState({ title, hint, icon: Icon = Inbox }: { title: string; hint?: string; icon?: LucideIcon }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-1 p-6 text-center text-ink-mute">
      <Icon size={26} strokeWidth={1.5} />
      <div className="text-sm text-ink-dim">{title}</div>
      {hint && <div className="max-w-sm text-xs">{hint}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 p-6 text-center">
      <WifiOff size={26} className="text-high" strokeWidth={1.5} />
      <div className="text-sm text-ink">Backend not reachable</div>
      <div className="max-w-md text-xs text-ink-mute">{message}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function InlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded border border-med/40 bg-med/10 px-3 py-2 text-xs text-med">
      <TriangleAlert size={14} className="mt-px shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-lg leading-tight font-semibold">{title}</h1>
        {subtitle && <p className="text-xs text-ink-mute">{subtitle}</p>}
      </div>
      <div className="no-print flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="no-print mb-3 flex gap-1 border-b border-base-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium ${value === tab.id ? 'border-accent text-ink' : 'border-transparent text-ink-mute hover:text-ink-dim'}`}
        >
          {tab.label}
          {tab.count !== undefined && <span className="ml-1.5 rounded bg-base-700 px-1 font-mono text-[10px]">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[2200] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div className={`panel flex max-h-full w-full flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-base-700 px-4 py-2.5">
          <div className="text-sm font-semibold">{title}</div>
          <button onClick={onClose} className="text-ink-mute hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[11px] text-ink-mute ${className}`}>
      <span className="font-medium tracking-wide uppercase">{label}</span>
      {children}
    </label>
  )
}

export function Stat({ label, value, tone = 'text-ink' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="panel px-3 py-2">
      <div className="panel-title">{label}</div>
      <div className={`font-mono text-2xl leading-tight font-semibold ${tone}`}>{value}</div>
    </div>
  )
}
