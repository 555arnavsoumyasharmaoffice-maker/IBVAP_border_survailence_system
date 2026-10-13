import type { TripwireDirection } from '@/types'

type Pt = [number, number]

/**
 * Polylines (in pixel space) for the direction arrow(s) of a tripwire.
 * "forward" points to the RIGHT of A->B as seen on screen (y grows downward),
 * i.e. an object moving along the arrow triggers the wire.
 */
export function tripwireArrows(points: Pt[], direction: TripwireDirection, w: number, h: number, len = 26): Pt[][] {
  if (points.length < 2) return []
  const [ax, ay] = [points[0][0] * w, points[0][1] * h]
  const [bx, by] = [points[1][0] * w, points[1][1] * h]
  const dx = bx - ax
  const dy = by - ay
  const L = Math.hypot(dx, dy)
  if (L < 1) return []
  const ux = dx / L
  const uy = dy / L
  const nx = -uy // right-hand normal on screen
  const ny = ux
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const head = len * 0.36

  const arrow = (sign: 1 | -1, offset: number): Pt[][] => {
    const ox = mx + ux * offset
    const oy = my + uy * offset
    const tail: Pt = [ox - nx * sign * len * 0.45, oy - ny * sign * len * 0.45]
    const tip: Pt = [ox + nx * sign * len, oy + ny * sign * len]
    const back: Pt = [tip[0] - nx * sign * head, tip[1] - ny * sign * head]
    return [
      [tail, tip],
      [[back[0] + ux * head * 0.7, back[1] + uy * head * 0.7], tip, [back[0] - ux * head * 0.7, back[1] - uy * head * 0.7]],
    ]
  }

  if (direction === 'forward') return arrow(1, 0)
  if (direction === 'reverse') return arrow(-1, 0)
  return [...arrow(1, -len * 0.6), ...arrow(-1, len * 0.6)]
}

export const DIRECTION_LABEL: Record<TripwireDirection, string> = {
  both: 'Both directions',
  forward: 'A → B right side only',
  reverse: 'A → B left side only',
}
