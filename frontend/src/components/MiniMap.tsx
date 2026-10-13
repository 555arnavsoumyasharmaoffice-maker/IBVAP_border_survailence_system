import { useEffect } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import type { LatLngTuple } from 'leaflet'

export interface MapPoint {
  lat: number
  lng: number
  label: string
  color?: string
}

// OpenStreetMap tiles are the only thing in the app that needs internet.
// Without a connection the pins still render on the dark background.
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
export const TILE_ATTR = '&copy; OpenStreetMap contributors'

function Fit({ points }: { points: MapPoint[] }) {
  const map = useMap()
  const key = points.map((p) => `${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (!points.length) return
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], 11)
    else map.fitBounds(points.map((p) => [p.lat, p.lng] as LatLngTuple), { padding: [28, 28], maxZoom: 11 })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/** Small non-interactive-by-default map: a pin, or an ordered route between sightings. */
export function MiniMap({ points, route = false, className = 'h-44' }: { points: MapPoint[]; route?: boolean; className?: string }) {
  if (!points.length) return null
  return (
    <div className={`overflow-hidden rounded border border-base-700 ${className}`}>
      <MapContainer center={[points[0].lat, points[0].lng]} zoom={10} className="h-full w-full" attributionControl={false} zoomControl={false} scrollWheelZoom={false}>
        <TileLayer url={TILE_URL} />
        <Fit points={points} />
        {route && points.length > 1 && (
          <Polyline positions={points.map((p) => [p.lat, p.lng] as LatLngTuple)} pathOptions={{ color: '#38bdf8', weight: 2, dashArray: '6 6' }} />
        )}
        {points.map((p, i) => (
          <CircleMarker key={i} center={[p.lat, p.lng]} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: p.color ?? '#ef4444', fillOpacity: 1 }}>
            <Tooltip direction="top" offset={[0, -6]}>{p.label}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}
