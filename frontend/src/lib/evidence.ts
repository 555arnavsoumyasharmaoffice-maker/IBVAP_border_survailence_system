import JSZip from 'jszip'
import type { Alert, Camera, EvidenceRecord, User } from '@/types'

// Evidence packaging: snapshot + clip + metadata, a SHA-256 for every file (Web Crypto API)
// and a chain-of-custody log, bundled into one ZIP in the browser.

export const cryptoAvailable = () => typeof crypto !== 'undefined' && !!crypto.subtle

export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  if (!cryptoAvailable()) throw new Error('SHA-256 needs a secure context: open the dashboard over HTTPS or on localhost.')
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const EXT: Record<string, string> = { 'image/svg+xml': 'svg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' }

export async function fetchBytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not download ${url.slice(0, 60)} (${res.status})`)
  const blob = await res.blob()
  const type = blob.type.split(';')[0]
  return { bytes: await blob.arrayBuffer(), ext: EXT[type] ?? 'bin' }
}

export interface EvidenceFile {
  path: string
  sha256: string
  bytes: number
}

export interface EvidencePackage {
  blob: Blob
  fileName: string
  files: EvidenceFile[]
  packageSha256: string
}

export async function buildEvidencePackage(opts: {
  caseRef: string
  alerts: Alert[]
  cameras: Camera[]
  user: User | null
  records: Record<string, EvidenceRecord | undefined>
  blurFaces: boolean
  mode: 'mock' | 'api'
}): Promise<EvidencePackage> {
  const zip = new JSZip()
  const files: EvidenceFile[] = []
  const exportedAt = new Date().toISOString()
  const add = async (path: string, data: ArrayBuffer | string) => {
    zip.file(path, data)
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength
    files.push({ path, sha256: await sha256Hex(data), bytes })
    return files[files.length - 1]
  }

  const integrity: { alertId: string; file: string; recordedSha256: string | null; exportedSha256: string; matches: boolean | null }[] = []
  for (const a of opts.alerts) {
    const snap = await fetchBytes(a.snapshotUrl)
    const snapFile = await add(`${a.id}/snapshot.${snap.ext}`, snap.bytes)
    const recorded = opts.records[a.id]?.snapshotSha256 ?? null
    integrity.push({ alertId: a.id, file: snapFile.path, recordedSha256: recorded, exportedSha256: snapFile.sha256, matches: recorded ? recorded === snapFile.sha256 : null })

    let clipPath: string | null = null
    if (a.clipUrl) {
      const clip = await fetchBytes(a.clipUrl)
      clipPath = (await add(`${a.id}/clip.${clip.ext}`, clip.bytes)).path
    }
    const camera = opts.cameras.find((c) => c.id === a.cameraId)
    const metadata = {
      alert: { ...a, snapshotUrl: snapFile.path, clipUrl: clipPath, details: { ...a.details, faceCropUrl: a.details.faceCropUrl ? '(not exported)' : undefined } },
      camera: camera && { id: camera.id, name: camera.name, locationName: camera.locationName, lat: camera.lat, lng: camera.lng },
    }
    await add(`${a.id}/metadata.json`, JSON.stringify(metadata, null, 2))
  }

  const custody = {
    caseRef: opts.caseRef,
    system: 'IBVAP Command Center v0.1',
    dataSource: opts.mode === 'mock' ? 'MOCK / SIMULATED DATA - not real evidence' : 'live backend',
    exportedBy: opts.user ? { name: opts.user.name, username: opts.user.username, role: opts.user.role } : null,
    exportedAt,
    alerts: opts.alerts.map((a) => a.id),
    hashAlgorithm: 'SHA-256',
    files,
    integrityCheck: integrity,
    faceBlurRequested: opts.blurFaces,
    faceBlurApplied: false,
    custodyLog: [
      ...opts.alerts.map((a) => ({ at: a.timestamp, event: 'Captured by AI engine', ref: a.id })),
      { at: exportedAt, event: `Exported by ${opts.user?.name ?? 'unknown'} (${opts.user?.role ?? '-'})`, ref: opts.caseRef },
    ],
  }
  await add('chain_of_custody.json', JSON.stringify(custody, null, 2))

  // sha256sum-compatible manifest: verify with `sha256sum -c SHA256SUMS.txt`
  const sums = files.map((f) => `${f.sha256}  ${f.path}`).join('\n') + '\n'
  zip.file('SHA256SUMS.txt', sums)
  zip.file(
    'README.txt',
    [
      `IBVAP evidence package ${opts.caseRef}`,
      `Exported ${exportedAt} by ${opts.user?.name ?? 'unknown'}`,
      '',
      'Verify integrity:  sha256sum -c SHA256SUMS.txt   (Windows: certutil -hashfile <file> SHA256)',
      'chain_of_custody.json lists every file, its hash, and who exported the package.',
      opts.mode === 'mock' ? '\nNOTE: generated in MOCK mode from simulated data.' : '',
    ].join('\n'),
  )

  const blob = await zip.generateAsync({ type: 'blob' })
  return { blob, fileName: `evidence_${opts.caseRef}_${exportedAt.slice(0, 19).replace(/[:T]/g, '-')}.zip`, files, packageSha256: await sha256Hex(sums) }
}
