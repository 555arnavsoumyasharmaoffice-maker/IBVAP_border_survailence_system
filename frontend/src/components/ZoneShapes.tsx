import type { Zone } from '@/types'
import { tripwireArrows } from '@/lib/zones'

// Static SVG rendering of zones for still images (alert snapshots).
// Live feeds draw zones on the CameraFeed canvas instead.
const W = 1600
const H = 900

export function ZoneShapes({ zones, highlightId }: { zones: Zone[]; highlightId?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
      {zones
        .filter((z) => z.active && z.points.length >= 2)
        .map((z) => {
          const hot = z.id === highlightId
          const pts = z.points.map(([x, y]) => `${x * W},${y * H}`).join(' ')
          const stroke = hot ? '#fde047' : 'rgba(239,68,68,0.9)'
          return (
            <g key={z.id} stroke={stroke} strokeWidth={hot ? 6 : 4} fill="none">
              {z.type === 'polygon' ? (
                <polygon points={pts} fill={hot ? 'rgba(253,224,71,0.16)' : 'rgba(239,68,68,0.12)'} />
              ) : (
                <>
                  <polyline points={pts} strokeDasharray="22 14" />
                  {tripwireArrows(z.points, z.direction, W, H, 60).map((line, i) => (
                    <polyline key={i} points={line.map((p) => p.join(',')).join(' ')} strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                </>
              )}
              <text x={z.points[0][0] * W + 12} y={z.points[0][1] * H + 40} fill={hot ? '#fde047' : '#fecaca'} stroke="none" fontSize="30" fontFamily="JetBrains Mono, monospace" fontWeight="600">
                {z.name.toUpperCase()}
              </text>
            </g>
          )
        })}
    </svg>
  )
}
