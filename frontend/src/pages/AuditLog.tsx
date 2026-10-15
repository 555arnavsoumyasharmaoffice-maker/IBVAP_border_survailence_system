import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Lock, RefreshCw, ScrollText, Search } from 'lucide-react'
import type { AuditCategory, AuditEntry } from '@/types'
import { service } from '@/services'
import { useCan } from '@/store/auth'
import { audit } from '@/lib/audit'
import { downloadFile, fmtDate, fmtDateTime, toCsv } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { Chip, EmptyState, ErrorState, Field, PageHeader, SkeletonRows } from '@/components/ui'

const CATEGORY: Record<AuditCategory, { label: string; style: string }> = {
  AUTH: { label: 'Sign-in', style: 'border-base-600 bg-base-800 text-ink-dim' },
  CAMERA_VIEW: { label: 'Camera view', style: 'border-accent/50 bg-accent/15 text-accent' },
  ZONE: { label: 'Zone', style: 'border-high/50 bg-high/15 text-high' },
  WATCHLIST: { label: 'Watchlist', style: 'border-crit/50 bg-crit/15 text-crit' },
  BLACKLIST: { label: 'Blacklist', style: 'border-crit/50 bg-crit/15 text-crit' },
  ANPR: { label: 'ANPR', style: 'border-med/50 bg-med/15 text-med' },
  EXPORT: { label: 'Data export', style: 'border-low/50 bg-low/15 text-low' },
  EVIDENCE: { label: 'Evidence', style: 'border-low/50 bg-low/15 text-low' },
  SETTINGS: { label: 'Settings', style: 'border-high/50 bg-high/15 text-high' },
  ALERT: { label: 'Alert', style: 'border-crit/50 bg-crit/15 text-crit' },
  DRONE: { label: 'Drone watch', style: 'border-accent/50 bg-accent/15 text-accent' },
}

export default function AuditLog() {
  const t = useT()
  const allowed = useCan('manage')
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  const [category, setCategory] = useState<AuditCategory | ''>('')
  const [user, setUser] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(() => {
    setError('')
    service.getAuditLog().then(setEntries, (e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  const users = useMemo(() => [...new Set((entries ?? []).map((e) => e.user))].sort(), [entries])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : ''
    const toIso = to ? new Date(`${to}T23:59:59`).toISOString() : ''
    return (entries ?? []).filter(
      (e) =>
        (!category || e.category === category) && (!user || e.user === user) && (!fromIso || e.at >= fromIso) && (!toIso || e.at <= toIso) &&
        (!q || `${e.action} ${e.target} ${e.details} ${e.user}`.toLowerCase().includes(q)),
    )
  }, [entries, category, user, search, from, to])

  if (!allowed) {
    return (
      <Page>
        <div className="panel">
          <EmptyState title="Restricted" hint="The audit log is visible to Commander and Admin only." icon={Lock} />
        </div>
      </Page>
    )
  }

  const exportCsv = () => {
    downloadFile(`ibvap_audit_${fmtDate(Date.now())}.csv`, toCsv(filtered.map((e) => ({ time: fmtDateTime(e.at), user: e.user, role: e.role, category: e.category, action: e.action, target: e.target, details: e.details }))))
    audit('EXPORT', 'CSV export', 'Audit log', `${filtered.length} rows`)
    setTimeout(load, 300)
  }

  return (
    <Page>
      <PageHeader title={t('nav.audit')} subtitle="Who viewed cameras, changed zones, watchlists or settings, and exported data or evidence">
        <button className="btn" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>
        <button className="btn" onClick={exportCsv} disabled={!filtered.length}>
          <Download size={13} /> Export CSV
        </button>
      </PageHeader>

      <div className="panel mb-2 flex flex-wrap items-end gap-2 p-2">
        <Field label="Search">
          <div className="relative">
            <Search size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-ink-mute" />
            <input className="field w-52 pl-7" placeholder="Action, target, details" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Field>
        <Field label="Category">
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | '')}>
            <option value="">All categories</option>
            {(Object.keys(CATEGORY) as AuditCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY[c].label}</option>
            ))}
          </select>
        </Field>
        <Field label="User">
          <select className="field" value={user} onChange={(e) => setUser(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input type="date" className="field" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className="field" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <span className="ml-auto font-mono text-[11px] text-ink-mute">
          {filtered.length} of {entries?.length ?? 0} entries
        </span>
      </div>

      <div className="panel overflow-x-auto">
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !entries ? (
          <SkeletonRows rows={10} />
        ) : !filtered.length ? (
          <EmptyState title="No audit entries match" hint="Clear a filter or widen the date range." icon={ScrollText} />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="px-2 py-2">Time</th>
                <th className="px-2">User</th>
                <th className="px-2">Role</th>
                <th className="px-2">Category</th>
                <th className="px-2">Action</th>
                <th className="px-2">Target</th>
                <th className="px-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((e) => (
                <tr key={e.id} className="border-b border-base-800">
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap text-ink-dim">{fmtDateTime(e.at)}</td>
                  <td className="px-2 font-medium whitespace-nowrap">{e.user}</td>
                  <td className="px-2 font-mono text-[10px] text-ink-mute">{e.role}</td>
                  <td className="px-2"><Chip className={CATEGORY[e.category].style}>{CATEGORY[e.category].label}</Chip></td>
                  <td className="px-2 whitespace-nowrap">{e.action}</td>
                  <td className="max-w-52 truncate px-2 font-mono">{e.target}</td>
                  <td className="max-w-80 truncate px-2 text-ink-dim" title={e.details}>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Page>
  )
}
