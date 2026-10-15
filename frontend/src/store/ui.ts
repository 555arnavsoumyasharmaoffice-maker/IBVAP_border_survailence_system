import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Max 3x3: more than 9 feeds per operator hurts detection (CCTV operator studies). */
export type CameraLayout = 1 | 2 | 3

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
  cameraLayout: CameraLayout
  shortcutsOpen: boolean
  /** Alert targeted by the "A" shortcut: clicked in a list or open on the detail page (never mouse hover). */
  selectedAlertId: string | null
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
      cameraLayout: 2,
      shortcutsOpen: false,
      selectedAlertId: null,
      demo: { running: false, caption: '', step: 0, total: 0 },
      demoRequest: 0,
      set: (patch) => set(patch),
      toggleMute: () => set((s) => ({ muted: !s.muted })),
      toggleLang: () => set((s) => ({ lang: s.lang === 'en' ? 'hi' : 'en' })),
      toggleDemo: () => set((s) => ({ demoRequest: s.demoRequest + 1 })),
    }),
    {
      name: 'ibvap.ui',
      version: 1,
      // v0 allowed a 4x4 layout and per-severity popups; both were removed.
      migrate: (old) => {
        const o = (old ?? {}) as { cameraLayout?: number }
        return { ...o, cameraLayout: o.cameraLayout && o.cameraLayout <= 3 ? o.cameraLayout : 2 } as never
      },
      partialize: (s) => ({
        lang: s.lang, muted: s.muted, soundEnabled: s.soundEnabled,
        cameraLayout: s.cameraLayout,
      }),
    },
  ),
)
