import { useEffect, useRef, useState } from 'react'
import { Radio, Volume2, VolumeX, ShieldCheck, Zap } from 'lucide-react'
import { useData } from '@/store/data'

export function TacticalDatalink() {
  const alerts = useData((s) => s.alerts)
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    return localStorage.getItem('ibvap.voice_alerts') === 'true'
  })
  const lastSpokenAlertRef = useRef<string | null>(null)

  const toggleVoice = () => {
    setVoiceEnabled((prev) => {
      const next = !prev
      localStorage.setItem('ibvap.voice_alerts', String(next))
      if (next) {
        speak('Tactical voice dispatch datalink online.')
      }
      return next
    })
  }

  const speak = (msg: string) => {
    if (!('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(msg)
      u.rate = 1.05
      u.pitch = 0.95
      u.volume = 0.85
      const voices = window.speechSynthesis.getVoices()
      const eng =
        voices.find((v) => v.lang.startsWith('en') && v.name.includes('Google')) ||
        voices.find((v) => v.lang.startsWith('en'))
      if (eng) u.voice = eng
      window.speechSynthesis.speak(u)
    } catch {
      // voice synthesis blocked or unsupported
    }
  }

  // Voice announcement on new critical alert
  useEffect(() => {
    if (!voiceEnabled || !alerts.length) return
    const newest = alerts[0]
    if (newest.id !== lastSpokenAlertRef.current && newest.severity === 'CRITICAL' && newest.status === 'NEW') {
      lastSpokenAlertRef.current = newest.id
      speak(`Tactical alert. Critical detection at ${newest.cameraId}. Immediate review required.`)
    }
  }, [alerts, voiceEnabled])

  const commsMessages = [
    '[SEC-DATALINK // BSF 142 BN] QRT-1 INTERCEPT PATROL ASSIGNED TO KM 142.4 (ETA 3 MIN)',
    '[C-UAS EW SHIELD] BOP SUNDAR DIRECTIONAL RF JAMMER ENGAGED (2.45GHz FREQ-HOP LOCKED)',
    '[SEISMIC UGS NETWORK] ZERO LINE SENSOR-02 CONFIRMED BIPEDAL STRIDE FREQUENCY 1.6 Hz',
    '[ANPR CHECKPOST] BARRIER-02 HIGH-SPEED REAL OCR RECOGNITION ACTIVE [CONF 98%]',
    '[AIR RECON // UAV-01] HERON MK-II AUTONOMOUS PATROL COMMENCING SWEEP SECTOR-BRAVO',
    '[ENC-COMMS] VHF TACTICAL CHANNEL-04 SECURE SPREAD-SPECTRUM LINK VERIFIED [AES-256]',
  ]

  return (
    <div className="panel flex shrink-0 items-center justify-between gap-2 overflow-hidden px-2.5 py-1 text-xs bg-base-950/90 border-base-700">
      <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-semibold text-accent">
        <Radio size={13} className="animate-pulse text-accent" />
        <span className="tracking-wider">TAC-DATALINK</span>
        <span className="flex items-center gap-1 rounded bg-emerald-950/80 px-1 py-0.2 text-[9px] text-emerald-400 border border-emerald-500/30">
          <ShieldCheck size={10} /> AES-256
        </span>
      </div>

      {/* Marquee ticker */}
      <div className="relative min-w-0 flex-1 overflow-hidden h-5 flex items-center">
        <div className="datalink-ticker font-mono text-[11px] text-ink-dim hover:text-white transition-colors cursor-default">
          {commsMessages.join('  ·—·  ')}
        </div>
      </div>

      {/* Tactical Controls */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={toggleVoice}
          title={voiceEnabled ? 'Mute automated voice dispatch' : 'Enable automated tactical voice announcements'}
          className={`btn btn-sm h-6 px-1.5 py-0 font-mono text-[10px] ${
            voiceEnabled
              ? 'border-accent bg-accent/20 text-accent font-semibold'
              : 'text-ink-mute hover:text-ink'
          }`}
        >
          {voiceEnabled ? <Volume2 size={11} className="text-accent" /> : <VolumeX size={11} />}
          <span>{voiceEnabled ? 'VOICE ON' : 'MUTE'}</span>
        </button>

        <button
          onClick={() => speak('Tactical communication datalink test successful. All surveillance nodes operational.')}
          title="Test radio synthesized voice dispatch"
          className="btn btn-sm h-6 px-1.5 py-0 font-mono text-[10px] text-ink-mute hover:text-ink"
        >
          <Zap size={11} className="text-amber-400" /> Test Dispatch
        </button>
      </div>
    </div>
  )
}
