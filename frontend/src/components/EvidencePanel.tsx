import { useEffect, useState } from 'react'
import { FileArchive, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Alert, EvidenceRecord, Incident } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth } from '@/store/auth'
import { audit } from '@/lib/audit'
import { buildEvidencePackage, fetchBytes, sha256Hex } from '@/lib/evidence'
import { downloadFile } from '@/lib/format'
import { useT } from '@/i18n'

type Check = { state: 'checking' } | { state: 'ok' | 'mismatch'; record: EvidenceRecord; actual: string } | { state: 'error'; message: string }

/** Runs the export end to end. Also used by Demo Mode. */
export async function exportEvidence(caseRef: string, alerts: Alert[]) {
  const { cameras, settings } = useData.getState()
  const user = useAuth.getState().user
  const records: Record<string, EvidenceRecord | undefined> = {}
  await Promise.all(alerts.map(async (a) => (records[a.id] = await service.getEvidenceRecord(a.id).catch(() => undefined))))
  const pkg = await buildEvidencePackage({ caseRef, alerts, cameras, user, records, blurFaces: settings?.blurFacesInExports ?? false, mode: service.mode })
  downloadFile(pkg.fileName, pkg.blob)
  for (const a of alerts) {
    useData.getState().ingest(await service.logEvidenceExport(a.id, user?.name ?? 'Operator', pkg.packageSha256, pkg.files.filter((f) => f.path.startsWith(a.id)).map((f) => f.path)))
  }
  audit('EVIDENCE', 'Evidence exported', caseRef, `${alerts.length} alert(s), ${pkg.files.length} files, package ${pkg.packageSha256.slice(0, 16)}...`)
  return pkg
}

export function EvidencePanel({ alert, incident }: { alert: Alert; incident?: Incident }) {
  const t = useT()
  const [check, setCheck] = useState<Check>({ state: 'checking' })
  const [busy, setBusy] = useState<'alert' | 'incident' | null>(null)
  const [result, setResult] = useState('')

  // Integrity: hash the snapshot we can download now and compare with the hash recorded at capture time.
  useEffect(() => {
    let live = true
    setCheck({ state: 'checking' })
    Promise.all([service.getEvidenceRecord(alert.id), fetchBytes(alert.snapshotUrl).then((f) => sha256Hex(f.bytes))]).then(
      ([record, actual]) => live && setCheck({ state: record.snapshotSha256 === actual ? 'ok' : 'mismatch', record, actual }),
      (e: Error) => live && setCheck({ state: 'error', message: e.message }),
    )
    return () => {
      live = false
    }
  }, [alert.id, alert.snapshotUrl])

  const run = async (scope: 'alert' | 'incident') => {
    setBusy(scope)
    setResult('')
    try {
      const pkg = await exportEvidence(scope === 'incident' && incident ? incident.id : alert.id, scope === 'incident' && incident ? incident.alerts : [alert])
      setResult(`Saved ${pkg.fileName} (${pkg.files.length} hashed files)`)
    } catch (e) {
      setResult(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusy(null)
    }
  }
  const lastExport = [...alert.history].reverse().find((h) => h.kind === 'evidence')

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="panel-title">Evidence</span>
        {check.state === 'ok' && (
          <span className="flex items-center gap-1 rounded border border-low/50 bg-low/15 px-1.5 py-px text-[10px] font-semibold text-low uppercase">
            <ShieldCheck size={11} /> {t('ev.hashComputed')}
          </span>
        )}
        {check.state === 'mismatch' && (
          <span className="flex items-center gap-1 rounded border border-crit/50 bg-crit/15 px-1.5 py-px text-[10px] font-semibold text-crit uppercase">
            <ShieldAlert size={11} /> Hash mismatch
          </span>
        )}
        {check.state === 'checking' && <Loader2 size={12} className="animate-spin text-ink-mute" />}
      </div>
      {check.state === 'ok' || check.state === 'mismatch' ? (
        <dl className="space-y-1 text-[11px]">
          <dt className="text-ink-mute">Snapshot SHA-256 (recorded at capture)</dt>
          <dd className="font-mono break-all">{check.record.snapshotSha256}</dd>
          {check.state === 'mismatch' && (
            <>
              <dt className="text-crit">Current file hash (does not match)</dt>
              <dd className="font-mono break-all text-crit">{check.actual}</dd>
            </>
          )}
        </dl>
      ) : check.state === 'error' ? (
        <div className="text-[11px] text-med">Integrity check unavailable: {check.message}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="btn" disabled={busy !== null} onClick={() => void run('alert')}>
          {busy === 'alert' ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />} Export evidence (ZIP)
        </button>
        {incident && incident.alerts.length > 1 && (
          <button className="btn" disabled={busy !== null} onClick={() => void run('incident')}>
            {busy === 'incident' ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />} Export incident ({incident.alerts.length} alerts)
          </button>
        )}
      </div>
      <div className="mt-1.5 text-[10px] text-ink-mute">
        ZIP contains snapshot, clip (if any), metadata.json, SHA256SUMS.txt and chain_of_custody.json (who exported, when).
      </div>
      {result && <div className={`mt-1 text-[11px] ${result.startsWith('Export failed') ? 'text-crit' : 'text-low'}`}>{result}</div>}
      {lastExport && !result && <div className="mt-1 text-[11px] text-ink-dim">Last exported by {lastExport.by}.</div>}
    </div>
  )
}
