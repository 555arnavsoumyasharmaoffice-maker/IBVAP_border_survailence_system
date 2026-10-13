import type { Severity } from '@/types'

// Alert beeps generated with the Web Audio API (no audio files, works offline).
let ctx: AudioContext | null = null

export function beep(severity: Severity) {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const critical = severity === 'CRITICAL'
    const count = critical ? 3 : 1
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * 0.2
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = critical ? 940 : 620
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.16)
    }
  } catch {
    /* audio not available (e.g. no user gesture yet) */
  }
}
