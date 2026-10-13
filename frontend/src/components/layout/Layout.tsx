import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, ChartColumn, CircleHelp, CloudUpload, Fence, FileText, HeartPulse, Languages, LayoutDashboard, LogOut, Map, Play,
  ScanFace, ScanLine, ScrollText, Settings, Shield, Square, User, Video, Volume2, VolumeX, WifiOff, type LucideIcon,
} from 'lucide-react'
import { service } from '@/services'
import { useAuth, useCan } from '@/store/auth'
import { useData } from '@/store/data'
import { useUi, type CameraLayout } from '@/store/ui'
import { useT, type DictKey } from '@/i18n'
import { isActive } from '@/lib/format'
import { useDemoRunner } from '@/demo/useDemoRunner'
import { AlertToasts, CriticalModal } from '../AlertOverlays'
import { Modal, useNow } from '../ui'

const NAV: { to: string; key: DictKey; icon: LucideIcon; manageOnly?: boolean }[] = [
  { to: '/', key: 'nav.command', icon: LayoutDashboard },
  { to: '/cameras', key: 'nav.cameras', icon: Video },
  { to: '/map', key: 'nav.map', icon: Map },
  { to: '/alerts', key: 'nav.alerts', icon: Bell },
  { to: '/anpr', key: 'nav.anpr', icon: ScanLine },
  { to: '/faces', key: 'nav.faces', icon: ScanFace },
  { to: '/zones', key: 'nav.zones', icon: Fence },
  { to: '/analytics', key: 'nav.analytics', icon: ChartColumn },
  { to: '/reports', key: 'nav.reports', icon: FileText },
  { to: '/audit', key: 'nav.audit', icon: ScrollText, manageOnly: true },
  { to: '/health', key: 'nav.health', icon: HeartPulse },
  { to: '/settings', key: 'nav.settings', icon: Settings },
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
  const { lang, muted, toggleLang, toggleMute } = useUi()
  const [menu, setMenu] = useState(false)
  const online = cameras.filter((c) => c.status !== 'offline').length
  const d = new Date(now)
  const connTone = connection === 'online' ? 'bg-low' : connection === 'offline' ? 'bg-crit' : 'bg-med'
  const iconBtn = 'flex h-8 w-8 items-center justify-center rounded border border-base-700 text-ink-dim hover:bg-base-800 hover:text-ink'

  return (
    <header className="no-print flex h-12 shrink-0 items-center gap-3 border-b border-base-700 bg-base-900 px-3">
      <div className="flex items-center gap-2 text-xs">
        <span className={`h-2 w-2 rounded-full ${connTone} ${connection === 'online' ? '' : 'animate-pulse'}`} />
        <span className="text-ink-mute">{t('top.link')}:</span>
        <span className="font-semibold">{t(`top.${connection}`)}</span>
        <span className="mx-1 h-4 w-px bg-base-700" />
        <Video size={13} className="text-ink-mute" />
        <span className="text-ink-mute">{t('top.cameras')}:</span>
        <span className="font-mono font-semibold">
          {online}/{cameras.length}
        </span>
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
              <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-base-800" onClick={() => logout()}>
                <LogOut size={14} /> {t('act.logout')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

const SHORTCUTS: [string, string][] = [
  ['A', 'Acknowledge the focused alert (critical modal, or the alert card under the mouse)'],
  ['M', 'Mute / unmute alert sound'],
  ['1 2 3 4', 'Live Cameras layout: 1x1, 2x2, 3x3, 4x4'],
  ['?', 'Show this help'],
  ['Esc', 'Close dialogs'],
  ['Ctrl+Shift+D', 'Start / stop Demo Mode (scripted 2-minute scenario)'],
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
          const id = data.modalQueue[0] ?? ui.focusedAlertId
          const alert = data.alerts.find((x) => x.id === id)
          if (alert?.status === 'NEW') void data.setIncidentStatus(alert.id, 'ACKNOWLEDGED')
          break
        }
        case 'm':
        case 'M':
          ui.toggleMute()
          break
        case '1':
        case '2':
        case '3':
        case '4':
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

function DemoBanner() {
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
  useIdleLogout()
  useShortcuts()
  useDemoRunner()
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


