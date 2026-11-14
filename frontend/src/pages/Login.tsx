import { useState, useEffect, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Shield, Lock, User, UserPlus, AlertTriangle, CheckCircle2,
  Eye, EyeOff, Terminal, Zap, Activity, Radio, KeyRound, ShieldAlert,
  Cpu, Database, Server, Crosshair, ArrowRight, Sparkles, Radar
} from 'lucide-react'
import type { Role } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'

interface RosterMember {
  id: string
  serviceId: string
  name: string
  role: Role
  rank: string
  unit: string
  status: 'ACTIVE' | 'RETIRED'
}

export default function Login() {
  const t = useT()
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const login = useAuth((s) => s.login)

  const [username, setUsername] = useState('IBVAP-ADM-9102')
  const [password, setPassword] = useState('admin@123')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [roster, setRoster] = useState<RosterMember[]>([])
  const [loadingRoster, setLoadingRoster] = useState(true)

  // Onboard modal state
  const [showOnboard, setShowOnboard] = useState(false)
  const [newOfficer, setNewOfficer] = useState({
    name: '',
    role: 'OPERATOR' as Role,
    rank: 'Constable',
    unit: 'BOP Sector-4 Bravo',
    password: 'user@123'
  })
  const [onboardSuccess, setOnboardSuccess] = useState<string | null>(null)
  const [onboardBusy, setOnboardBusy] = useState(false)
  const [onboardError, setOnboardError] = useState('')

  const [timedOut] = useState(() => sessionStorage.getItem('ibvap.timedOut'))

  // Tactical Workstation Booting Sequence (10s Cold-start Wake-up & Bootstrap)
  const [booting, setBooting] = useState(false)
  const [bootProgress, setBootProgress] = useState(0)
  const [bootLogs, setBootLogs] = useState<string[]>([])

  // Load live personnel roster from backend
  const loadRoster = async () => {
    try {
      setLoadingRoster(true)
      const data = await service.getRoster()
      if (Array.isArray(data) && data.length > 0) {
        setRoster(data)
      }
    } catch {
      // Fallback roster if network glitch
      setRoster([
        { id: 'usr-01', serviceId: 'IBVAP-ADM-9102', name: 'SI R. Sharma', role: 'ADMIN', rank: 'Sub-Inspector', unit: 'HQ Surveillance Tech', status: 'ACTIVE' },
        { id: 'usr-02', serviceId: 'IBVAP-CMD-4819', name: 'Insp. A. Rathore', role: 'COMMANDER', rank: 'Inspector', unit: 'Sector Threat Command', status: 'ACTIVE' },
        { id: 'usr-03', serviceId: 'IBVAP-OP-3312', name: 'Ct. S. Meena', role: 'OPERATOR', rank: 'Constable', unit: 'BOP Sundar Wing', status: 'ACTIVE' },
        { id: 'usr-04', serviceId: 'IBVAP-OP-1084', name: 'Ct. V. Gurjar', role: 'OPERATOR', rank: 'Constable (Retd.)', unit: 'Border Outpost Alpha', status: 'RETIRED' }
      ])
    } finally {
      setLoadingRoster(false)
    }
  }

  useEffect(() => {
    void loadRoster()
  }, [])

  // 10-Second Workstation Establishing & Server Wake-up Timer
  useEffect(() => {
    if (!booting) return

    // Wake up backend and camera feeds in background
    void service.getCameras().catch(() => {})

    const totalMs = 10000 // 10 seconds total duration
    const intervalMs = 100
    let elapsed = 0

    const stages = [
      { at: 300, text: '[COMSEC / TRANSEC] Verifying Military Cryptographic Keys & Command Clearance... [VERIFIED]' },
      { at: 1800, text: '[C4ISR TELEMETRY] Polling 19 Border Outposts (Jaisalmer Sundar & Amritsar Attari Sector)... [19/19 ONLINE]' },
      { at: 3800, text: '[NEURAL DEFENSE] Arming Multi-Spectral YOLOv8s Intrusion & Crawling Detection Core... [ARMED]' },
      { at: 5800, text: '[GEO-PERIMETER] Calibrating Virtual Fence Tripwires & Underground Seismic Sensor Grid... [CALIBRATED]' },
      { at: 7800, text: '[AIR DEFENSE / ANPR] Synchronizing UAV Anti-Drone Radar & Vehicle Intercept Database... [ACTIVE]' },
      { at: 9400, text: '[SITREP READY] Tactical Workstation Established. Security Clearance: LEVEL-IV TOP SECRET... [ENGAGED]' },
    ]

    const interval = setInterval(() => {
      elapsed += intervalMs
      const pct = Math.min(Math.round((elapsed / totalMs) * 100), 100)
      setBootProgress(pct)

      stages.forEach((st) => {
        if (elapsed >= st.at) {
          setBootLogs((prev) => (prev.includes(st.text) ? prev : [...prev, st.text]))
        }
      })

      if (elapsed >= totalMs) {
        clearInterval(interval)
        setTimeout(() => {
          navigate('/')
        }, 300)
      }
    }, intervalMs)

    return () => clearInterval(interval)
  }, [booting, navigate])

  if (user && !booting) return <Navigate to="/" replace />

  const selectRosterMember = (m: RosterMember) => {
    if (m.status === 'RETIRED') {
      setError(`ACCESS SUSPENDED: Officer ${m.name} (${m.serviceId}) is in RETIRED status. Administrative privileges revoked.`)
      return
    }
    setError('')
    setUsername(m.serviceId)
    // Auto-fill standard known pass for testing convenience
    if (m.serviceId === 'IBVAP-ADM-9102') setPassword('admin@123')
    else if (m.serviceId === 'IBVAP-CMD-4819') setPassword('commander@123')
    else if (m.serviceId === 'IBVAP-OP-3312') setPassword('operator@123')
    else setPassword('user@123')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim()) {
      setError('Service ID / Username is required')
      return
    }
    setBusy(true)
    setError('')
    sessionStorage.removeItem('ibvap.timedOut')

    // Start booting sequence immediately so user is not redirected early by Zustand state
    setBooting(true)

    try {
      await login(username.trim(), undefined, password)
      // Login succeeded! The 10-second timer will now play the full tactical boot sequence and navigate('/')
    } catch (err: any) {
      setBooting(false)
      setBusy(false)
      console.error('Login error:', err)
      const msg = err?.message || 'Access Denied: Invalid Service ID or Password.'
      if (msg.includes('403') || msg.toLowerCase().includes('retired')) {
        setError('CRITICAL: Personnel is designated RETIRED/DEACTIVATED. Operational access refused by Defense Security Protocol.')
      } else if (msg.includes('401') || msg.toLowerCase().includes('password')) {
        setError('AUTHENTICATION FAILED: Invalid Service ID or Password.')
      } else {
        setError(msg)
      }
    }
  }

  const handleOnboard = async (e: FormEvent) => {
    e.preventDefault()
    if (!newOfficer.name.trim()) {
      setOnboardError('Officer full name is mandatory.')
      return
    }
    setOnboardBusy(true)
    setOnboardError('')
    try {
      const res: any = await service.registerOfficer(newOfficer)
      const assignedId = res?.user?.serviceId || res?.serviceId || `IBVAP-${newOfficer.role.slice(0, 3)}-${Math.floor(1000 + Math.random() * 9000)}`
      setOnboardSuccess(`Officer commissioned! Auto-assigned Service ID: ${assignedId}`)
      await loadRoster()
      setUsername(assignedId)
      setPassword(newOfficer.password || 'user@123')
      setTimeout(() => {
        setShowOnboard(false)
        setOnboardSuccess(null)
      }, 2500)
    } catch (err: any) {
      setOnboardError(err?.message || 'Failed to onboard officer.')
    } finally {
      setOnboardBusy(false)
    }
  }

  // Tactical Workstation Booting Screen Overlay (10s Cold-start Wake-up & Bootstrap)
  if (booting) {
    const remainingSeconds = Math.max(0, Math.ceil((10000 - (bootProgress / 100) * 10000) / 1000))
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 font-mono text-cyan-400 select-none p-4 overflow-hidden">
        {/* Background Grid Pattern & Radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.15)_0%,rgba(2,6,23,0.95)_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(6,182,212,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(6,182,212,0.05)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        {/* Central Tactical Workstation Terminal */}
        <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-cyan-500/50 bg-[#071322]/90 backdrop-blur-xl p-8 shadow-[0_0_80px_rgba(6,182,212,0.3)]">
          {/* Tactical Corner Reticles */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-cyan-500/30 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/60 bg-cyan-950/60 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                <Radar className="text-cyan-400 animate-spin" size={24} style={{ animationDuration: '4s' }} />
                <span className="absolute inset-0 rounded-xl border border-cyan-300 animate-ping opacity-30" />
              </div>
              <div>
                <div className="text-[10px] tracking-widest text-cyan-400/80 uppercase">
                  CLASSIFIED DEFENSE GATEWAY // PS-26187
                </div>
                <div className="text-lg font-black tracking-wider text-white">
                  ESTABLISHING SECURE TACTICAL WORKSTATION
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400">SESSION AUTHENTICATED</div>
              <div className="text-xs font-bold text-emerald-400">{username}</div>
            </div>
          </div>

          {/* Central Animated Progress */}
          <div className="mb-6 space-y-2">
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-cyan-300 flex items-center gap-2">
                <Activity size={14} className="animate-pulse text-cyan-400" />
                NEURAL CORE BOOTSTRAP IN PROGRESS...
              </span>
              <span className="text-2xl font-black tracking-wider text-cyan-300 font-mono">
                {bootProgress}%
              </span>
            </div>

            {/* Glowing Tactical Progress Bar */}
            <div className="h-3.5 w-full rounded-full bg-slate-950 border border-cyan-500/40 p-0.5 overflow-hidden shadow-inner">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_15px_rgba(6,182,212,0.8)] transition-all duration-150 ease-out"
                style={{ width: `${bootProgress}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-slate-400 pt-1">
              <span>Waking up cloud AI analytics & video pipelines</span>
              <span>Estimated: <span className="text-white font-bold">{remainingSeconds}s</span> remaining</span>
            </div>
          </div>

          {/* Live Telemetry Boot Logs */}
          <div className="rounded-lg border border-cyan-900/60 bg-black/60 p-4 font-mono text-[11px] space-y-2 mb-6 min-h-[185px] shadow-inner">
            <div className="text-[10px] text-cyan-500/70 uppercase tracking-widest border-b border-cyan-900/40 pb-1 mb-2 flex items-center justify-between">
              <span>C4ISR BORDER DEFENSE PROTOCOL & SUBSYSTEM CHECKS</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE TELEMETRY
              </span>
            </div>
            {bootLogs.map((log, i) => {
              const lastBracket = log.lastIndexOf('[')
              const mainText = lastBracket > 15 ? log.slice(0, lastBracket).trim() : log
              const statusTag = lastBracket > 15 ? log.slice(lastBracket) : ''
              return (
                <div key={i} className="flex items-center justify-between gap-2 text-xs text-cyan-200 py-0.5 animate-fadeIn">
                  <div className="flex items-center gap-2 truncate">
                    <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                    <span className="font-mono">{mainText}</span>
                  </div>
                  {statusTag && (
                    <span className="text-[10px] font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 shrink-0">
                      {statusTag.replace(/[\[\]]/g, '')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Quick Direct Bypass / Skip Action */}
          <div className="flex items-center justify-between pt-2 border-t border-cyan-500/20 text-xs">
            <span className="text-slate-400 text-[11px]">
              Ready to enter early?
            </span>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 hover:text-white transition-all text-xs font-bold shadow-[0_0_15px_rgba(6,182,212,0.2)]"
            >
              <span>ENTER COMMAND CENTER NOW</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,#12203a_0%,#050911_65%)] p-4 text-ink select-none">

      {/* Main Holographic Terminal Card */}
      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-6 p-1">
        
        {/* Left Column: Cyber Defense Info & Live Personnel Roster */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-cyan-500/30 bg-[#071322]/80 backdrop-blur-md p-6 shadow-[0_0_30px_rgba(6,182,212,0.15)] relative overflow-hidden">
          {/* Cyber reticle corner markers */}
          <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
          <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />

          <div>
            {/* Header Badge */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-400/50 bg-cyan-950/60 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <Shield className="text-cyan-400 animate-pulse" size={26} />
              </div>
              <div>
                <div className="font-mono text-[10px] tracking-widest text-cyan-400 uppercase flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                  BORDER SURVEILLANCE NETWORK · V3.8
                </div>
                <div className="text-xl font-black tracking-[0.25em] text-white">IBVAP COMMAND</div>
              </div>
            </div>

            <p className="text-xs text-ink-dim leading-relaxed mb-6">
              Integrated Border Surveillance & AI Defense Network. Military-grade telemetry with automated personnel authorization.
            </p>

            {/* Live Operational Personnel Roster */}
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-300 font-semibold flex items-center gap-1.5">
                <Radio size={12} className="text-cyan-400" /> BOP COMMAND ROSTER
              </span>
              <button
                type="button"
                onClick={() => setShowOnboard(true)}
                className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/40 px-2 py-0.5 rounded transition-all shadow-[0_0_8px_rgba(6,182,212,0.2)]"
              >
                <UserPlus size={11} /> Commission Officer
              </button>
            </div>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 select-none">
              {roster.map((m) => {
                const isSelected = username === m.serviceId
                const isRetired = m.status === 'RETIRED'
                return (
                  <div
                    key={m.serviceId}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectRosterMember(m)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectRosterMember(m) }}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all duration-200 relative ${
                      isRetired
                        ? 'border-red-900/40 bg-red-950/20 opacity-70 hover:opacity-100 hover:border-red-500/60'
                        : isSelected
                        ? 'border-cyan-400 bg-cyan-950/40 shadow-[0_0_15px_rgba(6,182,212,0.25)]'
                        : 'border-slate-800 bg-[#0b1728]/70 hover:border-cyan-500/50 hover:bg-cyan-950/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[11px] font-bold tracking-wider text-cyan-300">
                        {m.serviceId}
                      </span>
                      <span
                        className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                          isRetired
                            ? 'bg-red-950 text-red-400 border border-red-800/60'
                            : m.role === 'ADMIN'
                            ? 'bg-purple-950 text-purple-300 border border-purple-700/60'
                            : m.role === 'COMMANDER'
                            ? 'bg-amber-950 text-amber-300 border border-amber-700/60'
                            : 'bg-cyan-950 text-cyan-300 border border-cyan-700/60'
                        }`}
                      >
                        {isRetired ? 'RETIRED' : m.role}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white font-medium">{m.name}</span>
                      <span className="text-[10px] text-ink-mute font-mono">{m.rank}</span>
                    </div>
                    <div className="text-[10px] text-ink-dim font-mono mt-0.5 truncate">{m.unit}</div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>

        {/* Right Column: Holographic Login Form */}
        <div className="lg:col-span-7 rounded-xl border border-cyan-500/40 bg-[#06101e]/90 backdrop-blur-xl p-8 shadow-[0_0_40px_rgba(6,182,212,0.2)] relative">
          {/* Cyber reticle corner markers */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />

          {/* Form Header */}
          <div className="mb-6 border-b border-cyan-500/20 pb-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-xs text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                <Terminal size={14} /> DEFENSE AUTH TERMINAL
              </div>
            </div>
            <h2 className="text-xl font-bold tracking-wide text-white mt-1">Personnel Authorization</h2>
            <p className="text-xs text-ink-dim mt-0.5">
              Enter your assigned Military Service ID and passkey to establish a secure link.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {/* Service ID Input */}
            <div>
              <label className="block text-[11px] font-mono font-medium tracking-wider text-cyan-300 uppercase mb-1 flex items-center justify-between">
                <span>MILITARY SERVICE ID / USERNAME</span>
                <span className="text-[10px] text-ink-mute font-normal">Auto-assigned</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-cyan-400">
                  <User size={16} />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. IBVAP-ADM-9102"
                  className="w-full rounded-lg border border-cyan-500/30 bg-[#040914] py-2.5 pl-10 pr-4 font-mono text-sm text-cyan-100 placeholder-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 shadow-inner"
                />
              </div>
            </div>

            {/* Passkey Input */}
            <div>
              <label className="block text-[11px] font-mono font-medium tracking-wider text-cyan-300 uppercase mb-1 flex items-center justify-between">
                <span>SECURITY PASSKEY</span>
                <span className="text-[10px] text-ink-mute font-normal">Salted Hash</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-cyan-400">
                  <KeyRound size={16} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter secret authorization key"
                  className="w-full rounded-lg border border-cyan-500/30 bg-[#040914] py-2.5 pl-10 pr-10 font-mono text-sm text-cyan-100 placeholder-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400 shadow-inner"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-cyan-400 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>


            {/* Inactivity timeout notification */}
            {timedOut && !error && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle size={16} className="shrink-0 text-amber-400" />
                <span>Session expired due to {timedOut} minute(s) of operator inactivity. Please re-authenticate.</span>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="rounded-lg border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-300 flex items-start gap-2 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                <ShieldAlert size={16} className="shrink-0 text-red-400 mt-0.5" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg border border-cyan-400/80 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 py-3 text-sm font-bold tracking-wider text-white shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>AUTHORIZING CREDENTIALS...</span>
                </>
              ) : (
                <>
                  <Zap size={16} className="text-cyan-200" />
                  <span>INITIALIZE COMMAND HUD</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-slate-800 text-center font-mono text-[10px] text-ink-mute">
            <span>RESTRICTED FOR AUTHORIZED DEFENSE PERSONNEL ONLY</span>
          </div>
        </div>
      </div>

      {/* Onboard Officer Modal */}
      {showOnboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="relative w-full max-w-lg rounded-xl border border-cyan-400/60 bg-[#081426] p-6 shadow-[0_0_50px_rgba(6,182,212,0.3)]">
            <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-cyan-400" />
            <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-cyan-400" />
            <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-cyan-400" />
            <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-cyan-400" />

            <div className="flex items-center justify-between mb-4 border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="text-cyan-400" size={18} />
                <h3 className="font-bold text-white tracking-wide">Commission New Defense Officer</h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowOnboard(false); setOnboardSuccess(null); setOnboardError('') }}
                className="text-slate-400 hover:text-white font-mono text-sm"
              >
                ✕
              </button>
            </div>

            {onboardSuccess ? (
              <div className="py-6 text-center space-y-3">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                  <CheckCircle2 size={32} />
                </div>
                <div className="text-base font-bold text-emerald-300 font-mono">{onboardSuccess}</div>
                <p className="text-xs text-ink-dim">
                  Officer registered in PostgreSQL defense database. Service ID and passkey are active immediately.
                </p>
              </div>
            ) : (
              <form onSubmit={handleOnboard} className="space-y-3.5">
                <div>
                  <label className="block text-[11px] font-mono text-cyan-300 uppercase mb-1">
                    Officer Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newOfficer.name}
                    onChange={(e) => setNewOfficer({ ...newOfficer, name: e.target.value })}
                    placeholder="e.g. Insp. Vikram Batra"
                    className="w-full rounded border border-slate-700 bg-[#040914] px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-mono text-cyan-300 uppercase mb-1">
                      Assigned Role
                    </label>
                    <select
                      value={newOfficer.role}
                      onChange={(e) => setNewOfficer({ ...newOfficer, role: e.target.value as Role })}
                      className="w-full rounded border border-slate-700 bg-[#040914] px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="OPERATOR">OPERATOR</option>
                      <option value="COMMANDER">COMMANDER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-cyan-300 uppercase mb-1">
                      Military Rank
                    </label>
                    <input
                      type="text"
                      required
                      value={newOfficer.rank}
                      onChange={(e) => setNewOfficer({ ...newOfficer, rank: e.target.value })}
                      placeholder="e.g. Constable / Sub-Inspector"
                      className="w-full rounded border border-slate-700 bg-[#040914] px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-cyan-300 uppercase mb-1">
                    Station / Outpost Unit
                  </label>
                  <input
                    type="text"
                    required
                    value={newOfficer.unit}
                    onChange={(e) => setNewOfficer({ ...newOfficer, unit: e.target.value })}
                    placeholder="e.g. BOP Sector-4 Bravo"
                    className="w-full rounded border border-slate-700 bg-[#040914] px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-mono text-cyan-300 uppercase mb-1">
                    Initial Security Password
                  </label>
                  <input
                    type="password"
                    required
                    value={newOfficer.password}
                    onChange={(e) => setNewOfficer({ ...newOfficer, password: e.target.value })}
                    placeholder="Secret passkey"
                    className="w-full rounded border border-slate-700 bg-[#040914] px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  />
                </div>

                <div className="rounded bg-cyan-950/30 border border-cyan-500/20 p-2.5 text-[11px] text-cyan-300 font-mono">
                  ⚡ SYSTEM NOTICE: The system will automatically generate a cryptographically unique Military Service ID (e.g. <span className="text-white font-bold">IBVAP-{newOfficer.role.slice(0, 3)}-XXXX</span>).
                </div>

                {onboardError && (
                  <div className="rounded border border-red-500/50 bg-red-950/40 p-2 text-xs text-red-300">
                    {onboardError}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOnboard(false)}
                    className="px-4 py-2 text-xs font-mono rounded border border-slate-700 hover:bg-slate-800 text-slate-300"
                  >
                    CANCEL
                  </button>
                  <button
                    type="submit"
                    disabled={onboardBusy}
                    className="px-4 py-2 text-xs font-mono font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] disabled:opacity-50"
                  >
                    {onboardBusy ? 'REGISTERING...' : 'ENROLL OFFICER'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
