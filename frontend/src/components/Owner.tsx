import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import type { Alert, User } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'

let usersCache: User[] | null = null

/** Incident / alert owner: "Assign to me" or pick a user. Writes history kind "assign" + audit. */
export function OwnerControl({ alerts, label }: { alerts: Alert[]; label: string }) {
  const t = useT()
  const me = useAuth((s) => s.user)
  const [users, setUsers] = useState<User[]>(usersCache ?? [])
  const [err, setErr] = useState('')
  useEffect(() => {
    if (usersCache) return
    service.getUsers().then((u) => setUsers((usersCache = u.filter((x) => x.active))), () => {})
  }, [])
  const owner = alerts[0]?.assignedTo ?? null
  const assign = async (name: string) => {
    if (!name || name === owner) return
    setErr('')
    try {
      const out = await service.assignAlerts(alerts.map((a) => a.id), name, me?.name ?? 'Operator')
      out.forEach((a) => useData.getState().ingest(a))
      audit('ALERT', 'Owner assigned', label, name)
    } catch {
      setErr(t('owner.failed'))
    }
  }
  const names = [...new Set([...(me ? [me.name] : []), ...users.map((u) => u.name)])]
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <UserCheck size={13} className="text-accent" />
      <span className="text-ink-mute">{t('owner.label')}:</span>
      <span className="font-semibold">{owner ?? t('owner.none')}</span>
      {me && owner !== me.name && (
        <button className="btn btn-sm" onClick={() => void assign(me.name)}>
          {t('owner.me')}
        </button>
      )}
      <select className="field py-0.5 text-[11px]" value="" onChange={(e) => void assign(e.target.value)} aria-label={t('owner.assign')}>
        <option value="">{t('owner.assign')}…</option>
        {names.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      {err && <span className="text-crit">{err}</span>}
    </div>
  )
}
