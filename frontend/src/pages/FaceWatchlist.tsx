import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Info, Lock, Plus, ScanFace, Trash2, Upload, X } from 'lucide-react'
import type { FaceMatch, Level, PersonCategory, ReviewState, WatchlistPerson } from '@/types'
import { service } from '@/services'
import { useData } from '@/store/data'
import { useAuth, useCan } from '@/store/auth'
import { fmtDate, fmtDateTime, pct } from '@/lib/format'
import { audit } from '@/lib/audit'
import { useT } from '@/i18n'
import { Page } from '@/components/layout/Layout'
import { Chip, EmptyState, ErrorState, Field, Modal, PageHeader, Skeleton, Tabs } from '@/components/ui'

const CATEGORY: Record<PersonCategory, { label: string; style: string }> = {
  WANTED: { label: 'Wanted', style: 'border-crit/50 bg-crit/15 text-crit' },
  SUSPECT: { label: 'Suspect', style: 'border-high/50 bg-high/15 text-high' },
  MISSING: { label: 'Missing person', style: 'border-accent/50 bg-accent/15 text-accent' },
  AUTHORISED: { label: 'Authorised staff', style: 'border-low/50 bg-low/15 text-low' },
}
const RISK: Record<Level, string> = { HIGH: 'text-crit', MEDIUM: 'text-med', LOW: 'text-low' }
const REVIEW: Record<ReviewState, string> = {
  PENDING: 'border-med/50 bg-med/15 text-med',
  CONFIRMED: 'border-crit/50 bg-crit/15 text-crit',
  REJECTED: 'border-base-600 bg-base-800 text-ink-mute',
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

function AddPersonModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<PersonCategory>('SUSPECT')
  const [riskLevel, setRiskLevel] = useState<Level>('MEDIUM')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/'))
    e.target.value = ''
    const urls = await Promise.all(files.map(readAsDataUrl))
    setPhotos((p) => [...p, ...urls].slice(0, 6))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await service.addWatchlistPerson({ name: name.trim(), category, riskLevel, notes, photos })
      audit('WATCHLIST', 'Person added', name.trim(), `category ${category}, risk ${riskLevel}, ${photos.length} photo(s)`)
      onAdded()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add person to watchlist" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name / ID">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Subject W-045 or full name" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value as PersonCategory)}>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Risk level">
            <select className="field" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as Level)}>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Case reference, description..." />
        </Field>
        <div>
          <div className="mb-1 text-[11px] font-medium tracking-wide text-ink-mute uppercase">Face photos ({photos.length}/6)</div>
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                <img src={p} alt={`Photo ${i + 1}`} className="h-20 w-16 rounded border border-base-600 object-cover" />
                <button type="button" aria-label="Remove photo" className="absolute -top-1.5 -right-1.5 rounded-full bg-crit p-0.5 text-white" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>
                  <X size={10} />
                </button>
              </div>
            ))}
            {photos.length < 6 && (
              <label className="flex h-20 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded border border-dashed border-base-600 text-[10px] text-ink-mute hover:border-accent hover:text-accent">
                <Upload size={14} /> Upload
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e)} />
              </label>
            )}
          </div>
          <div className="mt-1 text-[10px] text-ink-mute">Clear, front-facing photos improve recognition. Several angles are better than one.</div>
        </div>
        <button className="btn btn-primary w-full" type="submit" disabled={busy || !name.trim() || !photos.length}>
          <Plus size={13} /> Add to watchlist
        </button>
      </form>
    </Modal>
  )
}

function PersonsTab({ persons, reload }: { persons: WatchlistPerson[]; reload: () => void }) {
  const canManage = useCan('manage')
  if (!persons.length) return <div className="panel"><EmptyState title="Watchlist is empty" hint="Add wanted, suspect or missing persons with at least one face photo." icon={ScanFace} /></div>
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {persons.map((p) => (
        <div key={p.id} className="panel overflow-hidden">
          <div className="flex gap-1 bg-base-850 p-2">
            <img src={p.photos[0]} alt={p.name} className="h-32 w-24 rounded border border-base-600 object-cover" />
            <div className="flex flex-col gap-1">
              {p.photos.slice(1, 4).map((ph, i) => (
                <img key={i} src={ph} alt="" className="h-10 w-8 rounded-sm border border-base-700 object-cover" />
              ))}
            </div>
            <div className="ml-auto flex flex-col items-end justify-between">
              <Chip className={CATEGORY[p.category].style}>{CATEGORY[p.category].label}</Chip>
              <button className="text-ink-mute hover:text-crit disabled:opacity-30" disabled={!canManage} aria-label={`Remove ${p.name}`} title={canManage ? 'Remove' : 'Commander / Admin only'} onClick={() => void service.removeWatchlistPerson(p.id).then(() => { audit('WATCHLIST', 'Person removed', p.name); reload() })}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="p-2 text-xs">
            <div className="truncate font-semibold" title={p.name}>{p.name}</div>
            <div className="mt-0.5 flex justify-between text-[11px]">
              <span>
                Risk: <span className={`font-semibold ${RISK[p.riskLevel]}`}>{p.riskLevel}</span>
              </span>
              <span className="font-mono text-ink-mute">added {fmtDate(p.addedAt)}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[11px] text-ink-mute">{p.notes}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function MatchesTab({ matches, persons, onReview }: { matches: FaceMatch[]; persons: WatchlistPerson[]; onReview: (id: string, review: ReviewState) => void }) {
  const cameras = useData((s) => s.cameras)
  const byId = useMemo(() => Object.fromEntries(persons.map((p) => [p.id, p])), [persons])
  if (!matches.length) return <div className="panel"><EmptyState title="No face matches yet" hint="Matches against the watchlist appear here for human review." icon={ScanFace} /></div>
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {matches.map((m) => {
        const person = byId[m.personId]
        return (
          <div key={m.id} className="panel flex gap-3 p-3">
            <figure className="text-center">
              <img src={m.capturedUrl} alt="Captured face" className="h-28 w-[88px] rounded border border-base-600 object-cover" />
              <figcaption className="mt-0.5 text-[10px] text-ink-mute">Captured</figcaption>
            </figure>
            <div className="flex w-14 flex-col items-center justify-center">
              <div className={`font-mono text-xl font-bold ${m.similarity >= 0.85 ? 'text-crit' : 'text-med'}`}>{pct(m.similarity)}</div>
              <div className="text-[9px] text-ink-mute uppercase">similarity</div>
            </div>
            <figure className="text-center">
              {person ? <img src={person.photos[0]} alt="Watchlist" className="h-28 w-[88px] rounded border border-base-600 object-cover" /> : <div className="flex h-28 w-[88px] items-center justify-center rounded border border-base-700 text-[10px] text-ink-mute">removed</div>}
              <figcaption className="mt-0.5 text-[10px] text-ink-mute">Watchlist</figcaption>
            </figure>
            <div className="flex min-w-0 flex-1 flex-col text-xs">
              <div className="truncate font-semibold">{person?.name ?? m.personId}</div>
              <div className="truncate text-ink-dim">{cameras.find((c) => c.id === m.cameraId)?.name ?? m.cameraId}</div>
              <div className="font-mono text-[11px] text-ink-mute">{fmtDateTime(m.timestamp)}</div>
              <div className="mt-1 flex items-center gap-2">
                <Chip className={REVIEW[m.review]}>{m.review}</Chip>
                {m.reviewedBy && <span className="truncate text-[10px] text-ink-mute">by {m.reviewedBy}</span>}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                <button className="btn btn-sm btn-danger" disabled={m.review === 'CONFIRMED'} onClick={() => onReview(m.id, 'CONFIRMED')}>
                  <Check size={11} /> Confirm
                </button>
                <button className="btn btn-sm" disabled={m.review === 'REJECTED'} onClick={() => onReview(m.id, 'REJECTED')}>
                  <X size={11} /> Reject
                </button>
                {m.alertId && (
                  <Link to={`/alerts/${m.alertId}`} className="ml-auto text-[11px] text-accent hover:underline">
                    Alert →
                  </Link>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function FaceWatchlist() {
  const t = useT()
  const canManage = useCan('manage')
  const userName = useAuth((s) => s.user?.name ?? 'Operator')
  const faceAlerts = useData((s) => s.alerts.filter((a) => a.type === 'FACE_MATCH').length)
  const [tab, setTab] = useState<'persons' | 'matches'>('persons')
  const [persons, setPersons] = useState<WatchlistPerson[] | null>(null)
  const [matches, setMatches] = useState<FaceMatch[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    setError('')
    Promise.all([service.getWatchlist(), service.getFaceMatches()]).then(
      ([p, m]) => {
        setPersons(p)
        setMatches(m)
      },
      (e: Error) => setError(e.message),
    )
  }, [])
  // Reload whenever a new FACE_MATCH alert arrives so the Matches tab stays live.
  useEffect(load, [load, faceAlerts])

  const review = async (id: string, state: ReviewState) => {
    const updated = await service.reviewFaceMatch(id, state, userName)
    audit('WATCHLIST', `Match ${state.toLowerCase()}`, id, `similarity ${Math.round(updated.similarity * 100)}%`)
    setMatches((list) => list?.map((m) => (m.id === id ? updated : m)) ?? null)
  }
  const pending = matches?.filter((m) => m.review === 'PENDING').length

  return (
    <Page>
      <PageHeader title={t('nav.faces')} subtitle="Face detection and recognition against the watchlist, with human-in-the-loop review">
        <button className="btn btn-primary" disabled={!canManage} title={canManage ? undefined : 'Commander / Admin only'} onClick={() => setAdding(true)}>
          {canManage ? <Plus size={13} /> : <Lock size={13} />} Add person
        </button>
      </PageHeader>

      <div className="mb-3 flex items-center gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
        <Info size={15} className="shrink-0" />
        <span className="font-medium">Matches are decision support only; final identification by authorised personnel.</span>
      </div>

      <Tabs
        tabs={[
          { id: 'persons', label: 'Watchlist', count: persons?.length },
          { id: 'matches', label: 'Matches', count: pending },
        ]}
        value={tab}
        onChange={setTab}
      />

      {error ? (
        <div className="panel"><ErrorState message={error} onRetry={load} /></div>
      ) : !persons || !matches ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : tab === 'persons' ? (
        <PersonsTab persons={persons} reload={load} />
      ) : (
        <MatchesTab matches={matches} persons={persons} onReview={(id, s) => void review(id, s)} />
      )}

      {adding && <AddPersonModal onClose={() => setAdding(false)} onAdded={load} />}
    </Page>
  )
}
