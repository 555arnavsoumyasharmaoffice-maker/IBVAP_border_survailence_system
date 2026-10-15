import { useState } from 'react'
import { CheckCheck, ClipboardCheck, Loader2, Send, Timer } from 'lucide-react'
import type { Alert } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { fmtDuration, fmtTime } from '@/lib/format'
import { PLAYBOOKS, hasPlaybook, qrtMessage } from '@/lib/playbooks'
import { useT } from '@/i18n'
import { Field, Modal, useNow } from './ui'

/** Live "time since alert" until acknowledged, then the recorded response time (NEW -> ACKNOWLEDGED). */
export function ResponseTimer({ alert, large = false }: { alert: Alert; large?: boolean }) {
  const now = useNow(1000)
  const ack = alert.history.find((h) => h.status === 'ACKNOWLEDGED')
  const size = large ? 'text-2xl' : 'text-sm'
  if (ack) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-low">
        <CheckCheck size={14} />
        <span>Response time</span>
        <span className={`font-mono font-bold ${size}`}>{fmtDuration((Date.parse(ack.at) - Date.parse(alert.timestamp)) / 1000)}</span>
      </div>
    )
  }
  if (alert.status !== 'NEW') return null
  const sec = Math.max(0, (now - Date.parse(alert.timestamp)) / 1000)
  return (
    <div className={`flex items-center gap-1.5 text-xs ${sec > 60 ? 'text-crit' : 'text-med'}`}>
      <Timer size={14} className="animate-pulse" />
      <span>Unacknowledged for</span>
      <span className={`font-mono font-bold ${size}`}>{fmtDuration(sec)}</span>
    </div>
  )
}

/** SOP checklist for the alert type. Each tick is saved to the alert history through the service. */
export function Playbook({ alert }: { alert: Alert }) {
  const user = useAuth((s) => s.user)
  const [busy, setBusy] = useState('')
  if (!hasPlaybook(alert)) return null
  const done = alert.playbookDone ?? []
  const steps = PLAYBOOKS[alert.type]
  const toggle = async (id: string, label: string) => {
    setBusy(id)
    try {
      useData.getState().ingest(await service.setPlaybookStep(alert.id, id, label, !done.includes(id), user?.name ?? 'Operator'))
    } catch {
      /* backend unreachable: the tick is not saved and the box stays unchanged */
    } finally {
      setBusy('')
    }
  }
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <ClipboardCheck size={13} className="text-accent" />
        <span className="panel-title">Response playbook</span>
        <span className="ml-auto font-mono text-[10px] text-ink-mute">
          {done.length}/{steps.length}
        </span>
      </div>
      <ol className="space-y-1">
        {steps.map((s, i) => (
          <li key={s.id}>
            <label className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-xs ${done.includes(s.id) ? 'border-low/40 bg-low/10 text-ink-dim line-through' : 'border-base-700 bg-base-850'}`}>
              <input type="checkbox" checked={done.includes(s.id)} disabled={busy === s.id} onChange={() => void toggle(s.id, s.label)} />
              <span className="font-mono text-[10px] text-ink-mute">{i + 1}</span>
              {s.label}
            </label>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Sends (mock) or requests (real backend) a message to the Quick Reaction Team over secure SMS / radio relay. */
export function NotifyQrt({ alert, className = 'btn' }: { alert: Alert; className?: string }) {
  const t = useT()
  const user = useAuth((s) => s.user)
  const camera = useData((s) => s.cameras.find((c) => c.id === alert.cameraId))
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<'SMS' | 'WHATSAPP'>('WHATSAPP')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')

  const show = () => {
    setMessage(qrtMessage(alert, camera, t(`type.${alert.type}`)))
    setState('idle')
    setOpen(true)
  }
  const send = async () => {
    setState('sending')
    try {
      useData.getState().ingest(await service.notifyQrt(alert.id, channel, message, user?.name ?? 'Operator'))
      setState('sent')
    } catch {
      setState('failed')
    }
  }

  return (
    <>
      <button className={className} onClick={show}>
        <Send size={13} /> Notify QRT
        {alert.qrtNotifiedAt && <span className="font-mono text-[10px] text-low">sent {fmtTime(alert.qrtNotifiedAt)}</span>}
      </button>
      {open && (
        <Modal title="Notify Quick Reaction Team" onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['WHATSAPP', 'SMS'] as const).map((c) => (
                <button key={c} className={`btn flex-1 ${channel === c ? 'btn-primary' : ''}`} disabled={state === 'sent'} onClick={() => setChannel(c)}>
                  {t(c === 'SMS' ? 'qrt.sms' : 'qrt.radio')}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-ink-mute">{t('qrt.channels')}</div>
            <Field label="Message preview (editable)">
              <textarea className="field h-28 resize-none normal-case" value={message} disabled={state === 'sent'} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <div className="rounded-lg rounded-bl-none border border-low/30 bg-low/10 p-2.5 text-xs">
              <div className="mb-1 text-[10px] font-semibold text-low">To: QRT - {camera?.locationName ?? 'sector'}</div>
              <div className="whitespace-pre-wrap">{message}</div>
              <div className="mt-1 flex items-center justify-end gap-1 font-mono text-[10px] text-ink-mute">
                {state === 'sent' ? (
                  <>
                    {fmtTime(Date.now())} <CheckCheck size={12} className="text-accent" /> <span className="text-low">Sent</span>
                  </>
                ) : state === 'failed' ? (
                  <span className="text-crit">Not sent: backend not reachable</span>
                ) : (
                  'Not sent yet'
                )}
              </div>
            </div>
            {service.mode === 'mock' && <div className="text-[10px] text-ink-mute">Mock mode: no real message leaves this computer. With the real backend this calls POST /alerts/{'{id}'}/notify-qrt.</div>}
            {state === 'sent' ? (
              <button className="btn w-full" onClick={() => setOpen(false)}>
                Close
              </button>
            ) : (
              <button className="btn btn-danger w-full py-2" disabled={state === 'sending' || !message.trim()} onClick={() => void send()}>
                {state === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send to QRT
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  )
}
