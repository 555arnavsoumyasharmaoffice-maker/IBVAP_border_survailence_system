import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight, Bell, ChartColumn, CircleHelp, CloudUpload, Fence, FileText, HeartPulse, Info, Languages, LayoutDashboard, LogOut, Map, Play,
  ScanFace, ScanLine, ScanSearch, ScrollText, Settings, Shield, Square, Sun, Moon, User, Video, Volume2, VolumeX, WifiOff, KeyRound, Eye, EyeOff, ShieldAlert, Loader2, type LucideIcon,
} from 'lucide-react'
import { service } from '@/services'
import { useAuth, useCan } from '@/store/auth'
import { useData } from '@/store/data'
import { useUi, type CameraLayout } from '@/store/ui'
import { useT, type DictKey } from '@/i18n'
import { isActive } from '@/lib/format'
import { AlertToasts, CriticalModal } from '../AlertOverlays'
import { Modal, useNow } from '../ui'
import { WatchBanner } from '../DroneWatch'
import { SitrepModal } from '../SitrepModal'

const NAV: { to: string; key: DictKey; icon: LucideIcon; manageOnly?: boolean }[] = [
  { to: '/', key: 'nav.command', icon: LayoutDashboard },
  { to: '/cameras', key: 'nav.cameras', icon: Video },
  { to: '/map', key: 'nav.map', icon: Map },
  { to: '/alerts', key: 'nav.alerts', icon: Bell },
  { to: '/anpr', key: 'nav.anpr', icon: ScanLine },
  { to: '/search', key: 'nav.search', icon: ScanSearch },
  { to: '/faces', key: 'nav.faces', icon: ScanFace },
  { to: '/zones', key: 'nav.zones', icon: Fence },
  { to: '/analytics', key: 'nav.analytics', icon: ChartColumn },
  { to: '/reports', key: 'nav.reports', icon: FileText },
  { to: '/shift', key: 'nav.shift', icon: ArrowLeftRight },
  { to: '/audit', key: 'nav.audit', icon: ScrollText, manageOnly: true },
  { to: '/settings', key: 'nav.settings', icon: Settings },
  { to: '/about', key: 'nav.about', icon: Info },
]

function Sidebar() {
  const t = useT()
  const canManage = useCan('manage')
  const active = useData((s) => s.alerts.reduce((n, a) => n + (isActive(a) ? 1 : 0), 0))
  return (
    <aside className="no-print flex w-48 shrink-0 flex-col border-r border-base-700 bg-base-900">
      <div className="flex h-12 items-center gap-2 border-b border-base-700 px-3">
        <Shield size={22} className="text-accent" />
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-[0.2em]">IBVAP</div>
          <div className="text-[9px] tracking-wider text-ink-mute uppercase">Border Video Analytics</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV.filter((n) => !n.manageOnly || canManage).map(({ to, key, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive: on }) =>
              `flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] ${on ? 'bg-accent/15 font-semibold text-accent' : 'text-ink-dim hover:bg-base-800 hover:text-ink'}`
            }
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{t(key)}</span>
            {to === '/alerts' && active > 0 && (
              <span className="ml-auto rounded bg-crit px-1.5 font-mono text-[10px] font-bold text-white">{active}</span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-base-700 p-3 font-mono text-[10px] text-ink-mute">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${service.mode === 'mock' ? 'bg-med' : 'bg-low'}`} />
          {service.mode === 'mock' ? 'MOCK DATA MODE' : 'LIVE BACKEND'}
        </div>
        <div>SIH PS-26187 · v0.1</div>
      </div>
    </aside>
  )
}

function TopBar() {
  const t = useT()
  const navigate = useNavigate()
  const now = useNow(1000)
  const user = useAuth((s) => s.user)
  const logout = useAuth((s) => s.logout)
  const cameras = useData((s) => s.cameras)
  const connection = useData((s) => s.connection)
  const bellPulse = useData((s) => s.bellPulse)
  const pending = useData((s) => s.pending.length)
  const active = useData((s) => s.alerts.reduce((n, a) => n + (isActive(a) ? 1 : 0), 0))
  const { lang, theme, muted, toggleLang, toggleTheme, toggleMute } = useUi()
  const [menu, setMenu] = useState(false)
  const [sitrepOpen, setSitrepOpen] = useState(false)
  const [signOutModal, setSignOutModal] = useState(false)
  const [soPassword, setSoPassword] = useState('')
  const [soShowPw, setSoShowPw] = useState(false)
  const [soBusy, setSoBusy] = useState(false)
  const [soError, setSoError] = useState('')

  const handleSignOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!soPassword.trim()) {
      setSoError('Passkey is required to authorize sign out.')
      return
    }
    setSoBusy(true)
    setSoError('')
    try {
      const username = (user as any)?.serviceId || user?.username || user?.name || ''
      await service.verifyPassword(username, soPassword.trim())
      setSignOutModal(false)
      logout('Manual officer sign out verified with passkey')
    } catch (err: any) {
      setSoError(err?.message || 'Invalid passkey. Terminal sign out refused by Defense Security Protocol.')
    } finally {
      setSoBusy(false)
    }
  }
  const online = cameras.filter((c) => c.status !== 'offline').length
  const d = new Date(now)
  const connTone = connection === 'online' ? 'bg-low' : connection === 'offline' ? 'bg-crit' : 'bg-med'
  const iconBtn = 'flex h-8 w-8 items-center justify-center rounded border border-base-700 text-ink-dim hover:bg-base-800 hover:text-ink'

  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-3 border-b border-base-700 bg-base-900 px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs whitespace-nowrap">
        <span className={`h-2 w-2 rounded-full ${connTone} ${connection === 'online' ? '' : 'animate-pulse'}`} />
        <span className="text-ink-mute">{t('top.link')}:</span>
        <span className="font-semibold">{t(`top.${connection}`)}</span>
        <span className="mx-1 h-4 w-px bg-base-700" />
        <Video size={13} className="text-ink-mute" />
        <span className="text-ink-mute">{t('top.cameras')}:</span>
        <span className="font-mono font-semibold">
          {online}/{cameras.length}
        </span>
        <WatchBanner />
        {service.mode === 'mock' && (
          <span className="ml-1 rounded-full border border-med/50 bg-med/10 px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap text-med" title="Simulated data: no backend or real cameras connected">
            {t('top.mockData')}
          </span>
        )}
        {pending > 0 && (
          <span className="ml-1 flex items-center gap-1 rounded border border-med/50 bg-med/15 px-1.5 py-0.5 font-mono text-[11px] text-med" title="Actions made while offline. They sync automatically when the link returns.">
            <CloudUpload size={12} /> {pending} {t('top.pending')}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="mr-1 text-right font-mono leading-tight">
          <div className="text-sm font-semibold">{d.toLocaleTimeString('en-GB')}</div>
          <div className="text-[10px] text-ink-mute">{d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
        </div>
        <button
          onClick={() => setSitrepOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded border border-red-500/50 bg-red-950/30 px-2.5 text-xs font-bold text-red-300 hover:bg-red-900/40 hover:text-white transition-colors"
          title="Open Daily Defense Situation Report (SITREP)"
        >
          <FileText size={13} className="text-red-400" />
          <span className="hidden md:inline">SITREP</span>
        </button>
        <button
          onClick={() => navigate('/alerts')}
          className={`flex h-8 items-center gap-2 rounded border px-2.5 text-xs ${active ? 'border-crit/60 bg-crit/15 text-crit' : 'border-base-700 text-ink-dim'}`}
        >
          <span className="hidden xl:inline">{t('top.activeAlerts')}</span>
          <span className="font-mono text-sm font-bold">{active}</span>
        </button>
        <button
          className={`${iconBtn} ${bellPulse ? 'bell-pulse' : ''}`}
          title={t('nav.alerts')}
          aria-label={t('nav.alerts')}
          onClick={() => {
            useData.getState().clearBell()
            navigate('/alerts')
          }}
        >
          <Bell size={16} />
        </button>
        <button className={`${iconBtn} ${muted ? 'text-high' : ''}`} onClick={toggleMute} title={`${t(muted ? 'top.unmute' : 'top.mute')} (M)`} aria-label={t(muted ? 'top.unmute' : 'top.mute')}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <button className={`${iconBtn} w-auto gap-1 px-2 text-xs font-semibold`} onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}>
          {theme === 'dark' ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-accent" />}
          <span className="hidden sm:inline">{theme === 'dark' ? 'LIGHT' : 'DARK'}</span>
        </button>
        <button className={`${iconBtn} w-auto gap-1 px-2 text-xs font-semibold`} onClick={toggleLang} title="English / हिन्दी">
          <Languages size={15} /> {lang === 'en' ? 'EN' : 'हिं'}
        </button>
        <button className={iconBtn} onClick={() => useUi.getState().set({ shortcutsOpen: true })} title={`${t('top.shortcuts')} (?)`} aria-label={t('top.shortcuts')}>
          <CircleHelp size={16} />
        </button>
        <div className="relative">
          <button className="flex h-8 items-center gap-2 rounded border border-base-700 px-2 text-xs hover:bg-base-800" onClick={() => setMenu((m) => !m)}>
            <User size={15} className="text-accent" />
            <span className="max-w-28 truncate font-medium">{user?.name}</span>
            <span className="rounded bg-base-700 px-1 font-mono text-[9px] text-ink-dim">{user?.role}</span>
          </button>
          {menu && (
            <div className="panel absolute right-0 z-[1200] mt-1 w-44 p-1 shadow-xl shadow-black/60" onMouseLeave={() => setMenu(false)}>
              <button
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-800"
                onClick={() => {
                  setMenu(false)
                  setSoPassword('')
                  setSoError('')
                  setSignOutModal(true)
                }}
              >
                <LogOut size={14} /> {t('act.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
      <SitrepModal isOpen={sitrepOpen} onClose={() => setSitrepOpen(false)} />
      {signOutModal && (
        <Modal title="Authorize Terminal Sign Out" onClose={() => setSignOutModal(false)}>
          <form onSubmit={handleSignOutSubmit} className="space-y-3.5">
            <div className="rounded border border-base-700 bg-base-850 p-3">
              <div className="text-[11px] font-mono uppercase tracking-wider text-ink-mute">Active Terminal Officer</div>
              <div className="text-sm font-bold text-ink mt-0.5">{user?.name}</div>
              <div className="flex items-center gap-2 font-mono text-[11px] text-accent mt-0.5">
                <span>{(user as any)?.serviceId || user?.username}</span>
                <span className="text-ink-mute">·</span>
                <span>{user?.role}</span>
                {(user as any)?.rank && (
                  <>
                    <span className="text-ink-mute">·</span>
                    <span className="text-ink-dim">{(user as any)?.rank}</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1 flex items-center justify-between">
                <span>Enter Security Passkey</span>
                <span className="text-[10px] text-ink-mute">Salted Verification</span>
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-ink-mute">
                  <KeyRound size={15} />
                </div>
                <input
                  type={soShowPw ? 'text' : 'password'}
                  required
                  autoFocus
                  value={soPassword}
                  onChange={(e) => setSoPassword(e.target.value)}
                  placeholder="Enter passkey to sign out"
                  className="field w-full pl-8 pr-8"
                />
                <button
                  type="button"
                  onClick={() => setSoShowPw(!soShowPw)}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-mute hover:text-ink"
                >
                  {soShowPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {soError && (
              <div className="rounded border border-crit/50 bg-crit/10 p-2 text-xs text-crit flex items-start gap-1.5">
                <ShieldAlert size={15} className="shrink-0 mt-0.5 text-crit" />
                <span>{soError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setSignOutModal(false)}
                className="btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={soBusy}
                className="btn btn-danger font-semibold flex items-center gap-1.5"
              >
                {soBusy ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                <span>{soBusy ? 'Verifying...' : 'Authorize Sign Out'}</span>
              </button>
            </div>
          </form>
        </Modal>
      )}
    </header>
  )
}

const SHORTCUTS: [string, string][] = [
  ['A', 'Acknowledge the alert in the open critical dialog, or the alert you clicked (never the card under the mouse)'],
  ['M', 'Mute / unmute alert sound'],
  ['1 2 3', 'Live Cameras layout: 1x1, 2x2, 3x3 (max 9 feeds per operator)'],
  ['?', 'Show this help'],
  ['Esc', 'Close dialogs'],
  ['Ctrl+Shift+D', 'Start / stop Demo Mode (scripted scenario, about 2 minutes)'],
]

function ShortcutsModal() {
  const open = useUi((s) => s.shortcutsOpen)
  if (!open) return null
  return (
    <Modal title="Keyboard shortcuts" onClose={() => useUi.getState().set({ shortcutsOpen: false })}>
      <table className="w-full text-xs">
        <tbody>
          {SHORTCUTS.map(([k, label]) => (
            <tr key={k} className="border-b border-base-700 last:border-0">
              <td className="py-2 pr-4 whitespace-nowrap">
                <kbd className="rounded border border-base-600 bg-base-800 px-1.5 py-0.5 font-mono">{k}</kbd>
              </td>
              <td className="py-2 text-ink-dim">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

function useShortcuts() {
  const navigate = useNavigate()
  const translate = useT()
  const tRef = useRef(translate)
  tRef.current = translate
  const location = useLocation()
  const pathRef = useRef(location.pathname)
  pathRef.current = location.pathname
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        useUi.getState().toggleDemo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const ui = useUi.getState()
      const data = useData.getState()
      switch (e.key) {
        case 'a':
        case 'A': {
          // Only the alert in the open critical dialog, or the one the operator explicitly selected.
          const id = data.modalQueue[0] ?? ui.selectedAlertId
          const alert = data.alerts.find((x) => x.id === id)
          if (alert?.status !== 'NEW') break
          void data.setIncidentStatus(alert.id, 'ACKNOWLEDGED')
          const cam = data.cameras.find((c) => c.id === alert.cameraId)
          data.notice(`Acknowledged: ${tRef.current(`type.${alert.type}` as DictKey)} - ${cam?.name ?? alert.cameraId}`)
          break
        }
        case 'm':
        case 'M':
          ui.toggleMute()
          break
        case '1':
        case '2':
        case '3':
          ui.set({ cameraLayout: Number(e.key) as CameraLayout })
          if (pathRef.current !== '/cameras') navigate('/cameras')
          break
        case '?':
          ui.set({ shortcutsOpen: !ui.shortcutsOpen })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}

export function DemoBanner() {
  const demo = useUi((s) => s.demo)
  if (!demo.caption) return null
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[2100] flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-3xl items-center gap-3 rounded-full border border-accent bg-base-950/95 py-2 pr-2 pl-4 shadow-2xl shadow-black">
        <Play size={14} className="shrink-0 text-accent" />
        {demo.running && (
          <span className="shrink-0 font-mono text-[11px] text-accent">
            DEMO {demo.step}/{demo.total}
          </span>
        )}
        <span className="text-sm font-medium">{demo.caption}</span>
        {demo.running && (
          <button className="btn btn-sm shrink-0 rounded-full" onClick={() => useUi.getState().toggleDemo()}>
            <Square size={10} /> Stop
          </button>
        )}
      </div>
    </div>
  )
}

function ConnectionBanner() {
  const connection = useData((s) => s.connection)
  const error = useData((s) => s.error)
  const loading = useData((s) => s.loading)
  const pending = useData((s) => s.pending.length)
  if ((connection === 'online' && !error) || (connection === 'connecting' && loading)) return null
  return (
    <div className="no-print flex flex-wrap items-center gap-2 border-b border-high/40 bg-high/15 px-3 py-1.5 text-xs text-high">
      <WifiOff size={14} />
      <span className="font-semibold">Backend not reachable, showing cached data.</span>
      <span className="text-ink-dim">
        Live alerts are paused. {connection === 'connecting' ? 'Reconnecting now.' : 'Reconnecting automatically.'} You can keep acknowledging alerts and adding notes
        {pending ? `: ${pending} action${pending > 1 ? 's' : ''} pending sync.` : '; they sync when the link returns.'}
      </span>
      <button className="btn btn-sm ml-auto" onClick={() => void useData.getState().load()}>
        Retry now
      </button>
    </div>
  )
}

/** Signs the operator out after `settings.sessionTimeoutMin` minutes without mouse / keyboard activity. */
function useIdleLogout() {
  const minutes = useData((s) => s.settings?.sessionTimeoutMin ?? 15)
  useEffect(() => {
    let last = Date.now()
    const bump = () => {
      last = Date.now()
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }))
    const timer = setInterval(() => {
      if (useUi.getState().demo.running) return bump() // a running demo counts as activity
      if (Date.now() - last < minutes * 60_000) return
      sessionStorage.setItem('ibvap.timedOut', String(minutes))
      useAuth.getState().logout('auto-logout after inactivity')
    }, 5000)
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump))
      clearInterval(timer)
    }
  }, [minutes])
}

function Shell() {
  useEffect(() => useData.getState().start(), [])
  const theme = useUi((s) => s.theme)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('light', theme === 'light')
    }
  }, [theme])
  useIdleLogout()
  useShortcuts()
  return (
    <div className="shell flex h-full">
      <Sidebar />
      <div className="shell flex min-w-0 flex-1 flex-col">
        <TopBar />
        <ConnectionBanner />
        <main className="shell min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <AlertToasts />
      <CriticalModal />
      <ShortcutsModal />
      <DemoBanner />
    </div>
  )
}

export function Layout() {
  const user = useAuth((s) => s.user)
  if (!user) return <Navigate to="/login" replace />
  return <Shell />
}

/** Standard scrolling page container. */
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`print-root h-full overflow-auto p-3 ${className}`}>{children}</div>
}


