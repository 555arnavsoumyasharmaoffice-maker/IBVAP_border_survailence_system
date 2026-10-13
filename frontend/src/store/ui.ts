import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Severity } from '@/types'

export type CameraLayout = 1 | 2 | 3 | 4

interface DemoState {
  running: boolean
  caption: string
  step: number
  total: number
}

interface UiState {
  lang: 'en' | 'hi'
  muted: boolean
  soundEnabled: boolean
  popupSeverities: Severity[]
  cameraLayout: CameraLayout
  shortcutsOpen: boolean
  /** Alert targeted by the "A" shortcut (hovered card or open detail page). */
  focusedAlertId: string | null
  demo: DemoState
  /** Bumped to ask the demo runner (mounted in the layout) to start/stop. */
  demoRequest: number
  set: (patch: Partial<UiState>) => void
  toggleMute: () => void
  toggleLang: () => void
  toggleDemo: () => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      lang: 'en',
      muted: false,
      soundEnabled: true,
      popupSeverities: ['CRITICAL', 'HIGH'],
      cameraLayout: 2,
      shortcutsOpen: false,
      focusedAlertId: null,
      demo: { running: false, caption: '', step: 0, total: 0 },
      demoRequest: 0,
      set: (patch) => set(patch),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      toggleLang: () => set((s) => ({ lang: s.lang === 'en' ? 'hi' : 'en' })),
      toggleDemo: () => set((s) => ({ demoRequest: s.demoRequest + 1 })),
    }),
    {
      name: 'ibvap.ui',
      partialize: (s) => ({
        lang: s.lang, muted: s.muted, soundEnabled: s.soundEnabled,
        popupSeverities: s.popupSeverities, cameraLayout: s.cameraLayout,
      }),
    },
  ),
)
