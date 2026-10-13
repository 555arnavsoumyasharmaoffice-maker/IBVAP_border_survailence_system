import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Loader2, Shield } from 'lucide-react'
import type { Role } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'

const ROLES: { role: Role; name: string; desc: string }[] = [
  { role: 'OPERATOR', name: 'Ct. S. Meena', desc: 'Monitor feeds, acknowledge and escalate alerts' },
  { role: 'COMMANDER', name: 'Insp. A. Rathore', desc: 'Resolve alerts, manage zones and watchlists' },
  { role: 'ADMIN', name: 'SI R. Sharma', desc: 'Full access including cameras and settings' },
]

export default function Login() {
  const t = useT()
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const login = useAuth((s) => s.login)
  const [role, setRole] = useState<Role>('OPERATOR')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [timedOut] = useState(() => sessionStorage.getItem('ibvap.timedOut'))

  if (user) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    sessionStorage.removeItem('ibvap.timedOut')
    try {
      await login(name.trim() || ROLES.find((r) => r.role === role)!.name, role)
      navigate('/')
    } catch {
      setError('Backend not reachable. Check VITE_API_URL or run in mock mode.')
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,#12203a_0%,#050911_65%)] p-4">
      <form onSubmit={submit} className="panel w-full max-w-md p-7 shadow-2xl shadow-black">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl border border-accent/50 bg-accent/10">
            <Shield size={30} className="text-accent" />
          </div>
          <div className="text-2xl font-bold tracking-[0.3em]">IBVAP</div>
          <div className="mt-1 text-xs text-ink-dim">{t('app.tagline')}</div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-mute">COMMAND CENTER · RESTRICTED ACCESS</div>
        </div>

        <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-mute uppercase">Sign in as</div>
        <div className="mb-4 space-y-1.5">
          {ROLES.map((r) => (
            <button
              type="button"
              key={r.role}
              onClick={() => setRole(r.role)}
              className={`flex w-full items-center gap-3 rounded border px-3 py-2 text-left ${role === r.role ? 'border-accent bg-accent/10' : 'border-base-700 hover:bg-base-800'}`}
            >
              <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${role === r.role ? 'border-accent bg-accent' : 'border-base-600'}`} />
              <span>
                <span className="block text-xs font-semibold tracking-wide">{r.role}</span>
                <span className="block text-[11px] text-ink-mute">{r.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <label className="mb-4 block text-[11px] font-medium tracking-wide text-ink-mute uppercase">
          Name (optional)
          <input className="field mt-1 w-full normal-case" value={name} onChange={(e) => setName(e.target.value)} placeholder={ROLES.find((r) => r.role === role)!.name} />
        </label>

        {timedOut && !error && (
          <div className="mb-3 rounded border border-med/50 bg-med/10 px-3 py-2 text-xs text-med">You were signed out after {timedOut} minute(s) of inactivity.</div>
        )}
        {error && <div className="mb-3 rounded border border-crit/50 bg-crit/10 px-3 py-2 text-xs text-crit">{error}</div>}

        <button type="submit" disabled={busy} className="btn btn-primary w-full py-2 text-sm">
          {busy && <Loader2 size={14} className="animate-spin" />} Enter Command Center
        </button>
        <div className="mt-4 text-center font-mono text-[10px] text-ink-mute">
          {service.mode === 'mock' ? 'Mock authentication: no password needed (demo build)' : 'Connected to live backend'}
        </div>
      </form>
    </div>
  )
}
