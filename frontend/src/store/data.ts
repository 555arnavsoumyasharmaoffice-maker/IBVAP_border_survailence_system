import { useMemo } from 'react'
import { create } from 'zustand'
import type { Alert, AlertHistoryEntry, AlertStatus, AlertType, AppSettings, Camera, ConnectionState, DroneWatch, Naka, PendingAction, Zone } from '@/types'
import { service } from '@/services'
import { beep } from '@/lib/sound'
import { SEV_RANK, eligibleFor, existingIncidentSeverity, groupIncidents } from '@/lib/incidents'
import { useUi } from './ui'
import { useAuth } from './auth'

// Global data + real-time alert system. `start()` is called once at app level
// (after login); every page reads alerts/cameras/zones from here.

export interface Toast {
  key: number
  /** Alert toast. Absent for plain info notices (e.g. "Acknowledged: ..."). */
  alertId?: string
  /** HIGH alerts: shown without sound or slide-in animation. */
  quiet?: boolean
  /** The single 60 s reminder for an unacknowledged critical incident. */
  reminder?: boolean
  text?: string
}

/** Alert types that open the full-screen CRITICAL ALERT modal. */
const MODAL_TYPES: AlertType[] = ['FENCE_INTRUSION', 'FACE_MATCH']
/** One reminder after this long without acknowledgement... */
const REMIND_MS = 60_000
/** ...then the incident is escalated to the supervisor automatically. */
const AUTO_ESCALATE_MS = 180_000
const HISTORY_DAYS = 14

interface DataState {
  cameras: Camera[]
  zones: Zone[]
  alerts: Alert[]
  droneWatches: DroneWatch[]
  nakas: Naka[]
  settings: AppSettings | null
  loading: boolean
  error: string | null
  connection: ConnectionState
  toasts: Toast[]
  modalQueue: string[]
  /** cameraId -> time of last alert, drives the red flash on camera tiles. */
  flash: Record<string, number>
  bellPulse: boolean
  /** Operator actions made while the backend was unreachable, synced automatically on reconnect. */
  pending: PendingAction[]

  load: () => Promise<void>
  start: () => () => void
  refreshCameras: () => Promise<void>
  refreshZones: () => Promise<void>
  refreshWatches: () => Promise<void>
  refreshSettings: () => Promise<void>
  ingest: (alert: Alert) => void
  setStatus: (id: string, status: AlertStatus, note?: string, opts?: { by?: string; kind?: AlertHistoryEntry['kind'] }) => Promise<void>
  saveNotes: (id: string, notes: string) => Promise<void>
  flushPending: () => Promise<void>
  /** Apply a status to every eligible alert in the list (incident-level action). */
  setStatusMany: (ids: string[], status: AlertStatus, note?: string) => Promise<void>
  /** Apply a status to the whole incident that contains this alert. */
  setIncidentStatus: (alertId: string, status: AlertStatus, note?: string) => Promise<void>
  dismissToast: (key: number) => void
  /** Short info toast (no sound). */
  notice: (text: string) => void
  dismissModal: (id: string) => void
  clearBell: () => void
}

const PENDING_KEY = 'ibvap.pending'
function readPending(): PendingAction[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as PendingAction[]
  } catch {
    return []
  }
}
let flushing = false

let toastKey = 1
/** Incident ids (first alert id) that already got their one reminder / auto-escalation. */
const reminded = new Set<string>()
const autoEscalated = new Set<string>()

/**
 * Notification policy (ISA-18.2 / EEMUA 191 style): only NEW CRITICAL incidents get sound, an animated toast
 * and the bell pulse. HIGH gets a quiet toast. MEDIUM / LOW only appear in the feed.
 */
export function notifyLevel(a: Alert): 'loud' | 'quiet' | 'none' {
  if (a.severity === 'CRITICAL') return 'loud'
  if (a.severity === 'HIGH') return 'quiet'
  return 'none'
}

export const useData = create<DataState>((set, get) => {
  function setPending(pending: PendingAction[]) {
    set({ pending })
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    } catch {
      /* storage full: queue stays in memory */
    }
  }
  // A newer notes edit for the same alert replaces the older queued one.
  const enqueue = (p: PendingAction) => setPending([...get().pending.filter((x) => x.key !== p.key), p])

  const pushToast = (t: Omit<Toast, 'key'>) =>
    set((s) => ({ toasts: [{ ...t, key: toastKey++ }, ...s.toasts.filter((x) => !t.alertId || x.alertId !== t.alertId)].slice(0, 4) }))

  function notify(a: Alert, reminder: boolean) {
    const ui = useUi.getState()
    const level = notifyLevel(a)
    if (!reminder) set({ flash: { ...get().flash, [a.cameraId]: Date.now() } })
    if (level === 'none') return
    pushToast({ alertId: a.id, quiet: level === 'quiet', reminder })
    if (level === 'loud' && !reminder) {
      set({ bellPulse: true })
      if (ui.soundEnabled && !ui.muted) beep(a.severity)
      if (MODAL_TYPES.includes(a.type) && !get().modalQueue.includes(a.id)) set({ modalQueue: [...get().modalQueue, a.id].slice(-8) })
    }
  }

  return {
    cameras: [],
    zones: [],
    alerts: [],
    droneWatches: [],
    nakas: [],
    settings: null,
    loading: true,
    error: null,
    connection: 'connecting',
    toasts: [],
    modalQueue: [],
    flash: {},
    bellPulse: false,
    pending: readPending(),

    async load() {
      set({ loading: true, error: null })
      try {
        const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
        const [cameras, zones, alerts, settings, droneWatches, nakas] = await Promise.all([
          service.getCameras(), service.getZones(), service.getAlerts({ from }), service.getSettings(), service.getDroneWatches(), service.getNakas(),
        ])
        // Keep anything that arrived over the live stream while the request was in flight.
        const ids = new Set(alerts.map((a) => a.id))
        const merged = [...get().alerts.filter((a) => !ids.has(a.id)), ...alerts]
        merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        set({ cameras, zones, alerts: merged, settings, droneWatches, nakas, loading: false })
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : 'Failed to load data' })
      }
    },

    start() {
      void get().load()
      const offAlerts = service.subscribeAlerts((a) => get().ingest(a))
      const offConn = service.subscribeConnection((connection) => {
        const was = get().connection
        set({ connection })
        if (connection !== 'online') return
        // Back online: push queued operator actions first, then refresh everything.
        void get()
          .flushPending()
          .then(() => (was === 'offline' ? get().load() : undefined))
      })
      // Unacknowledged CRITICAL incident: ONE silent reminder after 60 s, then automatic escalation
      // to the supervisor after 3 min. No repeated beeping.
      const timer = setInterval(() => {
        const now = Date.now()
        const recent = get().alerts.filter((a) => now - Date.parse(a.timestamp) <= 3_600_000)
        for (const inc of groupIncidents(recent)) {
          const a = inc.alerts.find((x) => x.severity === 'CRITICAL' && x.status === 'NEW')
          if (!a) continue
          const key = inc.alerts[inc.alerts.length - 1].id
          const age = now - Date.parse(inc.firstSeen)
          if (age >= AUTO_ESCALATE_MS && !autoEscalated.has(key)) {
            autoEscalated.add(key)
            const note = `Escalated to supervisor: not acknowledged within ${AUTO_ESCALATE_MS / 60_000} min`
            for (const x of inc.alerts.filter((y) => y.status === 'NEW')) void get().setStatus(x.id, 'ESCALATED', note, { by: 'System (auto-escalation)', kind: 'auto-escalation' })
            const user = useAuth.getState().user
            if (user) void service.logAudit({ user: 'System', role: user.role, category: 'ALERT', action: 'Auto-escalated to supervisor', target: a.id, details: note }).catch(() => {})
            get().notice(`Auto-escalated to supervisor: ${a.id}`)
          } else if (age >= REMIND_MS && !reminded.has(key)) {
            reminded.add(key)
            notify(a, true)
          }
        }
      }, 5000)
      return () => {
        offAlerts()
        offConn()
        clearInterval(timer)
      }
    },

    refreshCameras: async () => set({ cameras: await service.getCameras() }),
    refreshZones: async () => set({ zones: await service.getZones() }),
    refreshWatches: async () => set({ droneWatches: await service.getDroneWatches() }),
    refreshSettings: async () => set({ settings: await service.getSettings() }),

    ingest(a) {
      const { alerts } = get()
      const exists = alerts.some((x) => x.id === a.id)
      set({ alerts: exists ? alerts.map((x) => (x.id === a.id ? a : x)) : [a, ...alerts] })
      if (!exists && a.status === 'NEW') {
        // Popups / sound fire once per incident. A repeat only notifies again when it is more severe.
        const prior = existingIncidentSeverity(a, alerts)
        if (prior === null || SEV_RANK[a.severity] > SEV_RANK[prior]) notify(a, false)
        else set({ flash: { ...get().flash, [a.cameraId]: Date.now() } })
      }
      if (a.status !== 'NEW') {
        set((s) => ({
          toasts: s.toasts.filter((t) => t.alertId !== a.id),
          modalQueue: s.modalQueue.filter((id) => id !== a.id),
        }))
      }
    },

    async setStatus(id, status, note, opts = {}) {
      const by = opts.by ?? useAuth.getState().user?.name ?? 'Operator'
      const kind = opts.kind
      const queue = () => {
        const at = new Date().toISOString()
        const a = get().alerts.find((x) => x.id === id)
        // Optimistic local update so the operator sees the result immediately.
        if (a) get().ingest({ ...a, status, assignedTo: a.assignedTo ?? by, history: [...a.history, { status, at, by, note: note ? `${note} (pending sync)` : 'pending sync', ...(kind ? { kind } : {}) }] })
        enqueue({ key: `${id}-${at}`, kind: 'status', alertId: id, status, note, by, at, historyKind: kind })
      }
      if (get().connection !== 'online') return queue()
      try {
        get().ingest(await service.updateAlertStatus(id, status, by, note, undefined, kind))
      } catch (e) {
        if (!(e instanceof TypeError)) throw e
        queue() // network failure
      }
    },

    async saveNotes(id, notes) {
      const by = useAuth.getState().user?.name ?? 'Operator'
      const queue = () => {
        const a = get().alerts.find((x) => x.id === id)
        if (a) get().ingest({ ...a, notes })
        enqueue({ key: `${id}-notes`, kind: 'notes', alertId: id, notes, by, at: new Date().toISOString() })
      }
      if (get().connection !== 'online') return queue()
      try {
        get().ingest(await service.updateAlertNotes(id, notes))
      } catch (e) {
        if (!(e instanceof TypeError)) throw e
        queue()
      }
    },

    async flushPending() {
      if (flushing || !get().pending.length) return
      flushing = true
      try {
        while (get().pending.length && get().connection === 'online') {
          const p = get().pending[0]
          try {
            const updated = p.kind === 'status' ? await service.updateAlertStatus(p.alertId, p.status!, p.by, p.note, p.at, p.historyKind) : await service.updateAlertNotes(p.alertId, p.notes ?? '')
            get().ingest(updated)
          } catch (e) {
            if (e instanceof TypeError) break // still offline: keep the queue and try again later
            // Rejected by the backend (e.g. alert no longer exists): drop it rather than block the queue.
          }
          setPending(get().pending.slice(1))
        }
      } finally {
        flushing = false
      }
    },

    async setStatusMany(ids, status, note) {
      const wanted = new Set(ids)
      for (const a of eligibleFor(status, get().alerts.filter((x) => wanted.has(x.id)))) await get().setStatus(a.id, status, note)
    },

    async setIncidentStatus(alertId, status, note) {
      const inc = groupIncidents(get().alerts).find((i) => i.alerts.some((a) => a.id === alertId))
      await get().setStatusMany(inc ? inc.alerts.map((a) => a.id) : [alertId], status, note)
    },

    notice: (text) => pushToast({ text, quiet: true }),
    dismissToast: (key) => set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) })),
    dismissModal: (id) => set((s) => ({ modalQueue: s.modalQueue.filter((x) => x !== id) })),
    clearBell: () => set({ bellPulse: false }),
  }
})

export const useCamera = (id: string | undefined) => useData((s) => s.cameras.find((c) => c.id === id))

/** Alerts grouped into incidents (newest first). */
export function useIncidents() {
  const alerts = useData((s) => s.alerts)
  return useMemo(() => groupIncidents(alerts), [alerts])
}
