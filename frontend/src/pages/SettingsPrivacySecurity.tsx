import { useEffect, useState } from 'react'
import { Lock, LockOpen, Save, ShieldCheck } from 'lucide-react'
import type { AppSettings, RetentionDays, User } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { audit } from '@/lib/audit'
import { fmtDateTime, relTime } from '@/lib/format'
import { Chip, ErrorState, Field, InlineWarning, SkeletonRows } from '@/components/ui'

const RETENTION: RetentionDays[] = [7, 30, 90]
const TIMEOUTS = [1, 5, 15, 30, 60]

/** Local editable copy of the global settings with a save helper. */
function useSettingsDraft() {
  const stored = useData((s) => s.settings)
  const [draft, setDraft] = useState<AppSettings | null>(stored)
  const [saved, setSaved] = useState(false)
  useEffect(() => setDraft(stored), [stored])
  const save = async (what: string, details: string) => {
    if (!draft) return
    await service.saveSettings(draft)
    await useData.getState().refreshSettings()
    audit('SETTINGS', 'Settings changed', what, details)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return { draft, setDraft, save, saved, dirty: JSON.stringify(draft) !== JSON.stringify(stored) }
}

export function PrivacyTab({ canManage }: { canManage: boolean }) {
  const { draft, setDraft, save, saved, dirty } = useSettingsDraft()
  if (!draft) return <div className="panel"><SkeletonRows rows={4} /></div>
  const r = draft.retention
  const setRetention = (key: keyof AppSettings['retention'], v: string) => setDraft({ ...draft, retention: { ...r, [key]: Number(v) as RetentionDays } })
  const rows: { key: keyof AppSettings['retention']; label: string; hint: string }[] = [
    { key: 'clipsDays', label: 'Video clips', hint: 'Alert clips recorded by the AI engine' },
    { key: 'snapshotsDays', label: 'Snapshots', hint: 'Alert snapshots and plate crops' },
    { key: 'faceDataDays', label: 'Face data', hint: 'Captured face crops and embeddings of non-watchlist people' },
  ]
  return (
    <fieldset disabled={!canManage} className="grid max-w-4xl grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <div className="panel-title">Retention period</div>
        {rows.map((row) => (
          <Field key={row.key} label={row.label}>
            <select className="field" value={r[row.key]} onChange={(e) => setRetention(row.key, e.target.value)}>
              {RETENTION.map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
            <span className="text-[10px] normal-case">{row.hint}. Deleted automatically after this period.</span>
          </Field>
        ))}
      </div>
      <div className="space-y-3">
        <div className="panel space-y-2 p-3">
          <div className="panel-title">Exports</div>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5" checked={draft.blurFacesInExports} onChange={(e) => setDraft({ ...draft, blurFacesInExports: e.target.checked })} />
            <span>
              Blur faces of non-watchlist people in exports
              <span className="block text-[11px] text-ink-mute">Applies to evidence packages and report snapshots produced by the backend.</span>
            </span>
          </label>
          {service.mode === 'mock' && <div className="text-[10px] text-ink-mute">Mock mode stores this preference and records it in the chain-of-custody file, but cannot blur images itself.</div>}
        </div>
        <div className="rounded border border-accent/40 bg-accent/10 p-3 text-xs text-ink-dim">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-accent">
            <ShieldCheck size={14} /> Digital Personal Data Protection Act, 2023
          </div>
          Face images, number plates and video of identifiable people are personal data. IBVAP supports the Act's
          principles of purpose limitation, data minimisation and storage limitation through fixed retention periods,
          role-based access, face blurring in exports and a full audit log. Legal applicability and exemptions for
          security agencies must be confirmed by the deploying organisation.
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-primary"
            disabled={!dirty}
            onClick={() => void save('Data & Privacy', `retention clips ${r.clipsDays}d, snapshots ${r.snapshotsDays}d, face data ${r.faceDataDays}d; blur faces ${draft.blurFacesInExports ? 'on' : 'off'}`)}
          >
            <Save size={13} /> Save
          </button>
          {saved && <span className="text-xs text-low">Saved</span>}
        </div>
      </div>
    </fieldset>
  )
}

const isEncrypted = (url: string) => /^(rtsps|https|srt):/i.test(url.trim())

export function SecurityTab({ canManage }: { canManage: boolean }) {
  const cameras = useData((s) => s.cameras)
  const { draft, setDraft, save, saved, dirty } = useSettingsDraft()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')
  const loadUsers = () => {
    setError('')
    service.getUsers().then(setUsers, (e: Error) => setError(e.message))
  }
  useEffect(loadUsers, [])
  const plain = cameras.filter((c) => !isEncrypted(c.streamUrl)).length
  const dashboardSecure = location.protocol === 'https:' || location.hostname === 'localhost'

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 space-y-3 lg:col-span-5">
        <fieldset disabled={!canManage} className="panel space-y-3 p-3">
          <div className="panel-title">Session</div>
          {draft ? (
            <>
              <Field label="Auto-logout after inactivity">
                <select className="field" value={draft.sessionTimeoutMin} onChange={(e) => setDraft({ ...draft, sessionTimeoutMin: Number(e.target.value) })}>
                  {TIMEOUTS.map((m) => (
                    <option key={m} value={m}>{m} minute{m > 1 ? 's' : ''}</option>
                  ))}
                </select>
                <span className="text-[10px] normal-case">With no mouse or keyboard activity for this long, the operator is signed out. Applies to every workstation.</span>
              </Field>
              <div className="flex items-center gap-2">
                <button className="btn btn-primary" disabled={!dirty} onClick={() => void save('Security', `session timeout ${draft.sessionTimeoutMin} min`)}>
                  <Save size={13} /> Save
                </button>
                {saved && <span className="text-xs text-low">Saved</span>}
              </div>
            </>
          ) : (
            <SkeletonRows rows={2} />
          )}
        </fieldset>
        <div className="panel overflow-x-auto">
          <div className="panel-title px-3 pt-3">Last login per user</div>
          {error ? (
            <ErrorState message={error} onRetry={loadUsers} />
          ) : !users ? (
            <SkeletonRows rows={4} />
          ) : (
            <table className="mt-2 w-full text-xs">
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-base-800">
                    <td className="px-3 py-1.5 font-medium">{u.name}</td>
                    <td className="px-2 font-mono text-[10px] text-ink-mute">{u.role}</td>
                    <td className="px-2 text-right font-mono text-ink-dim">{u.lastLogin ? `${fmtDateTime(u.lastLogin)} (${relTime(u.lastLogin)})` : 'never'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="panel col-span-12 overflow-x-auto lg:col-span-7">
        <div className="flex items-center justify-between px-3 pt-3">
          <span className="panel-title">Stream encryption status</span>
          <Chip className={dashboardSecure ? 'border-low/50 bg-low/15 text-low' : 'border-med/50 bg-med/15 text-med'}>
            Dashboard link: {location.protocol === 'https:' ? 'HTTPS' : location.hostname === 'localhost' ? 'localhost' : 'HTTP (not encrypted)'}
          </Chip>
        </div>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
              <th className="px-3 py-2">Camera</th>
              <th className="px-2">Protocol</th>
              <th className="px-2">Camera to edge node</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => {
              const enc = isEncrypted(c.streamUrl)
              return (
                <tr key={c.id} className="border-b border-base-800">
                  <td className="px-3 py-1.5 font-medium">{c.name}</td>
                  <td className="px-2 font-mono text-ink-dim uppercase">{c.streamUrl.split(':')[0]}</td>
                  <td className="px-2">
                    {enc ? (
                      <span className="flex items-center gap-1 text-low"><Lock size={12} /> Encrypted (TLS)</span>
                    ) : (
                      <span className="flex items-center gap-1 text-med"><LockOpen size={12} /> Not encrypted (plain stream on outpost LAN)</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {plain > 0 && (
          <div className="p-3">
            <InlineWarning>
              {plain} camera stream(s) use plain RTSP / HTTP. Most existing CCTV cameras only support this, so keep them on an isolated outpost LAN or VLAN; the edge node should forward to the command centre over a VPN or TLS.
            </InlineWarning>
          </div>
        )}
        <div className="px-3 pb-3 text-[10px] text-ink-mute">Status is derived from each camera's stream URL scheme. It is a display, not a network scan.</div>
      </div>
    </div>
  )
}
