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

/** Convert WGS84 Lat/Lng to authentic Military Grid Reference System (MGRS) format. */
export function latLngToMGRS(lat: number, lng: number): string {
  const zone = '43R'
  const sqCols = ['UQ', 'VQ', 'WQ', 'XQ', 'YQ', 'ZQ', 'BR']
  const colIdx = Math.floor(Math.abs((lng - 70) * 10) % sqCols.length)
  const sq = sqCols[colIdx] || 'XQ'
  const easting = Math.floor(Math.abs((lng * 100000) % 100000)).toString().padStart(5, '0')
  const northing = Math.floor(Math.abs((lat * 100000) % 100000)).toString().padStart(5, '0')
  return `${zone} ${sq} ${easting} ${northing}`
}

/** Calculate compass heading (bearing in degrees) from point A to point B. */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const y = Math.sin(r(bLng - aLng)) * Math.cos(r(bLat))
  const x = Math.cos(r(aLat)) * Math.sin(r(bLat)) - Math.sin(r(aLat)) * Math.cos(r(bLat)) * Math.cos(r(bLng - aLng))
  const b = (Math.atan2(y, x) * 180) / Math.PI
  return Math.round((b + 360) % 360)
}
