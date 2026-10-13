import { useMemo } from 'react'
import { create } from 'zustand'
import type { Alert, AlertStatus, AlertType, Camera, ConnectionState, Zone } from '@/types'
import { service } from '@/services'
import { beep } from '@/lib/sound'
import { SEV_RANK, eligibleFor, existingIncidentSeverity, groupIncidents } from '@/lib/incidents'
import { useUi } from './ui'
import { useAuth } from './auth'

// Global data + real-time alert system. `start()` is called once at app level
// (after login); every page reads alerts/cameras/zones from here.

export interface Toast {
  key: number
  alertId: string
  repeat: boolean
}

/** Alert types that open the full-screen CRITICAL ALERT modal. */
const MODAL_TYPES: AlertType[] = ['FENCE_INTRUSION', 'FACE_MATCH']
const RENOTIFY_MS = 30_000
const HISTORY_DAYS = 14

interface DataState {
  cameras: Camera[]
  zones: Zone[]
  alerts: Alert[]
  loading: boolean
  error: string | null
  connection: ConnectionState
  toasts: Toast[]
  modalQueue: string[]
  /** cameraId -> time of last alert, drives the red flash on camera tiles. */
  flash: Record<string, number>
  bellPulse: boolean

  load: () => Promise<void>
  start: () => () => void
  refreshCameras: () => Promise<void>
  refreshZones: () => Promise<void>
  ingest: (alert: Alert) => void
  setStatus: (id: string, status: AlertStatus, note?: string) => Promise<void>
  /** Apply a status to every eligible alert in the list (incident-level action). */
  setStatusMany: (ids: string[], status: AlertStatus, note?: string) => Promise<void>
  /** Apply a status to the whole incident that contains this alert. */
  setIncidentStatus: (alertId: string, status: AlertStatus, note?: string) => Promise<void>
  dismissToast: (key: number) => void
  dismissModal: (id: string) => void
  clearBell: () => void
}

let toastKey = 1
const lastNotified = new Map<string, number>()

export const useData = create<DataState>((set, get) => {
  function notify(a: Alert, repeat: boolean) {
    const ui = useUi.getState()
    lastNotified.set(a.id, Date.now())
    const patch: Partial<DataState> = {}
    if (!repeat) patch.flash = { ...get().flash, [a.cameraId]: Date.now() }
    if (ui.popupSeverities.includes(a.severity)) {
      patch.toasts = [{ key: toastKey++, alertId: a.id, repeat }, ...get().toasts.filter((t) => t.alertId !== a.id)].slice(0, 4)
      patch.bellPulse = true
      if (ui.soundEnabled && !ui.muted) beep(a.severity)
    }
    if (!repeat && MODAL_TYPES.includes(a.type) && !get().modalQueue.includes(a.id)) {
      patch.modalQueue = [...get().modalQueue, a.id].slice(-8)
    }
    set(patch)
  }

  return {
    cameras: [],
    zones: [],
    alerts: [],
    loading: true,
    error: null,
    connection: 'connecting',
    toasts: [],
    modalQueue: [],
    flash: {},
    bellPulse: false,

    async load() {
      set({ loading: true, error: null })
      try {
        const from = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
        const [cameras, zones, alerts] = await Promise.all([service.getCameras(), service.getZones(), service.getAlerts({ from })])
        // Keep anything that arrived over the live stream while the request was in flight.
        const ids = new Set(alerts.map((a) => a.id))
        const merged = [...get().alerts.filter((a) => !ids.has(a.id)), ...alerts]
        merged.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        set({ cameras, zones, alerts: merged, loading: false })
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
        if (was === 'offline' && connection === 'online') void get().load()
      })
      // Unacknowledged CRITICAL alerts keep re-notifying every 30 s.
      const timer = setInterval(() => {
        const now = Date.now()
        const recent = get().alerts.filter((a) => now - Date.parse(a.timestamp) <= 3_600_000)
        // One reminder per incident, not per alert.
        for (const inc of groupIncidents(recent)) {
          const a = inc.alerts.find((x) => x.severity === 'CRITICAL' && x.status === 'NEW')
          if (!a) continue
          const last = Math.max(...inc.alerts.map((x) => lastNotified.get(x.id) ?? 0)) || Date.parse(a.timestamp)
          if (now - last >= RENOTIFY_MS) notify(a, true)
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

    async setStatus(id, status, note) {
      const by = useAuth.getState().user?.name ?? 'Operator'
      get().ingest(await service.updateAlertStatus(id, status, by, note))
    },

    async setStatusMany(ids, status, note) {
      const wanted = new Set(ids)
      for (const a of eligibleFor(status, get().alerts.filter((x) => wanted.has(x.id)))) await get().setStatus(a.id, status, note)
    },

    async setIncidentStatus(alertId, status, note) {
      const inc = groupIncidents(get().alerts).find((i) => i.alerts.some((a) => a.id === alertId))
      await get().setStatusMany(inc ? inc.alerts.map((a) => a.id) : [alertId], status, note)
    },

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
