import type { DroneWatch } from '@/types'

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180
  const dLat = r(bLat - aLat)
  const dLng = r(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const isWatchActive = (w: DroneWatch, now = Date.now()) => !w.endedAt && Date.parse(w.expiresAt) > now

/** The active drone watch that covers this point, if any. */
export function watchAt(lat: number, lng: number, watches: DroneWatch[], now = Date.now()) {
  return watches.find((w) => isWatchActive(w, now) && distanceKm(lat, lng, w.lat, w.lng) <= w.radiusKm)
}
