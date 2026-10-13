import { Link } from 'react-router-dom'
import { ArrowDown, ArrowRight, BrainCircuit, Cctv, MonitorDot, Network, Server, Shield, type LucideIcon } from 'lucide-react'
import { service } from '@/services'
import { useT, type DictKey } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { Chip } from '@/components/ui'

interface Requirement {
  req: string
  how: string
  page: DictKey
  to: string
  where?: string
}

// Problem Statement 26187 requirement -> how IBVAP covers it -> where to see it.
const REQUIREMENTS: Requirement[] = [
  { req: 'Human detection & tracking', how: 'YOLO person detection with ByteTrack IDs; every box shows class, track ID and confidence', page: 'nav.cameras', to: '/cameras' },
  { req: 'Vehicle detection & classification', how: 'Car / truck / bus / motorcycle / tractor classes on live feeds and in every plate read', page: 'nav.cameras', to: '/cameras' },
  { req: 'Face detection', how: 'Faces matched against a watchlist; captured vs watchlist photo with similarity and human Confirm / Reject', page: 'nav.faces', to: '/faces' },
  { req: 'ANPR', how: 'Live plate reads, search, vehicle route across cameras, blacklist that raises alerts, operator correction of low-confidence reads', page: 'nav.anpr', to: '/anpr' },
  { req: 'Virtual fence intrusion', how: 'Polygon zones and directional tripwires drawn on the camera view, with severity, trigger classes, dwell time and schedule', page: 'nav.zones', to: '/zones' },
  { req: 'Suspicious activity', how: 'Loitering and suspicious-activity alerts, grouped into incidents, each with a response playbook and QRT notification', page: 'nav.alerts', to: '/alerts' },
  { req: 'Night-time movement', how: 'Low-light / IR mode per camera, night-only zones, night-movement alerts and a day vs night comparison', page: 'nav.analytics', to: '/analytics' },
  { req: 'Real-time alerts & event logging', how: 'Toasts, sound and a full-screen critical dialog on every screen; searchable event log; evidence export; audit log', page: 'nav.command', to: '/' },
  { req: 'No dedicated hardware', how: 'Existing CCTV cameras are added by their RTSP / HTTP stream URL; no new cameras or sensors', page: 'nav.settings', to: '/settings?tab=cameras', where: 'Cameras' },
  { req: 'C2 integration', how: 'REST API, WebSocket stream and a webhook that pushes every alert as JSON to existing Command & Control systems', page: 'nav.settings', to: '/settings?tab=integration', where: 'Integration (C2)' },
  { req: 'Cost-effective & scalable', how: 'Open-source stack with no licence fees; one small edge node per outpost, added independently as coverage grows', page: 'nav.health', to: '/health' },
  { req: 'Remote deployment', how: 'Edge processing at the outpost, offline-first dashboard, queued operator actions that sync on reconnect, node health monitoring', page: 'nav.health', to: '/health' },
]

function Block({ icon: Icon, title, lines, tone = 'border-base-600' }: { icon: LucideIcon; title: string; lines: string[]; tone?: string }) {
  return (
    <div className={`flex-1 rounded-md border bg-base-850 p-3 ${tone}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon size={18} className="shrink-0 text-accent" />
        <span className="text-sm font-semibold">{title}</span>
      </div>
      <ul className="space-y-0.5 text-[11px] text-ink-dim">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  )
}

const Arrow = ({ label }: { label: string }) => (
  <div className="flex shrink-0 flex-col items-center justify-center px-1 text-ink-mute">
    <span className="font-mono text-[9px] whitespace-nowrap">{label}</span>
    <ArrowRight size={20} className="hidden text-accent lg:block" />
    <ArrowDown size={20} className="text-accent lg:hidden" />
  </div>
)

export default function About() {
  const t = useT()
  return (
    <Page>
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="panel flex flex-wrap items-center gap-4 p-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-accent/50 bg-accent/10">
            <Shield size={30} className="text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-wide">IBVAP - {t('app.tagline')}</h1>
            <p className="mt-0.5 text-sm text-ink-dim">
              AI software that turns the CCTV cameras already installed at border outposts into an intelligent surveillance network, with no new hardware.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Chip className="border-accent/50 bg-accent/15 text-accent">SIH · Problem Statement 26187</Chip>
            {service.mode === 'mock' && <Chip className="border-med/50 bg-med/15 text-med">Dashboard running on simulated data</Chip>}
          </div>
        </div>

        <div className="panel p-4">
          <div className="panel-title mb-3">Architecture</div>
          <div className="flex flex-col items-stretch gap-1 lg:flex-row">
            <Block icon={Cctv} title="Existing CCTV cameras" lines={['BOPs, check posts, border roads', 'RTSP / HTTP streams', 'Day and IR / low-light']} />
            <Arrow label="video" />
            <Block
              icon={BrainCircuit}
              title="AI engine (edge node)"
              tone="border-accent/50"
              lines={['YOLO detection + ByteTrack tracking', 'ANPR, face recognition', 'Virtual fence, loitering, night movement']}
            />
            <Arrow label="events" />
            <Block icon={Server} title="FastAPI backend" lines={['REST API + WebSocket', 'Alerts, zones, watchlists, audit log', 'Snapshots, clips, evidence hashes']} />
            <Arrow label="live" />
            <div className="flex flex-1 flex-col gap-1">
              <Block icon={MonitorDot} title="Command Center dashboard" tone="border-low/50" lines={['This application', 'Operators, Commander, Admin']} />
              <Block icon={Network} title="Existing C2 systems" lines={['Webhook + REST integration']} />
            </div>
          </div>
        </div>

        <div className="panel overflow-x-auto">
          <div className="panel-title px-4 pt-4">Problem statement coverage</div>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="w-8 px-4 py-2">#</th>
                <th className="px-2">Requirement</th>
                <th className="px-2">How IBVAP covers it</th>
                <th className="px-4">See it</th>
              </tr>
            </thead>
            <tbody>
              {REQUIREMENTS.map((r, i) => (
                <tr key={r.req} className="border-b border-base-800 last:border-0">
                  <td className="px-4 py-2 font-mono text-ink-mute">{i + 1}</td>
                  <td className="px-2 font-semibold whitespace-nowrap">{r.req}</td>
                  <td className="px-2 text-ink-dim">{r.how}</td>
                  <td className="px-4 whitespace-nowrap">
                    <Link to={r.to} className="inline-flex items-center gap-1 text-accent hover:underline">
                      {t(r.page)}
                      {r.where ? ` › ${r.where}` : ''} <ArrowRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  )
}
