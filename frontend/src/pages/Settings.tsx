import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Lock, Pencil, Play, PlugZap, Plus, RefreshCw, Save, Send, Square, Volume2, ShieldCheck, UserPlus, AlertTriangle, CheckCircle2, UserCheck, ShieldAlert } from 'lucide-react'
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
  const [previewKey, setPreviewKey] = useState<number>(Date.now())
  const set = (patch: Partial<CameraForm>) => setForm((f) => ({ ...f, ...patch }))
  
  const selectedBop = bops.find((b) => b.id === form.bopId)
  const effectiveLat = form.lat !== '' ? Number(form.lat) : (selectedBop?.lat ?? 31.6042)
  const effectiveLng = form.lng !== '' ? Number(form.lng) : (selectedBop?.lng ?? 74.5731)
  const valid = form.name.trim().length > 0 && form.streamUrl.trim().length > 0

  const runTest = async () => {
    setTest('testing')
    try {
      const r = await service.testCameraConnection(form.streamUrl)
      setTest({ ok: r.ok, message: r.ok ? `${r.message} (${r.latencyMs} ms)` : r.message })
    } catch (e) {
      setTest({ ok: false, message: e instanceof Error ? e.message : 'Test failed' })
    }
  }

  const handleSwitchToWebcam = async () => {
    set({ streamUrl: '0' })
    if (form.id) {
      setBusy(true)
      try {
        await fetch(`${API_URL}/cameras/${form.id}/set-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: '0' })
        })
        setPreviewKey(Date.now())
      } catch (err) {
        console.error('Failed to set webcam source:', err)
      } finally {
        setBusy(false)
      }
    }
  }

  const handleSwitchToDefault = async () => {
    set({ streamUrl: 'default' })
    if (form.id) {
      setBusy(true)
      try {
        await fetch(`${API_URL}/cameras/${form.id}/set-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'default' })
        })
        setPreviewKey(Date.now())
      } catch (err) {
        console.error('Failed to set default source:', err)
      } finally {
        setBusy(false)
      }
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) {
      alert('Please enter Camera Name and Stream URL / Upload a video.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        id: form.id,
        name: form.name.trim(),
        locationName: form.locationName.trim() || 'Sector Perimeter',
        streamUrl: form.streamUrl.trim(),
        lat: effectiveLat,
        lng: effectiveLng,
        cameraType: form.cameraType || 'visible',
        bopId: form.bopId || 'bop-attari'
      }
      const saved = await service.saveCamera(payload)
      const targetId = form.id || (saved && (saved as any).id)
      if (targetId) {
        await fetch(`${API_URL}/cameras/${targetId}/set-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: form.streamUrl.trim() })
        }).catch(() => {})
      }
      await useData.getState().refreshCameras()
      audit('SETTINGS', 'Camera saved', form.name.trim(), form.streamUrl.trim())
      onClose()
    } catch (err: any) {
      console.error('Save camera error:', err)
      alert(`Could not save camera: ${err?.message || 'Server error. Please verify stream path.'}`)
    } finally {
      setBusy(false)
    }
  }

  const isWebcam = form.streamUrl === '0' || form.streamUrl.toLowerCase() === 'webcam'

  return (
    <Modal title={form.id ? `Edit camera ${form.id}` : 'Add camera'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Camera name">
          <input className="field" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="BOP Sundar - Gate Cam" required autoFocus />
        </Field>
        <Field label="Location">
          <input className="field" value={form.locationName} onChange={(e) => set({ locationName: e.target.value })} placeholder="BOP Sundar, Jaisalmer Sector (RJ)" />
        </Field>
        <Field label="Stream Source / Mode">
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              className={`btn btn-sm ${form.streamUrl === '0' || form.streamUrl === 'webcam' ? 'btn-primary ring-2 ring-emerald-500' : ''}`}
              onClick={() => void handleSwitchToWebcam()}
              disabled={busy}
              title="Primary laptop built-in camera"
            >
              📹 Laptop Cam 0 (Built-in)
            </button>
            <button
              type="button"
              className={`btn btn-sm ${form.streamUrl === '1' ? 'btn-primary ring-2 ring-emerald-500' : ''}`}
              onClick={async () => {
                set({ streamUrl: '1' })
                if (form.id) {
                  setBusy(true)
                  try {
                    await fetch(`${API_URL}/cameras/${form.id}/set-source`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ source: '1' })
                    })
                    setPreviewKey(Date.now())
                  } catch (err) {
                    console.error(err)
                  } finally {
                    setBusy(false)
                  }
                }
              }}
              disabled={busy}
              title="External USB Webcam 1 or connected phone camera"
            >
              📹 External USB Cam 1
            </button>
            <button
              type="button"
              className={`btn btn-sm ${form.streamUrl === '2' ? 'btn-primary ring-2 ring-emerald-500' : ''}`}
              onClick={async () => {
                set({ streamUrl: '2' })
                if (form.id) {
                  setBusy(true)
                  try {
                    await fetch(`${API_URL}/cameras/${form.id}/set-source`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ source: '2' })
                    })
                    setPreviewKey(Date.now())
                  } catch (err) {
                    console.error(err)
                  } finally {
                    setBusy(false)
                  }
                }
              }}
              disabled={busy}
              title="External USB Webcam 2"
            >
              📹 External USB Cam 2
            </button>
            <button
              type="button"
              className={`btn btn-sm ${form.streamUrl.includes('demo_videos') || form.streamUrl === 'default' ? 'btn-primary' : ''}`}
              onClick={() => void handleSwitchToDefault()}
              disabled={busy}
            >
              🎬 Border Demo Video
            </button>
            <label className="btn btn-sm cursor-pointer border-dashed border-accent">
              📤 Upload Recorded MP4
              <input
                type="file"
                accept="video/mp4,video/avi,video/mkv,video/webm"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  const fd = new FormData()
                  fd.append('file', file)
                  setBusy(true)
                  try {
                    const uploadEndpoint = form.id
                      ? `${API_URL}/cameras/${form.id}/upload-video`
                      : `${API_URL}/cameras/upload-video`
                    const res = await fetch(uploadEndpoint, { method: 'POST', body: fd })
                    const data = await res.json()
                    if (data.ok) {
                      set({ streamUrl: data.path })
                      setPreviewKey(Date.now())
                      alert(`Video uploaded successfully!\nApplied to stream source: ${data.path}`)
                    } else {
                      alert('Upload failed: ' + (data.detail || 'Server error'))
                    }
                  } catch (err) {
                    alert('Upload failed: ' + String(err))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </label>
          </div>
        </Field>
        <Field label="Stream URL (RTSP / HTTP / USB Index 0, 1, 2)">
          <div className="flex gap-2">
            <input className="field min-w-0 flex-1 font-mono" value={form.streamUrl} onChange={(e) => { set({ streamUrl: e.target.value }); setTest(null) }} placeholder="0 for webcam, 1 for USB cam, or rtsp://..." required />
            <button type="button" className="btn" onClick={() => void runTest()} disabled={!form.streamUrl.trim() || test === 'testing'}>
              {test === 'testing' ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Test connection
            </button>
          </div>
          <span className="text-[10px] text-ink-mute mt-1 block">
            💡 <strong>Multiple Cameras:</strong> Index <strong>0</strong> = Built-in laptop webcam, <strong>1</strong> or <strong>2</strong> = External USB webcams. For network CCTV, enter RTSP URL (e.g. <code>rtsp://192.168.1.100:554/h264</code>).
          </span>
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
          <select
            className="field"
            value={form.bopId ?? ''}
            onChange={(e) => {
              const bId = e.target.value || undefined
              const bObj = bops.find((b) => b.id === bId)
              set({
                bopId: bId,
                ...(bObj ? { lat: String(bObj.lat), lng: String(bObj.lng) } : {})
              })
            }}
          >
            <option value="">Select BOP</option>
            {bops.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Latitude">
            <input type="number" step="any" className="field font-mono" value={form.lat} onChange={(e) => set({ lat: e.target.value })} placeholder="31.6042" />
          </Field>
          <Field label="Longitude">
            <input type="number" step="any" className="field font-mono" value={form.lng} onChange={(e) => set({ lng: e.target.value })} placeholder="74.5731" />
          </Field>
        </div>
        {form.id && (
          <div className="rounded border border-base-700 bg-black/40 p-2">
            <div className="mb-1 text-[11px] font-semibold text-ink-dim flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                {isWebcam ? <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> : '📹'}
                <span>{isWebcam ? 'Live Laptop Webcam Feed:' : 'Stream Preview:'}</span>
              </span>
              <button
                type="button"
                onClick={() => setPreviewKey(Date.now())}
                className="text-[10px] text-accent underline flex items-center gap-1 cursor-pointer hover:text-white"
                title="Reload video preview"
              >
                <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Reload preview
              </button>
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
              <img
                key={previewKey}
                src={`${API_URL}/cameras/${form.id}/stream.mjpg?t=${previewKey}`}
                alt="Stream Preview"
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none'
                }}
              />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className="text-ink-mute">
                Active Source: <strong className="font-mono text-white">{isWebcam ? 'Laptop Webcam (Live Device 0)' : form.streamUrl}</strong>
              </span>
              {isWebcam ? (
                <span className="font-semibold text-emerald-400">● REAL-TIME CAMERA</span>
              ) : (
                <span className="text-ink-mute">● RECORDED STREAM</span>
              )}
            </div>
          </div>
        )}
        <button className="btn btn-primary w-full flex items-center justify-center gap-2" type="submit" disabled={!valid || busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {busy ? 'Saving camera...' : 'Save camera'}
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
        <button className="btn btn-primary" disabled={!canManage} onClick={() => setEditing({ name: '', locationName: '', streamUrl: '', lat: '31.6042', lng: '74.5731', cameraType: 'visible', bopId: 'bop-attari' })}>
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

// ---------------- Personnel & Succession Roster ----------------
interface RosterOfficer {
  id: string
  serviceId: string
  name: string
  role: 'ADMIN' | 'COMMANDER' | 'OPERATOR'
  rank: string
  unit: string
  status: 'ACTIVE' | 'RETIRED'
  lastLogin?: string
}

function UsersTab() {
  const [roster, setRoster] = useState<RosterOfficer[] | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const canManage = useCan('manage')

  const [newOfficer, setNewOfficer] = useState({
    name: '',
    role: 'OPERATOR' as 'ADMIN' | 'COMMANDER' | 'OPERATOR',
    rank: 'Constable',
    unit: 'HQ Border Surveillance Wing',
    password: 'user@123',
  })
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const loadRoster = () => {
    setError('')
    service.getRoster().then(
      (data) => setRoster(data as RosterOfficer[]),
      (e: Error) => setError(e.message)
    )
  }
  useEffect(loadRoster, [])

  const handleRoleChange = async (userId: string, newRole: 'ADMIN' | 'COMMANDER' | 'OPERATOR') => {
    setBusyId(userId)
    setError('')
    setSuccess('')
    try {
      await service.updateOfficerRole(userId, newRole)
      setSuccess(`Role successfully updated to ${newRole}. Access privileges synchronized.`)
      loadRoster()
    } catch (e: any) {
      setError(e?.message || 'Failed to update officer role.')
    } finally {
      setBusyId(null)
    }
  }

  const handleStatusToggle = async (officer: RosterOfficer) => {
    const nextStatus = officer.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE'
    setBusyId(officer.id)
    setError('')
    setSuccess('')
    try {
      await service.updateOfficerStatus(officer.id, nextStatus)
      setSuccess(`Officer ${officer.name} status updated to ${nextStatus}.`)
      loadRoster()
    } catch (e: any) {
      setError(e?.message || 'Status change refused by defense security guardrail.')
    } finally {
      setBusyId(null)
    }
  }

  const handleAddOfficer = async (e: FormEvent) => {
    e.preventDefault()
    if (!newOfficer.name.trim()) {
      setAddError('Officer name is mandatory.')
      return
    }
    setAdding(true)
    setAddError('')
    try {
      const res: any = await service.registerOfficer(newOfficer)
      const assignedId = res?.user?.serviceId || res?.serviceId || 'Assigned'
      setSuccess(`Officer commissioned! Auto-assigned Service ID: ${assignedId}`)
      setShowAddModal(false)
      setNewOfficer({ name: '', role: 'OPERATOR', rank: 'Constable', unit: 'HQ Border Surveillance Wing', password: 'user@123' })
      loadRoster()
    } catch (e: any) {
      setAddError(e?.message || 'Failed to commission officer.')
    } finally {
      setAdding(false)
    }
  }

  const roleStyle = {
    ADMIN: 'border-crit/50 bg-crit/15 text-crit',
    COMMANDER: 'border-high/50 bg-high/15 text-high',
    OPERATOR: 'border-accent/50 bg-accent/15 text-accent',
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header with Commission Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-ink">Defense Personnel & Succession Management</h3>
          <p className="text-xs text-ink-dim">
            Manage military service rosters, role delegation, officer promotions, and retirement access control.
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn btn-primary flex items-center gap-1.5 py-1.5 text-xs font-semibold"
        >
          <UserPlus size={14} /> Commission New Officer
        </button>
      </div>

      {/* Notifications */}
      {success && (
        <div className="rounded border border-low/50 bg-low/10 p-2.5 text-xs text-low flex items-center gap-2">
          <CheckCircle2 size={16} className="shrink-0" />
          <span>{success}</span>
        </div>
      )}
      {error && (
        <div className="rounded border border-crit/50 bg-crit/10 p-2.5 text-xs text-crit flex items-center gap-2">
          <ShieldAlert size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Roster Table */}
      <div className="panel overflow-x-auto">
        {!roster ? (
          <SkeletonRows rows={4} />
        ) : !roster.length ? (
          <EmptyState title="No personnel in roster" />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-base-700 text-left text-[10px] tracking-wider text-ink-mute uppercase">
                <th className="px-3 py-2.5">Service ID</th>
                <th className="px-3 py-2.5">Name & Rank</th>
                <th className="px-3 py-2.5">Assigned Unit</th>
                <th className="px-3 py-2.5">Role / Succession</th>
                <th className="px-3 py-2.5">Operational Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((u) => {
                const isRetired = u.status === 'RETIRED'
                const isBusy = busyId === u.id
                return (
                  <tr key={u.id} className={`border-b border-base-800 ${isRetired ? 'opacity-60 bg-base-950/40' : ''}`}>
                    <td className="px-3 py-2 font-mono font-bold text-accent whitespace-nowrap">
                      {u.serviceId}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">{u.name}</div>
                      <div className="text-[10px] text-ink-mute font-mono">{u.rank}</div>
                    </td>
                    <td className="px-3 py-2 text-ink-dim whitespace-nowrap">
                      {u.unit}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <select
                        value={u.role}
                        disabled={isBusy || !canManage}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as any)}
                        className={`field h-7 px-2 py-0 text-xs font-semibold rounded cursor-pointer ${roleStyle[u.role]}`}
                        title="Change officer role to promote or assign succession"
                      >
                        <option value="OPERATOR">OPERATOR</option>
                        <option value="COMMANDER">COMMANDER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                          isRetired
                            ? 'bg-crit/15 text-crit border border-crit/40'
                            : 'bg-low/15 text-low border border-low/40'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isRetired ? 'bg-crit' : 'bg-low animate-pulse'}`} />
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleStatusToggle(u)}
                        disabled={isBusy || !canManage}
                        className={`btn btn-sm text-[11px] px-2 py-1 ${
                          isRetired
                            ? 'border-low/40 text-low hover:bg-low/10'
                            : 'border-crit/40 text-crit hover:bg-crit/10'
                        }`}
                        title={isRetired ? 'Reactivate officer for operational duties' : 'Retire officer (revokes all system access)'}
                      >
                        {isBusy ? <Loader2 size={12} className="animate-spin" /> : isRetired ? 'Reactivate' : 'Retire'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Succession & Hierarchy Rules Footnote */}
        <div className="border-t border-base-700 bg-base-850/50 p-3 text-[11px] text-ink-mute space-y-1">
          <div className="font-semibold text-ink-dim flex items-center gap-1">
            <ShieldCheck size={13} className="text-accent" /> Military Succession & Access Control Principles:
          </div>
          <p>
            • <strong>Succession (Role Handover):</strong> When an Admin or Commander is due for retirement or transfer, promote an incoming officer to <span className="text-crit font-semibold">ADMIN</span> before retiring the predecessor.
          </p>
          <p>
            • <strong>Last Admin Standing Guardrail:</strong> The system strictly prohibits retiring or demoting the final active Administrator to guarantee the surveillance grid is never locked out.
          </p>
          <p>
            • <strong>Automatic Revocation:</strong> Retired officers are blocked at authentication (HTTP 403 refusal) and cannot enter the Command Center until reactivated.
          </p>
        </div>
      </div>

      {/* Commission Officer Modal */}
      {showAddModal && (
        <Modal title="Commission New Defense Officer" onClose={() => setShowAddModal(false)}>
          <form onSubmit={handleAddOfficer} className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1">
                Officer Full Name
              </label>
              <input
                type="text"
                required
                value={newOfficer.name}
                onChange={(e) => setNewOfficer({ ...newOfficer, name: e.target.value })}
                placeholder="e.g. Insp. Vikram Batra"
                className="field w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1">
                  Designated Role
                </label>
                <select
                  value={newOfficer.role}
                  onChange={(e) => setNewOfficer({ ...newOfficer, role: e.target.value as any })}
                  className="field w-full"
                >
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="COMMANDER">COMMANDER</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1">
                  Military Rank
                </label>
                <input
                  type="text"
                  required
                  value={newOfficer.rank}
                  onChange={(e) => setNewOfficer({ ...newOfficer, rank: e.target.value })}
                  placeholder="e.g. Sub-Inspector"
                  className="field w-full"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1">
                Station / Outpost Unit
              </label>
              <input
                type="text"
                required
                value={newOfficer.unit}
                onChange={(e) => setNewOfficer({ ...newOfficer, unit: e.target.value })}
                placeholder="e.g. BOP Sector-4 Bravo"
                className="field w-full"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono text-ink-mute uppercase mb-1">
                Initial Passkey
              </label>
              <input
                type="password"
                required
                value={newOfficer.password}
                onChange={(e) => setNewOfficer({ ...newOfficer, password: e.target.value })}
                placeholder="Secret authorization key"
                className="field w-full"
              />
            </div>

            <div className="rounded bg-base-800 border border-base-700 p-2 text-[11px] text-ink-dim">
              ⚡ Notice: The system will automatically generate a cryptographically unique Military Service ID (e.g. <span className="font-mono text-accent">IBVAP-{newOfficer.role.slice(0, 3)}-XXXX</span>).
            </div>

            {addError && (
              <div className="rounded border border-crit/50 bg-crit/10 p-2 text-xs text-crit">
                {addError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding}
                className="btn btn-primary font-bold"
              >
                {adding ? 'Commissioning...' : 'Commission Officer'}
              </button>
            </div>
          </form>
        </Modal>
      )}
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
