import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, Printer, Radio, Shield, ShieldAlert, X, Zap } from 'lucide-react'
import { service } from '@/services'

interface SitrepData {
  classification: string
  sector: string
  reportId: string
  generatedAt: string
  defconLevel: number
  readinessStatus: string
  statistics: {
    totalAlerts: number
    criticalAlerts: number
    highAlerts: number
    infiltrationsDetected: number
    droneIncursions: number
    droneNeutralized: number
    vehiclesScanned: number
    blacklistedVehiclesIntercepted: number
    facesAnalyzed: number
    activeWatchlistProfiles: number
    operationalCameras: number
    sensorHealthPct: number
  }
  recentIncidents: Array<{
    id: string
    timestamp: string
    cameraId: string
    type: string
    severity: string
    status: string
  }>
  countermeasureStatus: {
    cuasJammer: string
    frequencyCoverage: string
    virtualTripwires: number
    nightVisionCapability: string
  }
  commandingOfficer: string
}

export function SitrepModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SitrepData | null>(null)

  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      service.getSitrep()
        .then((res) => setData(res))
        .catch((err) => console.error('Failed to load SITREP:', err))
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-lg border border-red-500/40 bg-[#0b0f17] text-ink shadow-2xl shadow-red-950/50">
        
        {/* Military Classification Header */}
        <div className="flex items-center justify-between border-b border-red-500/30 bg-red-950/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-red-400" />
            <span className="font-mono text-xs font-black tracking-widest text-red-300 uppercase">
              {data?.classification || 'TOP SECRET // NOFORN // BORDER COMMAND'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded border border-base-600 bg-base-800 px-2 py-1 text-xs font-semibold hover:bg-base-700 hover:text-white"
            >
              <Printer size={13} />
              Print / PDF
            </button>
            <button
              onClick={onClose}
              className="rounded p-1 text-ink-mute hover:bg-base-800 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 font-mono text-xs">
          {loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Loader2 size={32} className="animate-spin text-accent" />
              <div className="text-sm tracking-wider text-ink-dim">COMPILING BORDER DEFENSE SITREP...</div>
            </div>
          ) : data ? (
            <div className="space-y-5">
              
              {/* Document Title Strip */}
              <div className="border-b border-base-800 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-black tracking-wider text-white">
                      OPERATIONAL DEFENSE SITUATION REPORT (SITREP)
                    </h2>
                    <div className="text-[11px] text-accent">
                      {data.sector}
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-ink-mute">
                    <div>REPORT ID: <span className="font-bold text-white">{data.reportId}</span></div>
                    <div>TIMESTAMP: {new Date(data.generatedAt).toLocaleString('en-GB')}</div>
                  </div>
                </div>
              </div>

              {/* Defcon & Status Banner */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex items-center gap-3 rounded border border-amber-500/30 bg-amber-950/20 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-amber-500/20 text-lg font-black text-amber-400">
                    D{data.defconLevel}
                  </div>
                  <div>
                    <div className="text-[10px] text-ink-mute uppercase tracking-wider">DEFCON POSTURE</div>
                    <div className="text-xs font-bold text-amber-300">STAGE {data.defconLevel} - ELEVATED PERIMETER ALERT</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 rounded border border-emerald-500/30 bg-emerald-950/20 p-3">
                  <CheckCircle2 size={24} className="text-emerald-400" />
                  <div>
                    <div className="text-[10px] text-ink-mute uppercase tracking-wider">SYSTEM READINESS</div>
                    <div className="text-xs font-bold text-emerald-300">{data.readinessStatus}</div>
                  </div>
                </div>
              </div>

              {/* Tactical Statistics Grid */}
              <div>
                <div className="mb-2 text-[10px] font-bold tracking-wider text-ink-dim uppercase">
                  24-Hour Border Incident & Intercept Analytics
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded border border-base-800 bg-base-900/60 p-2.5">
                    <div className="text-[10px] text-ink-mute">TOTAL ALERTS</div>
                    <div className="text-lg font-black text-white">{data.statistics.totalAlerts}</div>
                    <div className="text-[9px] text-red-400 font-bold">{data.statistics.criticalAlerts} CRITICAL</div>
                  </div>

                  <div className="rounded border border-base-800 bg-base-900/60 p-2.5">
                    <div className="text-[10px] text-ink-mute">INTRUDER BREACHES</div>
                    <div className="text-lg font-black text-white">{data.statistics.infiltrationsDetected}</div>
                    <div className="text-[9px] text-emerald-400 font-bold">100% INTERCEPTED</div>
                  </div>

                  <div className="rounded border border-base-800 bg-base-900/60 p-2.5">
                    <div className="text-[10px] text-ink-mute">UAV INCURSIONS</div>
                    <div className="text-lg font-black text-white">{data.statistics.droneIncursions}</div>
                    <div className="text-[9px] text-amber-400 font-bold">C-UAS ACTIVE</div>
                  </div>

                  <div className="rounded border border-base-800 bg-base-900/60 p-2.5">
                    <div className="text-[10px] text-ink-mute">ANPR VEHICLES SCANNED</div>
                    <div className="text-lg font-black text-white">{data.statistics.vehiclesScanned}</div>
                    <div className="text-[9px] text-red-400 font-bold">{data.statistics.blacklistedVehiclesIntercepted} BLACKLISTED</div>
                  </div>
                </div>
              </div>

              {/* Counter-Measures & Electronic Warfare Status */}
              <div className="rounded border border-cyan-500/30 bg-cyan-950/20 p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-cyan-300 uppercase">
                  <Radio size={14} /> Counter-UAS Electronic Warfare & Sensor Net
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-[11px]">
                  <div>
                    <span className="text-ink-mute">DIRCM RF Jammer:</span>{' '}
                    <span className="font-bold text-emerald-400">{data.countermeasureStatus.cuasJammer}</span>
                  </div>
                  <div>
                    <span className="text-ink-mute">RF Coverage:</span>{' '}
                    <span className="text-white">{data.countermeasureStatus.frequencyCoverage}</span>
                  </div>
                  <div>
                    <span className="text-ink-mute">Virtual Tripwires:</span>{' '}
                    <span className="font-bold text-amber-400">{data.countermeasureStatus.virtualTripwires} ACTIVE</span>
                  </div>
                </div>
              </div>

              {/* Recent Incidents Table */}
              {data.recentIncidents.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-wider text-ink-dim uppercase">
                    Recent Critical Security Intercepts
                  </div>
                  <div className="overflow-x-auto rounded border border-base-800">
                    <table className="w-full text-left text-[11px]">
                      <thead className="border-b border-base-800 bg-base-900 text-[10px] text-ink-mute uppercase">
                        <tr>
                          <th className="p-2">Incident ID</th>
                          <th className="p-2">Camera</th>
                          <th className="p-2">Classification</th>
                          <th className="p-2">Severity</th>
                          <th className="p-2">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-base-800/60 bg-base-950/40">
                        {data.recentIncidents.map((inc) => (
                          <tr key={inc.id} className="hover:bg-base-900/50">
                            <td className="p-2 font-mono font-bold text-accent">{inc.id}</td>
                            <td className="p-2 text-ink-dim">{inc.cameraId}</td>
                            <td className="p-2 text-white">{inc.type.replace(/_/g, ' ')}</td>
                            <td className="p-2">
                              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                                inc.severity === 'CRITICAL' ? 'bg-red-950 text-red-400 border border-red-500/50' : 'bg-base-800 text-ink-dim'
                              }`}>
                                {inc.severity}
                              </span>
                            </td>
                            <td className="p-2 text-emerald-400 font-semibold">{inc.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Commander Sign-off */}
              <div className="flex flex-wrap items-center justify-between border-t border-base-800 pt-3 text-[11px]">
                <div>
                  <div className="text-[10px] text-ink-mute">COMMAND AUTHORITY:</div>
                  <div className="font-bold text-white">{data.commandingOfficer}</div>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <Shield size={14} />
                  <span>AUTHENTICATED BY IBVAP SECURE AI GATEWAY</span>
                </div>
              </div>

            </div>
          ) : (
            <div className="p-8 text-center text-red-400">
              Failed to compile SITREP. Verify backend database connectivity.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
