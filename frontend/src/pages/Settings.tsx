import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Lock, Pencil, Play, PlugZap, Plus, Save, Send, Square, Volume2 } from 'lucide-react'
import type { AppSettings, Camera, CameraType, DetectionModules, Severity, User } from '@/types'
import { API_URL, WS_URL, service } from '@/services'
import { useData } from '@/store/data'
import { useUi } from '@/store/ui'
import { useCan } from '@/store/auth'
import { beep } from '@/lib/sound'
import { SEV, SEVERITIES } from '@/lib/format'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { audit } from '@/lib/audit'
import { PrivacyTab, SecurityTab } from './SettingsPrivacySecurity'
import { Chip, EmptyState, ErrorState, Field, InlineWarning, Modal, PageHeader, SkeletonRows, Tabs } from '@/components/ui'

type TabId = 'cameras' | 'detection' | 'notifications' | 'integration' | 'privacy' | 'security' | 'users' | 'demo'

const MODULES: { key: keyof DetectionModules; label: string }[] = [
  { key: 'human', label: 'Human' },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'anpr', label: 'ANPR' },
  { key: 'face', label: 'Face' },
  { key: 'fence', label: 'Fence' },
]

function ReadOnlyNote() {
  return (
    <div className="mb-3">
      <InlineWarning>
        <Lock size={11} className="mr-1 inline" />
        Read-only for Operators. Sign in as Commander or Admin to change these settings.
      </InlineWarning>
    </div>
  )
}

// ---------------- Cameras ----------------
type CameraForm = { id?: string; name: string; locationName: string; streamUrl: string; lat: string; lng: string; cameraType: CameraType; bopId?: string }

function CameraModal({ initial, onClose }: { initial: CameraForm; onClose: () => void }) {
  const [form, setForm] = useState(initial)
  const bops = useData((s) => s.bops)
  const [test, setTest] = useState<{ ok: boolean; message: string } | 'testing' | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<CameraForm>) => setForm((f) => ({ ...f, ...patch }))
  const lat = Number(form.lat)
  const lng = Number(form.lng)
  const valid = form.name.trim() && form.streamUrl.trim() && form.lat !== '' && form.lng !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180

  const runTest = async () => {
    setTest('testing')
    try {
      const r = await service.testCameraConnection(form.streamUrl)
      setTest({ ok: r.ok, message: r.ok ? `${r.message} (${r.latencyMs} ms)` : r.message })
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'Test failed' })
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await service.saveCamera({ id: form.id, name: form.name.trim(), locationName: form.locationName.trim(), streamUrl: form.streamUrl.trim(), lat, lng, cameraType: form.cameraType, bopId: form.bopId })
      await useData.getState().refreshCameras()
      audit('SETTINGS', 'Camera saved', form.name.trim(), form.streamUrl.trim())
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={form.id ? `Edit camera ${form.id}` : 'Add camera'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Camera name">
          <input className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="BOP Sundar - Gate Cam" required autoFocus />
        </Field>
        <Field label="Location">
          <input className="field" value={form.locationName} onChange={(e) => set({ locationName: e.target.value })} placeholder="BOP Sundar, Jaisalmer Sector (RJ)" />
        </Field>
        <Field label="Stream URL (RTSP / HTTP)">
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1 font-mono" value={form.streamUrl} onChange={(e) => { set({ streamUrl: e.target.value }); setTest(null) }} placeholder="rtsp://10.21.4.11:554/stream1" required />
            <button type="button" className="btn" onClick={() => void runTest()} disabled={!form.streamUrl.trim() || test === 'testing'}>
              {test === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Test connection
            </button>
          </div>
        </Field>
        {test && test !== 'testing' && <div className={`text-xs ${test.ok ? 'text-low' : 'text-crit'}`}>{test.ok ? '✓' : '✗'} {test.message}</div>}
        <Field label="Camera type">
          <select className="field" value={form.cameraType} onChange={(e) => set({ cameraType: e.target.value as CameraType })}>
            <option value="visible">Visible (day / colour)</option>
            <option value="ir-night">IR night</option>
            <option value="thermal">Thermal</option>
          </select>
        </Field>
        <Field label="BOP (Sector → BOP)">
          <select className="field" value={form.bopId ?? ''} onChange={(e) => set({ bopId: e.target.value || undefined })}>
            <option value="">Select BOP</option>
            {bops.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude">
            <input type="number" step="any" className="field font-mono" value={form.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="27.7904" required />
          </Field>
          <Field label="Longitude">
            <input type="number" step="any" className="field font-mono" value={form.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="70.3521" required />
          </Field>
        </div>
        <button className="btn btn-primary w-full" type="submit" disabled={!valid || busy}>
          <Save size={13} /> Save camera
        </button>
      </form>
    </Modal>
  )
}

function CamerasTab({ canManage }: { canManage: boolean }) {
  const { cameras, loading } = useData()
  const [editing, setEditing] = useState<CameraForm | null>(null)
  const toForm = (c: Camera): CameraForm => ({ id: c.id, name: c.name, locationName: c.locationName, streamUrl: c.streamUrl, lat: String(c.lat), lng: String(c.lng), cameraType: c.cameraType, bopId: c.bopId })
  const statusStyle = { online: 'border-low/50 bg-low/15 text-low', degraded: 'border-med/50 bg-med/15 text-med', offline: 'border-crit/50 bg-crit/15 text-crit' }
  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-ink-mute">Existing CCTV cameras are added by stream URL. No new hardware is required.</span>
        <button className="btn btn-primary" disabled={!canManage} onClick={() => setEditing({ name: '', locationName: '', streamUrl: '', lat: '', lng: '', cameraType: 'visible' })}>
          <Plus size={13} /> Add camera
        </button>
      </div>
      <div className="panel overflow-x-auto">
        {loading && !cameras.length ? (
          <SkeletonRows />
        ) : !cameras.length ? (
          <EmptyState title="No cameras configured" hint="Add the first camera with its RTSP or HTTP stream URL." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="px-2 py-2">ID</th>
                <th className="px-2">Name</th>
                <th className="px-2">Location</th>
                <th className="px-2">Stream URL</th>
                <th className="px-2">Lat, Lng</th>
                <th className="px-2">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cameras.map((c) => (
                <tr key={c.id} className="border-b border-base-800">
                  <td className="px-2 py-1.5 font-mono text-ink-mute">{c.id}</td>
                  <td className="px-2 font-medium">{c.name}</td>
                  <td className="px-2 text-ink-dim">{c.locationName}</td>
                  <td className="max-w-56 truncate px-2 font-mono text-ink-dim">{c.streamUrl}</td>
                  <td className="px-2 font-mono text-ink-dim">{c.lat.toFixed(4)}, {c.lng.toFixed(4)}</td>
                  <td className="px-2"><Chip className={statusStyle[c.status]}>{c.status}</Chip></td>
                  <td className="px-2 text-right">
                    <button className="btn btn-sm" disabled={!canManage} onClick={() => setEditing(toForm(c))}>
                      <Pencil size={11} /> Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && <CameraModal initial={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

// ---------------- Detection ----------------
function DetectionTab({ canManage }: { canManage: boolean }) {
  const cameras = useData((s) => s.cameras)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const loadSettings = () => {
    setError('')
    service.getSettings().then(setSettings, (e: Error) => setError(e.message))
  }
  useEffect(loadSettings, [])

  if (error) return <div className="panel"><ErrorState message={error} onRetry={loadSettings} /></div>
  if (!settings) return <div className="panel"><SkeletonRows rows={5} /></div>

  const save = async () => {
    setSettings(await service.saveSettings(settings))
    await useData.getState().refreshSettings()
    audit('SETTINGS', 'Settings changed', 'Detection', `confidence ${settings.confidenceThreshold}, loitering ${settings.loiteringSeconds}s, night mode ${settings.nightMode}`)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const patchCamera = async (c: Camera, change: Partial<Camera>, what: string) => {
    await service.saveCamera({ id: c.id, name: c.name, ...change })
    await useData.getState().refreshCameras()
    audit('SETTINGS', 'Camera detection changed', c.name, what)
  }
  const toggleModule = async (c: Camera, key: keyof DetectionModules) => {
    await service.saveCamera({ id: c.id, name: c.name, modules: { ...c.modules, [key]: !c.modules[key] } })
    await useData.getState().refreshCameras()
  }

  return (
    <fieldset disabled={!canManage} className="grid grid-cols-12 gap-3">
      <div className="panel col-span-12 space-y-4 self-start p-3 lg:col-span-4">
        <div className="panel-title">Global thresholds</div>
        <Field label={`Confidence threshold: ${settings.confidenceThreshold.toFixed(2)}`}>
          <input type="range" min={0.1} max={0.9} step={0.05} value={settings.confidenceThreshold} onChange={(e) => setSettings({ ...settings, confidenceThreshold: Number(e.target.value) })} />
          <span className="text-[10px] normal-case">Lower = more detections and more false alarms.</span>
        </Field>
        <Field label={`Loitering time: ${settings.loiteringSeconds} s`}>
          <input type="range" min={10} max={300} step={5} value={settings.loiteringSeconds} onChange={(e) => setSettings({ ...settings, loiteringSeconds: Number(e.target.value) })} />
          <span className="text-[10px] normal-case">A person staying in a zone longer than this raises a LOITERING alert.</span>
        </Field>
        <Field label="Night mode enhancement">
          <select className="field" value={settings.nightMode} onChange={(e) => setSettings({ ...settings, nightMode: e.target.value as AppSettings['nightMode'] })}>
            <option value="auto">Auto (by ambient light / time)</option>
            <option value="on">Always on</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={() => void save()}>
            <Save size={13} /> Save
          </button>
          {saved && <span className="text-xs text-low">Saved</span>}
        </div>
      </div>

      <div className="panel col-span-12 overflow-x-auto lg:col-span-8">
        <div className="flex items-baseline justify-between px-3 pt-3">
          <span className="panel-title">Per-camera detection and false-alarm controls</span>
          <span className="text-[10px] text-ink-mute">More frames to confirm = fewer false alarms, slightly slower alerts</span>
        </div>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
              <th className="px-3 py-2">Camera</th>
              {MODULES.map((m) => (
                <th key={m.key} className="px-2 text-center">{m.label}</th>
              ))}
              <th className="px-2">Sensitivity</th>
              <th className="px-2">Min frames</th>
              <th className="px-2 text-center">Ignore animals</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => (
              <tr key={c.id} className="border-b border-base-800">
                <td className="px-3 py-1.5 font-medium">{c.name}</td>
                {MODULES.map((m) => (
                  <td key={m.key} className="px-2 text-center">
                    <input type="checkbox" aria-label={`${m.label} on ${c.name}`} checked={c.modules[m.key]} onChange={() => void toggleModule(c, m.key)} />
                  </td>
                ))}
                <td className="px-2">
                  <select className="field py-0.5" aria-label={`Sensitivity for ${c.name}`} value={c.sensitivity} onChange={(e) => void patchCamera(c, { sensitivity: Number(e.target.value) }, `sensitivity ${e.target.value}`)}>
                    <option value={0.3}>Low</option>
                    <option value={0.5}>Medium</option>
                    <option value={0.7}>High</option>
                  </select>
                </td>
                <td className="px-2">
                  <select className="field py-0.5 font-mono" aria-label={`Minimum frames for ${c.name}`} value={c.minConfirmFrames} onChange={(e) => void patchCamera(c, { minConfirmFrames: Number(e.target.value) }, `min frames ${e.target.value}`)}>
                    {[3, 5, 8, 12].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 text-center">
                  <input type="checkbox" aria-label={`Ignore animals on ${c.name}`} checked={c.ignoreAnimals} onChange={(e) => void patchCamera(c, { ignoreAnimals: e.target.checked }, `ignore animals ${e.target.checked ? 'on' : 'off'}`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  )
}

// ---------------- Notifications ----------------
function NotificationsTab() {
  const t = useT()
  const { soundEnabled, muted, set } = useUi()
  return (
    <div className="panel max-w-xl space-y-4 p-3">
      <div className="panel-title">This workstation</div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={soundEnabled} onChange={(e) => set({ soundEnabled: e.target.checked })} />
        Alert sound enabled
        <button className="btn btn-sm ml-2" onClick={() => beep('CRITICAL')}>
          <Volume2 size={11} /> Test sound
        </button>
      </label>
      {muted && <div className="text-[11px] text-med">Sound is currently muted from the top bar (press M to unmute).</div>}
      <div>
        <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-mute uppercase">{t('notif.policy')}</div>
        <table className="w-full text-xs">
          <tbody>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((sev) => (
              <tr key={sev} className="border-b border-base-700 last:border-0">
                <td className={`w-24 py-1.5 font-semibold ${SEV[sev].text}`}>{t(`sev.${sev}`)}</td>
                <td className="py-1.5 text-ink-dim">{t(sev === 'CRITICAL' ? 'notif.crit' : sev === 'HIGH' ? 'notif.high' : 'notif.low')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-ink-mute">{t('notif.renotify')}</div>
    </div>
  )
}

// ---------------- Integration (Command & Control) ----------------
const ENDPOINTS: [string, string, string][] = [
  ['GET', '/alerts?from&to&cameraId&limit', 'List alerts / events'],
  ['GET', '/alerts/{id}', 'Single alert with history'],
  ['PATCH', '/alerts/{id}/status', 'Acknowledge / escalate / resolve'],
  ['GET', '/cameras', 'Cameras with health status'],
  ['GET', '/cameras/{id}/stream.mjpg', 'Annotated MJPEG stream'],
  ['GET', '/anpr/reads?search&from&to', 'Plate reads'],
  ['GET', '/faces/matches', 'Watchlist face matches'],
  ['POST', '/integration/webhook/test', 'Send a test event to the webhook'],
]

function IntegrationTab({ canManage }: { canManage: boolean }) {
  const sample = useData((s) => s.alerts[0])
  const [url, setUrl] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | 'sending' | null>(null)
  useEffect(() => {
    service.getSettings().then((s) => {
      setSettings(s)
      setUrl(s.webhookUrl)
    }, () => {})
  }, [])

  const sendTest = async () => {
    setResult('sending')
    try {
      if (settings) setSettings(await service.saveSettings({ ...settings, webhookUrl: url }))
      setResult(await service.sendTestWebhook(url))
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Request failed' })
    }
  }
  const payload = sample ? { event: 'alert.created', data: { ...sample, snapshotUrl: `${API_URL}/alerts/${sample.id}/snapshot.jpg` } } : null

  return (
    <div className="grid grid-cols-12 gap-3">
      <div className="col-span-12 space-y-3 lg:col-span-6">
        <div className="panel p-3">
          <div className="panel-title mb-2">REST API (pull)</div>
          <div className="mb-2 font-mono text-xs">
            Base URL: <span className="text-accent">{API_URL}</span>
          </div>
          <table className="w-full text-[11px]">
            <tbody>
              {ENDPOINTS.map(([method, path, desc]) => (
                <tr key={method + path} className="border-b border-base-800">
                  <td className="py-1 pr-2 font-mono font-semibold text-low">{method}</td>
                  <td className="pr-2 font-mono">{path}</td>
                  <td className="text-ink-mute">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel p-3">
          <div className="panel-title mb-2">WebSocket (live push)</div>
          <div className="font-mono text-xs">
            <span className="text-accent">{WS_URL}</span>
          </div>
          <div className="mt-1 text-[11px] text-ink-mute">
            Messages: <code>alert</code> (new + updated), <code>plate_read</code>, <code>detections</code> (per subscribed camera).
          </div>
        </div>
        <fieldset disabled={!canManage} className="panel p-3">
          <div className="panel-title mb-2">Webhook (push to existing C2 system)</div>
          <Field label="Webhook URL">
            <div className="flex gap-2">
              <input className="field min-w-0 flex-1 font-mono" value={url} onChange={(e) => { setUrl(e.target.value); setResult(null) }} placeholder="https://c2.example.gov.in/ibvap/events" />
              <button className="btn btn-primary" onClick={() => void sendTest()} disabled={!url.trim() || result === 'sending'}>
                {result === 'sending' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send test event
              </button>
            </div>
          </Field>
          {result && result !== 'sending' && <div className={`mt-2 text-xs ${result.ok ? 'text-low' : 'text-crit'}`}>{result.ok ? '✓' : '✗'} {result.message}</div>}
          <div className="mt-2 text-[11px] text-ink-mute">Every new alert is POSTed to this URL as JSON, so an existing Command &amp; Control system can consume IBVAP events without any UI.</div>
        </fieldset>
      </div>
      <div className="panel col-span-12 flex flex-col p-3 lg:col-span-6">
        <div className="panel-title mb-2">Example alert payload</div>
        {payload ? (
          <pre className="max-h-[520px] flex-1 overflow-auto rounded bg-base-950 p-3 font-mono text-[11px] leading-relaxed text-ink-dim">{JSON.stringify(payload, null, 2)}</pre>
        ) : (
          <EmptyState title="No alert available yet" hint="The example payload appears once the first alert has been received." />
        )}
      </div>
    </div>
  )
}

// ---------------- Users ----------------
function UsersTab() {
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState('')
  const loadUsers = () => {
    setError('')
    service.getUsers().then(setUsers, (e: Error) => setError(e.message))
  }
  useEffect(loadUsers, [])
  const roleStyle = { ADMIN: 'border-crit/50 bg-crit/15 text-crit', COMMANDER: 'border-high/50 bg-high/15 text-high', OPERATOR: 'border-accent/50 bg-accent/15 text-accent' }
  return (
    <div className="panel max-w-3xl overflow-x-auto">
      {error ? (
        <ErrorState message={error} onRetry={loadUsers} />
      ) : !users ? (
        <SkeletonRows rows={4} />
      ) : !users.length ? (
        <EmptyState title="No users" />
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
              <th className="px-3 py-2">Name</th>
              <th className="px-2">Username</th>
              <th className="px-2">Role</th>
              <th className="px-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-base-800">
                <td className="px-3 py-1.5 font-medium">{u.name}</td>
                <td className="px-2 font-mono text-ink-dim">{u.username}</td>
                <td className="px-2"><Chip className={roleStyle[u.role]}>{u.role}</Chip></td>
                <td className="px-2 text-ink-dim">{u.active ? 'Active' : 'Disabled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="px-3 py-2 text-[11px] text-ink-mute">
        Operator: acknowledge, escalate, mark false alarm. Commander: also resolve alerts and edit zones / watchlists. Admin: everything, including cameras and settings.
      </div>
    </div>
  )
}

// ---------------- Demo ----------------
function DemoTab() {
  const demo = useUi((s) => s.demo)
  const linkDown = useData((s) => s.connection !== 'online')
  const pending = useData((s) => s.pending.length)
  return (
    <div className="panel max-w-xl space-y-3 p-3">
      <div className="panel-title">Demo Mode (for presentations)</div>
      <p className="text-xs text-ink-dim">
        Runs a scripted story (about 2.5 minutes): "Punjab sector, foggy night, drone drop": fog degrades the visible cameras (thermal River Cam unaffected) → DRONE_SIGHTING near BOP Ajnala → operator marks it on the map, 2 km drone watch starts, nakas highlighted → face watchlist match at Attari (quiet toast) → thermal camera: person crawling (night movement + crawling, tagged In drone watch area, severity raised) → the same track loiters (counter grows, no extra beep) → it crosses the riverbed zone: CRITICAL dialog with the clip → acknowledge → a jeep leaves, ANPR reads a blacklisted plate → share with police naka → playbook + QRT notified → QRT mobile view accepts → bookmark + evidence ZIP (the browser downloads a file) → escalation → About IBVAP.
        Random alerts are paused while it runs.
      </p>
      {!service.demo.available && <InlineWarning>Demo Mode only works in mock mode (VITE_USE_MOCK=true).</InlineWarning>}
      <div className="flex items-center gap-3">
        <button className={`btn ${demo.running ? 'btn-danger' : 'btn-primary'}`} disabled={!service.demo.available} onClick={() => useUi.getState().toggleDemo()}>
          {demo.running ? <Square size={13} /> : <Play size={13} />} {demo.running ? 'Stop demo' : 'Start demo scenario'}
        </button>
        <span className="text-[11px] text-ink-mute">
          Hidden shortcut: <kbd className="rounded border border-base-600 bg-base-800 px-1 font-mono">Ctrl+Shift+D</kbd>
        </span>
      </div>
      <div className="border-t border-base-700 pt-3">
        <div className="panel-title mb-1">Connectivity test</div>
        <p className="mb-2 text-xs text-ink-dim">
          Simulates losing the backend link, as happens at remote outposts. Acknowledge an alert or add a note while it is down: the action is queued
          ("pending sync" in the top bar) and sent when the link is restored.
        </p>
        <div className="flex items-center gap-3">
          <button className={`btn ${linkDown ? 'btn-primary' : 'btn-danger'}`} disabled={!service.demo.available} onClick={() => service.demo.setLinkDown(!linkDown)}>
            {linkDown ? 'Restore backend link' : 'Simulate link loss'}
          </button>
          <span className="font-mono text-[11px] text-ink-mute">{pending} action(s) pending sync</span>
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const t = useT()
  const canManage = useCan('manage')
  // Deep link: /settings?tab=integration
  const [tab, setTab] = useState<TabId>(() => (new URLSearchParams(location.search).get('tab') as TabId | null) ?? 'cameras')
  const gated = tab === 'cameras' || tab === 'detection' || tab === 'integration' || tab === 'privacy' || tab === 'security'
  return (
    <Page>
      <PageHeader title={t('nav.settings')} subtitle="Cameras, detection, notifications, C2 integration, privacy, security and users" />
      <Tabs
        tabs={[
          { id: 'cameras', label: 'Cameras' },
          { id: 'detection', label: 'Detection' },
          { id: 'notifications', label: 'Notifications' },
          { id: 'integration', label: 'Integration (C2)' },
          { id: 'privacy', label: 'Data & Privacy' },
          { id: 'security', label: 'Security' },
          { id: 'users', label: 'Users' },
          { id: 'demo', label: 'Demo Mode' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {gated && !canManage && <ReadOnlyNote />}
      {tab === 'cameras' && <CamerasTab canManage={canManage} />}
      {tab === 'detection' && <DetectionTab canManage={canManage} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'integration' && <IntegrationTab canManage={canManage} />}
      {tab === 'privacy' && <PrivacyTab canManage={canManage} />}
      {tab === 'security' && <SecurityTab canManage={canManage} />}
      {tab === 'users' && <UsersTab />}
      {tab === 'demo' && <DemoTab />}
    </Page>
  )
}
