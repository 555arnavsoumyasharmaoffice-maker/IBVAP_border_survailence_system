import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Building2, Flag } from 'lucide-react'
import type { Bop, Camera, Sector } from '@/types'
import { useData } from '@/store/data'

export interface HierarchyGroup {
  sector: Sector
  bops: { bop: Bop; cameras: Camera[] }[]
}

/** Cameras grouped Sector -> BOP. Cameras with an unknown BOP go under "Unassigned". */
export function groupHierarchy(cameras: Camera[], sectors: Sector[], bops: Bop[]): HierarchyGroup[] {
  const groups: HierarchyGroup[] = sectors.map((sector) => ({
    sector,
    bops: bops.filter((b) => b.sectorId === sector.id).map((bop) => ({ bop, cameras: cameras.filter((c) => c.bopId === bop.id) })),
  }))
  const known = new Set(bops.map((b) => b.id))
  const orphans = cameras.filter((c) => !known.has(c.bopId))
  if (orphans.length) {
    groups.push({ sector: { id: '-', name: 'Unassigned' }, bops: [{ bop: { id: '-', name: 'No BOP', sectorId: '-', lat: 0, lng: 0 }, cameras: orphans }] })
  }
  return groups
}

export function useHierarchy(cameras: Camera[]) {
  const sectors = useData((s) => s.sectors)
  const bops = useData((s) => s.bops)
  return groupHierarchy(cameras, sectors, bops)
}

/**
 * Collapsible Sector -> BOP -> Camera tree. `renderCamera` draws each camera row (each page keeps its own row style);
 * `onSelectBop` / `selectedBop` let a page filter by BOP or sector ("sec:<id>").
 */
export function HierarchyTree({ cameras, renderCamera, selectedBop, onSelectBop, badge }: {
  cameras: Camera[]
  renderCamera: (c: Camera) => ReactNode
  selectedBop?: string | null
  onSelectBop?: (id: string | null) => void
  /** Optional count shown next to a BOP (e.g. open incidents). */
  badge?: (bop: Bop) => number
}) {
  const groups = useHierarchy(cameras)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const toggle = (id: string) => setClosed((c) => ({ ...c, [id]: !c[id] }))
  return (
    <div className="text-xs">
      {groups.map(({ sector, bops }) => (
        <div key={sector.id}>
          <div className={`flex items-center gap-1 border-b border-base-800 bg-base-850 px-2 py-1.5 ${selectedBop === `sec:${sector.id}` ? 'text-accent' : ''}`}>
            <button className="text-ink-mute hover:text-ink" aria-label={closed[sector.id] ? 'Expand' : 'Collapse'} onClick={() => toggle(sector.id)}>
              {closed[sector.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
            </button>
            <Flag size={12} className="shrink-0 text-accent" />
            <button className="min-w-0 flex-1 truncate text-left font-semibold tracking-wide uppercase" onClick={() => onSelectBop?.(selectedBop === `sec:${sector.id}` ? null : `sec:${sector.id}`)}>
              {sector.name}
            </button>
            <span className="font-mono text-[10px] text-ink-mute">{bops.reduce((n, b) => n + b.cameras.length, 0)}</span>
          </div>
          {!closed[sector.id] &&
            bops.map(({ bop, cameras: list }) => (
              <div key={bop.id}>
                <div className={`flex items-center gap-1 border-b border-base-800 py-1 pr-2 pl-5 ${selectedBop === bop.id ? 'bg-accent/10 text-accent' : ''}`}>
                  <button className="text-ink-mute hover:text-ink" aria-label={closed[bop.id] ? 'Expand' : 'Collapse'} onClick={() => toggle(bop.id)}>
                    {closed[bop.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  </button>
                  <Building2 size={12} className="shrink-0 text-ink-dim" />
                  <button className="min-w-0 flex-1 truncate text-left font-medium" onClick={() => onSelectBop?.(selectedBop === bop.id ? null : bop.id)}>
                    {bop.name}
                  </button>
                  {badge && badge(bop) > 0 && <span className="rounded bg-crit px-1 font-mono text-[10px] font-bold text-white">{badge(bop)}</span>}
                  <span className="font-mono text-[10px] text-ink-mute">{list.length}</span>
                </div>
                {!closed[bop.id] && <div className="pl-6">{list.map(renderCamera)}</div>}
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}
