import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Role, User } from '@/types'
import { service } from '@/services'

interface AuthState {
  user: User | null
  login: (username: string, role: Role) => Promise<void>
  logout: (reason?: string) => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      login: async (username, role) => {
        const user = await service.login(username, role)
        set({ user })
        void service.logAudit({ user: user.name, role: user.role, category: 'AUTH', action: 'Signed in', target: 'Command Center', details: '' }).catch(() => {})
      },
      logout: (reason = '') => {
        const user = useAuth.getState().user
        if (user) void service.logAudit({ user: user.name, role: user.role, category: 'AUTH', action: 'Signed out', target: 'Command Center', details: reason }).catch(() => {})
        set({ user: null })
      },
    }),
    { name: 'ibvap.auth', storage: createJSONStorage(() => sessionStorage) },
  ),
)

/**
 * Role rules:
 *  - everyone (incl. OPERATOR): acknowledge, escalate, mark false alarm, review matches
 *  - COMMANDER / ADMIN only:    resolve alerts, edit zones, watchlists, blacklist, settings
 */
export type Permission = 'resolve' | 'manage'

export const can = (role: Role | undefined, _perm: Permission) => role === 'COMMANDER' || role === 'ADMIN'

export function useCan(perm: Permission) {
  return useAuth((s) => can(s.user?.role, perm))
}
