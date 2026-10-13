import type { AuditCategory } from '@/types'
import { service } from '@/services'
import { useAuth } from '@/store/auth'

/** Record an operator action in the audit log (fire-and-forget; never blocks the UI). */
export function audit(category: AuditCategory, action: string, target: string, details = '') {
  const user = useAuth.getState().user
  if (!user) return
  void service.logAudit({ user: user.name, role: user.role, category, action, target, details }).catch(() => {})
}
