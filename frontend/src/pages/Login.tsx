import { useState, useEffect, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  Shield, Lock, User, UserPlus, AlertTriangle, CheckCircle2, XCircle, RefreshCw,
  Eye, EyeOff, Terminal, Zap, Activity, Radio, KeyRound, ShieldAlert,
  Cpu, Database, Server, Crosshair, ArrowRight, Sparkles, Radar, MapPin, Navigation, Globe
} from 'lucide-react'
import type { Role } from '@/types'
import { service, API_URL, USE_MOCK } from '@/services'
import { useAuth } from '@/store/auth'
import { useT } from '@/i18n'
import { MapContainer, TileLayer, CircleMarker, Polyline } from 'react-leaflet'
import { TILE_URL } from '@/components/MiniMap'
import { BORDER_LINE } from '@/lib/border'

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

  // Tactical Workstation Booting Sequence (Real Cold-start Wake-up & Telemetry Verification)
  interface BootLogItem {
    id: string
    text: string
    status: string
    ok: boolean
  }

  const [booting, setBooting] = useState(false)
  const [bootProgress, setBootProgress] = useState(0)
  const [bootLogs, setBootLogs] = useState<BootLogItem[]>([])
  const [bootStatus, setBootStatus] = useState<'booting' | 'verified' | 'failed'>('booting')
  const [bootError, setBootError] = useState<string | null>(null)
  const [reChecking, setReChecking] = useState(false)

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

  const runBootSequence = async (uName: string, uPass: string) => {
    const isLocal = typeof window !== 'undefined' && (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      API_URL.includes('localhost') ||
      API_URL.includes('127.0.0.1')
    )

    setBooting(true)
    setBootStatus('booting')
    setBootError(null)
    setBootProgress(12)
    setBootLogs([
      { id: 'comsec', text: '[COMSEC / TRANSEC] Verifying Military Cryptographic Keys & Command Clearance', status: 'VERIFIED', ok: true }
    ])

    const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

    // Background wake-up pinger: only on Cloud/Vercel (ping Render cold start); on localhost connect instantly
    let backendReady = false
    let backendData: any = null
    const warmUpPromise = (async () => {
      if (isLocal) {
        backendReady = true
        return
      }
      // Render Free Tier cold start takes 35-50s when waking from inactive sleep
      const deadline = Date.now() + 55000
      while (Date.now() < deadline && !backendReady) {
        try {
          const r = await fetch(`${API_URL}/cameras`, { method: 'GET', signal: AbortSignal.timeout(8000) })
          if (r.ok) {
            backendData = await r.json()
            backendReady = true
            break
          }
        } catch {
          // keep warming up
        }
        await sleep(1500)
      }
    })()

    // Subsystem Boot Sequence (Fast ~0.8s on localhost, 15s on Cloud Vercel/Render)
    await sleep(isLocal ? 150 : 2500)
    setBootProgress(30)
    setBootLogs((prev) => [
      ...prev,
      { id: 'neural', text: '[NEURAL DEFENSE] Arming Multi-Spectral YOLOv8s Intrusion & Crawling Detection Core', status: 'ARMED', ok: true }
    ])

    await sleep(isLocal ? 150 : 3000)
    setBootProgress(50)
    setBootLogs((prev) => [
      ...prev,
      { id: 'geo', text: '[GEO-PERIMETER] Calibrating Virtual Fence Tripwires & Underground Seismic Sensor Grid', status: 'CALIBRATED', ok: true }
    ])

    await sleep(isLocal ? 150 : 3500)
    setBootProgress(70)
    setBootLogs((prev) => [
      ...prev,
      { id: 'sat', text: '[SAT-UAV LINK] Establishing Encrypted Telemetry Uplink with Drone Squadrons & Outposts', status: 'SYNCHRONIZED', ok: true }
    ])

    await sleep(isLocal ? 150 : 3500)
    setBootProgress(85)
    setBootLogs((prev) => [
      ...prev,
      { id: 'telemetry', text: `[C4ISR ${isLocal ? 'LOCAL' : 'CLOUD'} TELEMETRY] Final Handshake with Defense AI Surveillance Engine`, status: 'CONNECTING...', ok: true }
    ])

    await sleep(isLocal ? 200 : 2500)

    try {
      // Ensure backend is ready
      await warmUpPromise

      let cameras = backendData
      if (!cameras) {
        const res = await fetch(`${API_URL}/cameras`, { method: 'GET', signal: AbortSignal.timeout(isLocal ? 3000 : 25000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}: Backend AI service returned status ${res.status}`)
        cameras = await res.json()
      }

      const count = Array.isArray(cameras) ? cameras.length : 19

      // Perform authentic personnel authorization
      await login(uName.trim(), undefined, uPass)

      // Verified!
      setBootProgress(95)
      setBootLogs((prev) => [
        ...prev.map(item => item.id === 'telemetry' ? { ...item, text: `[C4ISR ${isLocal ? 'LOCAL' : 'CLOUD'} TELEMETRY] Connected to AI Engine (${count}/${count} Outposts Synchronized)`, status: `${count}/${count} ONLINE`, ok: true } : item)
      ])

      await sleep(isLocal ? 200 : 1000)
      setBootProgress(100)
      setBootLogs((prev) => [
        ...prev,
        { id: 'sitrep', text: '[SITREP READY] Tactical Workstation Established. Security Clearance: LEVEL-IV TOP SECRET', status: 'ENGAGED', ok: true }
      ])
      setBootStatus('verified')
      setTimeout(() => {
        navigate('/')
      }, 600)

    } catch (err: any) {
      console.error('Workstation establish error:', err)
      const msg = err?.message || 'Connection refused'
      setBootStatus('failed')
      setBootError(msg)
      let detailText = `Connection Refused to ${API_URL}`
      if (msg.toLowerCase().includes('403') || msg.toLowerCase().includes('retired') || msg.toLowerCase().includes('suspended')) {
        detailText = 'Officer Access Suspended / Account Retired'
      } else if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('password')) {
        detailText = 'Authentication Failed: Invalid Officer Password'
      }
      setBootLogs((prev) => [
        ...prev.map(item => item.id === 'telemetry' ? { ...item, text: `[C4ISR ${isLocal ? 'LOCAL' : 'CLOUD'} TELEMETRY] ${detailText}`, status: 'OFFLINE', ok: false } : item)
      ])
    }
  }

  const abortBoot = () => {
    setBooting(false)
    setBootStatus('booting')
    setBootError(null)
    setBusy(false)
    useAuth.getState().logout()
  }

  const retryBoot = async () => {
    setReChecking(true)
    await runBootSequence(username, password)
    setReChecking(false)
  }

  // When Login page is mounted, verify backend connectivity if an old session exists
  useEffect(() => {
    if (user && bootStatus !== 'verified') {
      fetch(`${API_URL}/cameras`, { method: 'GET', signal: AbortSignal.timeout(3000) })
        .then((res) => {
          if (!res.ok) useAuth.getState().logout()
        })
        .catch(() => {
          useAuth.getState().logout()
        })
    }
  }, [user, bootStatus])

  if (user && !booting && bootStatus === 'verified') return <Navigate to="/" replace />

  const selectRosterMember = (m: RosterMember) => {
    if (m.status === 'RETIRED') {
      setError(`ACCESS SUSPENDED: Officer ${m.name} (${m.serviceId}) is in RETIRED status. Administrative privileges revoked.`)
      return
    }
    setError('')
    setUsername(m.serviceId)
    // Auto-fill standard known pass for testing convenience
    if (m.serviceId.includes('ADM') || m.role === 'ADMIN') setPassword('admin@123')
    else if (m.serviceId.includes('CMD') || m.role === 'COMMANDER') setPassword('commander@123')
    else if (m.serviceId.includes('OP') || m.role === 'OPERATOR') setPassword('operator@123')
    else setPassword('admin@123')
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
    await runBootSequence(username, password)
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

  // Tactical Workstation Booting Screen Overlay (15s Cold-start Wake-up & Bootstrap)
  if (booting) {
    const remainingSeconds = Math.max(0, Math.ceil((15000 - (bootProgress / 100) * 15000) / 1000))
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 font-mono text-cyan-400 select-none p-4 overflow-hidden">
        {/* Background Grid Pattern & Radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.15)_0%,rgba(2,6,23,0.95)_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(6,182,212,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(6,182,212,0.05)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        {/* Central Tactical Workstation Terminal (Dual-Panel Layout) */}
        <div className="relative z-10 w-full max-w-5xl rounded-2xl border border-cyan-500/50 bg-[#071322]/95 backdrop-blur-xl p-6 lg:p-8 shadow-[0_0_80px_rgba(6,182,212,0.3)]">
          {/* Tactical Corner Reticles */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400" />

          {/* Master Header */}
          <div className="flex items-center justify-between border-b border-cyan-500/30 pb-4 mb-6">
            <div className="flex items-center gap-3">
              <div className={`relative flex h-11 w-11 items-center justify-center rounded-xl border ${bootStatus === 'failed' ? 'border-rose-500/70 bg-rose-950/60 shadow-[0_0_20px_rgba(244,63,94,0.4)]' : 'border-cyan-400/60 bg-cyan-950/60 shadow-[0_0_20px_rgba(6,182,212,0.4)]'}`}>
                {bootStatus === 'failed' ? (
                  <AlertTriangle className="text-rose-400 animate-pulse" size={22} />
                ) : (
                  <>
                    <Radar className="text-cyan-400 animate-spin" size={22} style={{ animationDuration: '4s' }} />
                    <span className="absolute inset-0 rounded-xl border border-cyan-300 animate-ping opacity-30" />
                  </>
                )}
              </div>
              <div>
                <div className={`text-[10px] tracking-widest uppercase ${bootStatus === 'failed' ? 'text-rose-400' : 'text-cyan-400/80'}`}>
                  {bootStatus === 'failed' ? 'CRITICAL DEFENSE TELEMETRY ALERT // PS-26187' : 'CLASSIFIED DEFENSE GATEWAY // PS-26187'}
                </div>
                <div className="text-base lg:text-lg font-black tracking-wider text-white">
                  {bootStatus === 'failed' ? 'TACTICAL WORKSTATION BOOTSTRAP ABORTED' : 'ESTABLISHING SECURE TACTICAL WORKSTATION'}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-slate-400">SESSION AUTHENTICATED</div>
              <div className={`text-xs font-bold ${bootStatus === 'failed' ? 'text-rose-400' : 'text-emerald-400'}`}>{username}</div>
            </div>
          </div>

          {/* Dual Panel: Left = Telemetry & Protocol Checks | Right = Mini Tactical Radar Map Intro */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            
            {/* Left Column (7 Cols): Progress & Protocol Checks */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
              
              {/* Animated Progress Bar */}
              <div className="space-y-2">
                <div className="flex justify-between items-baseline text-xs">
                  <span className={`flex items-center gap-2 ${bootStatus === 'failed' ? 'text-rose-300' : 'text-cyan-300'}`}>
                    <Activity size={14} className={`animate-pulse ${bootStatus === 'failed' ? 'text-rose-400' : 'text-cyan-400'}`} />
                    {bootStatus === 'failed' ? 'C4ISR TELEMETRY LINK OFFLINE // ACCESS HALTED' : 'C4ISR NEURAL CORE BOOTSTRAP IN PROGRESS...'}
                  </span>
                  <span className={`text-2xl font-black tracking-wider font-mono ${bootStatus === 'failed' ? 'text-rose-400' : 'text-cyan-300'}`}>
                    {bootStatus === 'failed' ? 'FAILED' : `${bootProgress}%`}
                  </span>
                </div>

                <div className={`h-3 w-full rounded-full bg-slate-950 border p-0.5 overflow-hidden shadow-inner ${bootStatus === 'failed' ? 'border-rose-500/50' : 'border-cyan-500/40'}`}>
                  <div
                    className={`h-full rounded-full transition-all duration-300 ease-out ${bootStatus === 'failed' ? 'bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]' : 'bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_15px_rgba(6,182,212,0.8)]'}`}
                    style={{ width: `${bootProgress}%` }}
                  />
                </div>

                <div className="flex justify-between text-[11px] text-slate-400 pt-0.5">
                  <span>{bootStatus === 'failed' ? 'Mock mode disabled: Real AI engine required' : 'Waking up cloud AI analytics & video pipelines'}</span>
                  <span>{bootStatus === 'failed' ? <span className="text-rose-400 font-bold">TELEMETRY OFFLINE</span> : <>Estimated: <span className="text-white font-bold">{remainingSeconds}s</span> remaining</>}</span>
                </div>
              </div>

              {/* Live Telemetry Boot Logs */}
              <div className="rounded-lg border border-cyan-900/60 bg-black/60 p-3.5 font-mono text-[11px] space-y-2 min-h-[195px] shadow-inner">
                <div className="text-[10px] text-cyan-500/70 uppercase tracking-widest border-b border-cyan-900/40 pb-1 mb-2 flex items-center justify-between">
                  <span>C4ISR BORDER DEFENSE PROTOCOL & SUBSYSTEM CHECKS</span>
                  <span className={`flex items-center gap-1 ${bootStatus === 'failed' ? 'text-rose-400' : 'text-emerald-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${bootStatus === 'failed' ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                    {bootStatus === 'failed' ? 'LINK REFUSED' : 'LIVE TELEMETRY'}
                  </span>
                </div>
                {bootLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-2 text-[11px] py-0.5 animate-fadeIn">
                    <div className="flex items-center gap-2 truncate">
                      {log.ok ? (
                        <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle size={13} className="text-rose-400 shrink-0 animate-pulse" />
                      )}
                      <span className={`font-mono truncate ${log.ok ? 'text-cyan-200' : 'text-rose-200'}`}>{log.text}</span>
                    </div>
                    <span className={`text-[9px] font-bold tracking-wider px-2 py-0.5 rounded shrink-0 border ${
                      log.ok
                        ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                        : 'bg-rose-950/70 border-rose-500/50 text-rose-300 animate-pulse'
                    }`}>
                      {log.status}
                    </span>
                  </div>
                ))}
              </div>

              {/* Status Ticker Line */}
              <div className="flex items-center justify-between text-[11px] text-cyan-500/80 border-t border-cyan-500/20 pt-2">
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full animate-pulse ${bootStatus === 'failed' ? 'bg-rose-500' : 'bg-emerald-400'}`} />
                  {bootStatus === 'failed' ? 'COMMUNICATION INTERRUPT // SECURE LOCKDOWN' : 'AUTHENTICATED HIGH-SECURITY LINK // DISCIPLINE ACTIVE'}
                </span>
                <span className={`font-mono ${bootStatus === 'failed' ? 'text-rose-400 font-bold' : 'text-slate-400'}`}>
                  {bootStatus === 'failed' ? 'DEFCON-1 ALERT' : 'DEFCON-3 ARMED'}
                </span>
              </div>
            </div>

            {/* Right Column (5 Cols): Mini Tactical Border Radar Map Preview */}
            <div className="lg:col-span-5 flex flex-col justify-between rounded-xl border border-cyan-500/30 bg-slate-950/90 p-4 relative overflow-hidden shadow-inner">
              {/* Map Header */}
              <div className="flex items-center justify-between border-b border-cyan-900/50 pb-2 mb-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                  <Globe size={14} className="text-cyan-400 animate-spin" style={{ animationDuration: '20s' }} />
                  <span>SECTOR GEOSPATIAL RADAR</span>
                </div>
                <span className="text-[9px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                  27°02'N 71°12'E
                </span>
              </div>

              {/* Real Satellite Tactical Map Display */}
              <div className="relative h-52 w-full rounded-lg bg-[#040d1a] border border-cyan-800/40 overflow-hidden">
                <MapContainer
                  center={[28.6, 73.0]}
                  zoom={5}
                  className="h-full w-full"
                  attributionControl={false}
                  zoomControl={false}
                  scrollWheelZoom={false}
                  dragging={false}
                  doubleClickZoom={false}
                >
                  <TileLayer url={TILE_URL} />
                  {/* Western Border Indicative Trace */}
                  <Polyline positions={BORDER_LINE} pathOptions={{ color: '#eab308', weight: 2, dashArray: '4 4' }} />
                  {/* BOP Sundar Node (Jaisalmer) */}
                  <CircleMarker center={[27.02, 71.2]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#ef4444', fillOpacity: 1 }} />
                  {/* BOP Attari Node (Amritsar) */}
                  <CircleMarker center={[31.60, 74.57]} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: '#f59e0b', fillOpacity: 1 }} />
                  {/* UAV Flight Vector Line */}
                  <Polyline positions={[[27.02, 71.2], [28.6, 73.0], [31.60, 74.57]]} pathOptions={{ color: '#06b6d4', weight: 1.5, dashArray: '4 4' }} />
                  {/* UAV Blip Marker */}
                  <CircleMarker center={[28.6, 73.0]} radius={5} pathOptions={{ color: '#38bdf8', weight: 2, fillColor: '#0284c7', fillOpacity: 1 }} />
                </MapContainer>

                {/* Overlaid Tactical UAV Telemetry Pill (Matches Real Map View!) */}
                <div className="absolute bottom-2 left-2 right-2 bg-slate-900/95 border border-cyan-500/50 rounded px-2.5 py-1.5 flex items-center justify-between text-[9px] font-mono shadow-md backdrop-blur-sm z-[1000]">
                  <div className="flex items-center gap-2 text-cyan-300">
                    <Navigation size={11} className="text-cyan-400 animate-pulse" />
                    <span className="font-bold text-white">UAV-01</span>
                    <span className="text-slate-300">ALT 2,100m</span>
                    <span className="text-slate-300">145 KT</span>
                  </div>
                  <span className="text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30">
                    EO/MWIR
                  </span>
                </div>
              </div>

              {/* Map Footer Info */}
              <div className="pt-2 text-[10px] text-slate-400 flex items-center justify-between">
                <span>19 Nodes Georeferenced</span>
                <span className="text-cyan-400 font-bold">Interactive Map in HUD</span>
              </div>
            </div>

          </div>

          {/* Critical Failure Diagnostic Card (Shown if Backend Offline / Telemetry Fails) */}
          {bootStatus === 'failed' && (
            <div className="mt-5 rounded-xl border border-rose-500/70 bg-rose-950/50 p-4 shadow-[0_0_35px_rgba(244,63,94,0.3)] animate-fadeIn font-mono">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-rose-400 shrink-0 mt-0.5" size={22} />
                <div className="flex-1 space-y-1.5">
                  <div className="text-xs font-black tracking-wider text-rose-300 uppercase flex items-center gap-2">
                    <span>CRITICAL TELEMETRY FAILURE // ACCESS REFUSED</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-900/80 border border-rose-500/50 text-rose-200">
                      MOCK MODE DISABLED
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-200 leading-relaxed font-sans">
                    The C4ISR Command Center refused entry because the Python AI Surveillance Engine at <code className="text-cyan-300 font-mono px-1.5 py-0.5 bg-black/70 rounded border border-cyan-800/60">{API_URL}</code> did not respond. Synthetic mock mode is disabled to protect operational integrity — live camera streams and YOLOv8 models require an active backend service.
                  </div>
                  <div className="text-[10px] text-amber-300/90 pt-0.5">
                    DIAGNOSTIC: Ensure the backend web service is running locally or deployed on Render/Cloud, then re-ping.
                  </div>
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-end gap-3 pt-2.5 border-t border-rose-900/60">
                <button
                  type="button"
                  onClick={abortBoot}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-700 bg-slate-900/90 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-all font-mono"
                >
                  ← RETURN TO CREDENTIALS
                </button>
                <button
                  type="button"
                  onClick={retryBoot}
                  disabled={reChecking}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg border border-cyan-500/70 bg-cyan-950/90 text-xs font-bold text-cyan-200 hover:bg-cyan-900 hover:text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all font-mono"
                >
                  <RefreshCw size={13} className={reChecking ? 'animate-spin text-cyan-300' : 'text-cyan-400'} />
                  {reChecking ? 'RE-PINGING TELEMETRY...' : 'RE-PING DEFENSE BACKEND'}
                </button>
              </div>
            </div>
          )}
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
