import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cpu, HardDrive, Server, Thermometer, TriangleAlert, Video } from 'lucide-react'
import type { EdgeNode } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { fmtDateTime, relTime } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { Chip, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui'

// Warning thresholds for remote edge nodes.
const LIMIT = { tempC: 80, diskPct: 90, minFps: 12, latencyMs: 250, cpuPct: 90 }
const POLL_MS = 5000

export function nodeWarnings(n: EdgeNode): string[] {
  if (n.status === 'offline') return ['Node offline: no heartbeat']
  const w: string[] = []
  if (n.tempC >= LIMIT.tempC) w.push(`Overheating: ${Math.round(n.tempC)}°C`)
  if (n.diskPct >= LIMIT.diskPct) w.push(`Disk almost full: ${Math.round(n.diskPct)}%`)
  if (n.processingFps < LIMIT.minFps) w.push(`Processing FPS dropped to ${n.processingFps.toFixed(1)}`)
  if (n.latencyMs > LIMIT.latencyMs) w.push(`High latency: ${Math.round(n.latencyMs)} ms`)
  if (n.cpuPct >= LIMIT.cpuPct) w.push(`CPU saturated: ${Math.round(n.cpuPct)}%`)
  return w
}

const uptime = (sec: number) => {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`
}

function Meter({ label, value, warn, icon: Icon }: { label: string; value: number; warn: boolean; icon?: typeof Cpu }) {
  const tone = warn ? 'bg-crit' : value >= 75 ? 'bg-med' : 'bg-low'
  return (
    <div>
      <div className="flex items-center justify-between text-[10px]">
        <span className="flex items-center gap-1 tracking-wide text-ink-mute uppercase">
          {Icon && <Icon size={10} />} {label}
        </span>
        <span className={`font-mono font-semibold ${warn ? 'text-crit' : 'text-ink'}`}>{Math.round(value)}%</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-base-700">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  )
}

function Fact({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] tracking-wide text-ink-mute uppercase">{label}</div>
      <div className={`font-mono text-sm font-semibold ${warn ? 'text-crit' : ''}`}>{value}</div>
    </div>
  )
}

function NodeCard({ node }: { node: EdgeNode }) {
  const cameras = useData((s) => s.cameras)
  const warnings = nodeWarnings(node)
  const off = node.status === 'offline'
  const style = off ? 'border-crit/50 bg-crit/15 text-crit' : warnings.length ? 'border-med/50 bg-med/15 text-med' : 'border-low/50 bg-low/15 text-low'
  return (
    <div className={`panel flex flex-col gap-2.5 p-3 ${warnings.length ? (off ? 'border-crit/60' : 'border-med/60') : ''}`}>
      <div className="flex items-start gap-2">
        <Server size={18} className={off ? 'text-crit' : 'text-accent'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{node.name}</div>
          <div className="truncate text-[11px] text-ink-mute">{node.locationName}</div>
        </div>
        <Chip className={style}>{off ? 'Offline' : warnings.length ? 'Warning' : 'Healthy'}</Chip>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-0.5 rounded border border-med/40 bg-med/10 px-2 py-1.5 text-[11px] text-med">
          {warnings.map((w) => (
            <li key={w} className="flex items-center gap-1.5">
              <TriangleAlert size={11} className="shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      {off ? (
        <div className="text-xs text-ink-dim">
          Last heartbeat <span className="font-mono">{fmtDateTime(node.lastHeartbeat)}</span> ({relTime(node.lastHeartbeat)}). Cameras on this node are not being analysed.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Meter label="CPU" value={node.cpuPct} warn={node.cpuPct >= LIMIT.cpuPct} icon={Cpu} />
            <Meter label="GPU" value={node.gpuPct} warn={false} icon={Cpu} />
            <Meter label="RAM" value={node.ramPct} warn={node.ramPct >= 92} />
            <Meter label="Disk" value={node.diskPct} warn={node.diskPct >= LIMIT.diskPct} icon={HardDrive} />
          </div>
          <div className="grid grid-cols-4 gap-2 border-t border-base-700 pt-2">
            <Fact label="Proc. FPS" value={node.processingFps.toFixed(1)} warn={node.processingFps < LIMIT.minFps} />
            <Fact label="Latency" value={`${Math.round(node.latencyMs)} ms`} warn={node.latencyMs > LIMIT.latencyMs} />
            <Fact label="Temp" value={`${Math.round(node.tempC)}°C`} warn={node.tempC >= LIMIT.tempC} />
            <Fact label="Bandwidth" value={`${node.bandwidthMbps.toFixed(1)} Mb/s`} />
          </div>
        </>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-base-700 pt-2 font-mono text-[10px] text-ink-mute">
        <span>{node.id}</span>
        <span>model {node.modelVersion}</span>
        {!off && <span>up {uptime(node.uptimeSec)}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {node.cameraIds.map((id) => {
          const c = cameras.find((x) => x.id === id)
          return (
            <Link key={id} to={`/cameras?cam=${id}`} className="flex items-center gap-1 rounded border border-base-700 bg-base-850 px-1.5 py-0.5 text-[10px] hover:border-accent hover:text-accent">
              <Video size={10} className={c?.status === 'offline' ? 'text-crit' : c?.status === 'degraded' ? 'text-med' : 'text-low'} />
              {c?.name ?? id}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export default function SystemHealth() {
  const t = useT()
  const [nodes, setNodes] = useState<EdgeNode[] | null>(null)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(0)

  const load = useCallback(() => {
    service.getEdgeNodes().then(
      (n) => {
        setNodes(n)
        setError('')
        setUpdated(Date.now())
      },
      (e: Error) => setError(e.message),
    )
  }, [])
  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const online = nodes?.filter((n) => n.status !== 'offline') ?? []
  const warned = nodes?.filter((n) => nodeWarnings(n).length) ?? []
  const avg = (f: (n: EdgeNode) => number) => (online.length ? online.reduce((s, n) => s + f(n), 0) / online.length : NaN)

  return (
    <Page>
      <PageHeader title={t('nav.health')} subtitle="Edge AI nodes at each outpost: load, temperature, storage, link quality and model version">
        {updated > 0 && <span className="font-mono text-[11px] text-ink-mute">updated {new Date(updated).toLocaleTimeString('en-GB')} · refresh every {POLL_MS / 1000}s</span>}
      </PageHeader>

      {error && nodes && <div className="mb-2 rounded border border-high/40 bg-high/15 px-3 py-1.5 text-xs text-high">Backend not reachable, showing last known values.</div>}

      {!nodes && error ? (
        <div className="panel"><ErrorState message={error} onRetry={load} /></div>
      ) : !nodes ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : !nodes.length ? (
        <div className="panel"><EmptyState title="No edge nodes registered" hint="Edge nodes appear here after they send their first heartbeat." icon={Server} /></div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Nodes online" value={`${online.length}/${nodes.length}`} tone={online.length < nodes.length ? 'text-med' : 'text-low'} />
            <Stat label="Nodes with warnings" value={warned.length} tone={warned.length ? 'text-crit' : 'text-low'} />
            <Stat label="Avg processing FPS" value={isNaN(avg((n) => n.processingFps)) ? '-' : avg((n) => n.processingFps).toFixed(1)} />
            <Stat label="Avg latency" value={isNaN(avg((n) => n.latencyMs)) ? '-' : `${Math.round(avg((n) => n.latencyMs))} ms`} />
            <Stat label="Total bandwidth" value={`${online.reduce((s, n) => s + n.bandwidthMbps, 0).toFixed(1)} Mb/s`} />
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {nodes.map((n) => (
              <NodeCard key={n.id} node={n} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-mute">
            <Thermometer size={12} /> Warnings: temperature ≥ {LIMIT.tempC}°C, disk ≥ {LIMIT.diskPct}%, processing FPS &lt; {LIMIT.minFps}, latency &gt; {LIMIT.latencyMs} ms, CPU ≥ {LIMIT.cpuPct}%.
          </div>
        </>
      )}
    </Page>
  )
}
