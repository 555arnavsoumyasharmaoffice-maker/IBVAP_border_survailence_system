import type { Alert, ConnectionState, DetectionFrame, PlateRead } from '@/types'
import type { DataService } from '../types'

// Real backend implementation. Shapes and routes are documented in docs/API_CONTRACT.md.
// GET responses are cached in localStorage so the UI can keep showing the last known
// data when the backend is unreachable (border posts have poor connectivity).

const CACHE_PREFIX = 'ibvap.cache.'

type WsMessage =
  | { type: 'alert'; data: Alert }
  | { type: 'detections'; data: DetectionFrame }
  | { type: 'plate_read'; data: PlateRead }

export function createApiService(apiUrl: string, wsUrl: string): DataService {
  const alertSubs = new Set<(a: Alert) => void>()
  const plateSubs = new Set<(r: PlateRead) => void>()
  const connSubs = new Set<(s: ConnectionState) => void>()
  const detSubs = new Map<string, Set<(f: DetectionFrame) => void>>()
  let conn: ConnectionState = 'connecting'
  let ws: WebSocket | null = null
  let retry = 1000

  const setConn = (s: ConnectionState) => {
    if (s === conn) return
    conn = s
    connSubs.forEach((cb) => cb(s))
  }

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const isGet = !init?.method || init.method === 'GET'
    try {
      const res = await fetch(apiUrl + path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init?.headers },
      })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T)
      setConn('online')
      if (isGet) {
        try {
          localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(data))
        } catch {
          /* cache full: ignore */
        }
      }
      return data
    } catch (err) {
      if (err instanceof TypeError) setConn('offline')
      if (isGet) {
        const cached = localStorage.getItem(CACHE_PREFIX + path)
        if (cached) return JSON.parse(cached) as T
      }
      throw err
    }
  }

  const send = (method: string, path: string, body?: unknown) =>
    request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })

  const qs = (params: object) => {
    const p = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== '' && p.set(k, String(v)))
    const s = p.toString()
    return s ? `?${s}` : ''
  }

  const wsSend = (msg: object) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  function connect() {
    if (ws) return
    ws = new WebSocket(wsUrl)
    ws.onopen = () => {
      retry = 1000
      setConn('online')
      detSubs.forEach((_, cameraId) => wsSend({ action: 'subscribe', channel: 'detections', cameraId }))
    }
    ws.onmessage = (ev) => {
      let msg: WsMessage
      try {
        msg = JSON.parse(ev.data)
      } catch {
        return
      }
      if (msg.type === 'alert') alertSubs.forEach((cb) => cb(msg.data))
      else if (msg.type === 'plate_read') plateSubs.forEach((cb) => cb(msg.data))
      else if (msg.type === 'detections') detSubs.get(msg.data.cameraId)?.forEach((cb) => cb(msg.data))
    }
    ws.onclose = () => {
      ws = null
      setConn('offline')
      setTimeout(connect, retry)
      retry = Math.min(retry * 2, 15000)
    }
    ws.onerror = () => ws?.close()
  }

  return {
    mode: 'api',

    login: (username, role) => send('POST', '/auth/login', { username, role }) as never,

    getCameras: () => request('/cameras'),
    saveCamera: (c) => (c.id ? send('PUT', `/cameras/${c.id}`, c) : send('POST', '/cameras', c)) as never,
    testCameraConnection: (streamUrl) => send('POST', '/cameras/test', { streamUrl }) as never,
    getStreamUrl: (camera) => `${apiUrl}/cameras/${camera.id}/stream.mjpg`,

    getAlerts: (q = {}) => request(`/alerts${qs(q)}`),
    getAlert: (id) => request(`/alerts/${id}`),
    updateAlertStatus: (id, status, by, note) => send('PATCH', `/alerts/${id}/status`, { status, by, note }) as never,
    updateAlertNotes: (id, notes) => send('PATCH', `/alerts/${id}/notes`, { notes }) as never,

    getZones: () => request('/zones'),
    saveZone: (z, by) => (z.id ? send('PUT', `/zones/${z.id}`, { ...z, by }) : send('POST', '/zones', { ...z, by })) as never,
    deleteZone: (id, by) => send('DELETE', `/zones/${id}${qs({ by })}`) as never,
    getZoneAudit: () => request('/zones/audit'),

    getPlateReads: (q = {}) => request(`/anpr/reads${qs(q)}`),
    correctPlateRead: (id, plate) => send('PATCH', `/anpr/reads/${id}`, { plate }) as never,
    getBlacklist: () => request('/anpr/blacklist'),
    addBlacklistVehicle: (v) => send('POST', '/anpr/blacklist', v) as never,
    removeBlacklistVehicle: (id) => send('DELETE', `/anpr/blacklist/${id}`) as never,

    getWatchlist: () => request('/faces/watchlist'),
    addWatchlistPerson: (p) => send('POST', '/faces/watchlist', p) as never,
    removeWatchlistPerson: (id) => send('DELETE', `/faces/watchlist/${id}`) as never,
    getFaceMatches: () => request('/faces/matches'),
    reviewFaceMatch: (id, review, by) => send('PATCH', `/faces/matches/${id}`, { review, by }) as never,

    getUsers: () => request('/users'),
    getSettings: () => request('/settings'),
    saveSettings: (s) => send('PUT', '/settings', s) as never,
    sendTestWebhook: (url) => send('POST', '/integration/webhook/test', { url }) as never,

    subscribeAlerts(cb) {
      alertSubs.add(cb)
      connect()
      return () => alertSubs.delete(cb)
    },
    subscribePlateReads(cb) {
      plateSubs.add(cb)
      connect()
      return () => plateSubs.delete(cb)
    },
    subscribeDetections(cameraId, cb) {
      let set = detSubs.get(cameraId)
      if (!set) {
        set = new Set()
        detSubs.set(cameraId, set)
        wsSend({ action: 'subscribe', channel: 'detections', cameraId })
      }
      set.add(cb)
      connect()
      return () => {
        set.delete(cb)
        if (set.size === 0) {
          detSubs.delete(cameraId)
          wsSend({ action: 'unsubscribe', channel: 'detections', cameraId })
        }
      }
    },
    subscribeConnection(cb) {
      connSubs.add(cb)
      cb(conn)
      return () => connSubs.delete(cb)
    },

    demo: { available: false, setAutoSimulation: () => {}, emit: async () => null },
  }
}
