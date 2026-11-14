import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Check, Eye, FileText, Filter, Info, Plus, ScanFace, Search, ShieldAlert, Trash2, Upload, X, Zap } from 'lucide-react'
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

/** High-Tech Subject Biometric Dossier Modal */
function DossierModal({
  person,
  onClose,
  onSimulate,
}: {
  person: WatchlistPerson
  onClose: () => void
  onSimulate: (personId: string) => void
}) {
  const photo = person.photos[0] || 'http://localhost:8000/media/faces/wl_tariq.jpg'
  const isWanted = person.category === 'WANTED'
  const isAuth = person.category === 'AUTHORISED'

  return (
    <Modal title={`BIOMETRIC DOSSIER // ${person.name.toUpperCase()}`} onClose={onClose}>
      <div className="space-y-3.5">
        <div className="flex flex-col sm:flex-row gap-3 bg-base-950/80 p-3 rounded border border-base-700">
          <div className="relative shrink-0 flex flex-col items-center">
            <img
              src={photo}
              alt={person.name}
              className="h-44 w-36 rounded border-2 border-accent/40 object-cover shadow-lg"
            />
            <div className="absolute top-1 left-1 rounded bg-black/80 px-1 font-mono text-[9px] text-accent">
              LANDMARK: 68-PT
            </div>
            <div className="mt-1 font-mono text-[9px] text-ink-mute">
              ID: {person.id.toUpperCase()}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold text-white tracking-wide">{person.name}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Chip className={CATEGORY[person.category].style}>{CATEGORY[person.category].label}</Chip>
                  <span className="font-mono text-xs">
                    Threat: <span className={`font-bold ${RISK[person.riskLevel]}`}>{person.riskLevel}</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded border border-base-700 bg-base-900/90 p-2 font-mono text-[10px] space-y-1">
              <div className="flex justify-between text-ink-mute">
                <span>FACENET-128D HASH:</span>
                <span className="text-accent font-semibold">SHA-256: e8f9...31c2</span>
              </div>
              <div className="flex justify-between text-ink-mute">
                <span>ENROLLED DATE:</span>
                <span className="text-ink">{fmtDate(person.addedAt)}</span>
              </div>
              <div className="flex justify-between text-ink-mute">
                <span>BIOMETRIC TEMPLATE:</span>
                <span className="text-emerald-400">VERIFIED [100% QUALITY]</span>
              </div>
            </div>

            <div className="text-xs">
              <div className="text-[10px] font-semibold text-ink-mute uppercase tracking-wider">
                Operational Briefing & Intelligence Notes:
              </div>
              <p className="mt-0.5 text-ink-dim leading-relaxed bg-base-850 p-2 rounded border border-base-750">
                {person.notes || 'No specific intelligence dossier notes logged.'}
              </p>
            </div>
          </div>
        </div>

        {/* Tactical Protocol Box */}
        <div
          className={`p-2.5 rounded border text-xs font-mono ${
            isWanted
              ? 'border-crit/60 bg-crit/10 text-rose-200'
              : isAuth
              ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200'
              : 'border-amber-500/60 bg-amber-950/40 text-amber-200'
          }`}
        >
          <div className="font-bold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert size={13} />
            {isWanted
              ? 'TACTICAL DIRECTIVE: ARMED INTERCEPT // PRIORITY-1'
              : isAuth
              ? 'TACTICAL DIRECTIVE: AUTHORISED ACCESS // PASS'
              : 'TACTICAL DIRECTIVE: DETENTION & INTERROGATION'}
          </div>
          <div className="text-[11px] mt-0.5 opacity-90">
            {isWanted
              ? 'Subject linked to hostile infiltration. Do not approach alone. Immediate QRT dispatch required upon camera lock.'
              : isAuth
              ? 'Authorised border defense command personnel. Log crossing event for audit.'
              : 'Subject of security interest. Verify identity credentials and escort to BOP control.'}
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-base-700">
          <button
            onClick={() => {
              onSimulate(person.id)
              onClose()
            }}
            className="btn btn-primary"
            title="Trigger simulated live camera detection of this subject"
          >
            <Zap size={13} className="text-amber-400" /> Simulate Live Camera Sighting
          </button>
          <button onClick={onClose} className="btn">
            Close Dossier
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Simulate Live Face Match Modal */
function SimulateModal({
  persons,
  onClose,
  onSimulated,
}: {
  persons: WatchlistPerson[]
  onClose: () => void
  onSimulated: () => void
}) {
  const cameras = useData((s) => s.cameras)
  const [selectedPerson, setSelectedPerson] = useState<string>(persons[0]?.id || '')
  const [selectedCamera, setSelectedCamera] = useState<string>(cameras[0]?.id || 'cam-01')
  const [similarity, setSimilarity] = useState<number>(0.95)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const handleTrigger = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      if (service.simulateFaceMatch) {
        await service.simulateFaceMatch({
          personId: selectedPerson,
          cameraId: selectedCamera,
          similarity,
        })
      }
      audit('WATCHLIST', 'Simulated face match triggered', selectedPerson, `camera ${selectedCamera}`)
      setMsg('Intercept Alert Triggered! Switching to Matches tab...')
      setTimeout(() => {
        onSimulated()
        onClose()
      }, 700)
    } catch {
      setMsg('Failed to trigger simulation')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="SIMULATE LIVE FACE RECOGNITION INTERCEPT" onClose={onClose}>
      <form onSubmit={handleTrigger} className="space-y-3 text-xs">
        <p className="text-ink-mute">
          Inject an automated biometric face recognition match into the live pipeline to test
          threat alerting, side-by-side verification, and QRT response.
        </p>

        <Field label="Target Suspect / Watchlist Subject">
          <select
            className="field w-full font-mono text-xs"
            value={selectedPerson}
            onChange={(e) => setSelectedPerson(e.target.value)}
          >
            {persons.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} [{p.category}] - Risk: {p.riskLevel}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Border Surveillance Camera">
          <select
            className="field w-full font-mono text-xs"
            value={selectedCamera}
            onChange={(e) => setSelectedCamera(e.target.value)}
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.locationName}) - {c.status.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Biometric Match Confidence: ${Math.round(similarity * 100)}%`}>
          <input
            type="range"
            min="0.80"
            max="0.99"
            step="0.01"
            value={similarity}
            onChange={(e) => setSimilarity(parseFloat(e.target.value))}
            className="w-full accent-accent cursor-pointer"
          />
          <div className="flex justify-between font-mono text-[9px] text-ink-mute mt-0.5">
            <span>80% (Probable)</span>
            <span className="text-amber-400 font-bold">95% (High Confidence)</span>
            <span className="text-crit font-bold">99% (Confirmed Lock)</span>
          </div>
        </Field>

        {msg && <div className="text-accent font-semibold">{msg}</div>}

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary flex-1" disabled={busy || !selectedPerson}>
            <Zap size={13} className="text-amber-400" /> Trigger Intercept Alert
          </button>
          <button type="button" onClick={onClose} className="btn">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

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
      // Default to high-tech placeholder if no custom file uploaded
      const finalPhotos = photos.length
        ? photos
        : ['http://localhost:8000/media/faces/wl_tariq.jpg']
      await service.addWatchlistPerson({ name: name.trim(), category, riskLevel, notes, photos: finalPhotos })
      audit('WATCHLIST', 'Person added', name.trim(), `category ${category}, risk ${riskLevel}, ${finalPhotos.length} photo(s)`)
      onAdded()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="ADD PERSON TO BIOMETRIC WATCHLIST" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Full Name / Identification Code">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tariq Mehmood or Subject W-045" required autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Category">
            <select className="field" value={category} onChange={(e) => setCategory(e.target.value as PersonCategory)}>
              {Object.entries(CATEGORY).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Threat / Risk Level">
            <select className="field" value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as Level)}>
              <option value="HIGH">High (Armed / Infiltrator)</option>
              <option value="MEDIUM">Medium (Suspect / Courier)</option>
              <option value="LOW">Low (Authorised Staff)</option>
            </select>
          </Field>
        </div>
        <Field label="Intelligence Notes & Description">
          <textarea
            className="field w-full h-18 text-xs"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Affiliation, physical marks, known infiltration routes..."
          />
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
          <div className="mt-1 text-[10px] text-ink-mute">Clear front-facing mugshots recommended. Biometric 128D embeddings will be computed automatically.</div>
        </div>
        <button className="btn btn-primary w-full" type="submit" disabled={busy || !name.trim()}>
          <Plus size={13} /> Add to Watchlist
        </button>
      </form>
    </Modal>
  )
}

function PersonsTab({
  persons,
  reload,
  onSelectPerson,
  onQuickSimulate,
}: {
  persons: WatchlistPerson[]
  reload: () => void
  onSelectPerson: (p: WatchlistPerson) => void
  onQuickSimulate: (personId: string) => void
}) {
  const canManage = useCan('manage')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<string>('ALL')
  const [riskFilter, setRiskFilter] = useState<string>('ALL')

  const filtered = useMemo(() => {
    return persons.filter((p) => {
      if (catFilter !== 'ALL' && p.category !== catFilter) return false
      if (riskFilter !== 'ALL' && p.riskLevel !== riskFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q)
      }
      return true
    })
  }, [persons, search, catFilter, riskFilter])

  if (!persons.length) {
    return (
      <div className="panel">
        <EmptyState title="Watchlist is empty" hint="Add wanted, suspect or missing persons with at least one face photo." icon={ScanFace} />
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {/* Search and Category Filters */}
      <div className="panel flex flex-wrap items-center justify-between gap-2 p-2 text-xs">
        <div className="relative min-w-48 flex-1">
          <Search size={13} className="absolute top-2 left-2.5 text-ink-mute" />
          <input
            className="field w-full pl-7 text-xs font-mono"
            placeholder="Search suspect name, ID, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-mono uppercase text-ink-mute mr-1">Category:</span>
          {['ALL', 'WANTED', 'SUSPECT', 'AUTHORISED'].map((cat) => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold transition-colors ${
                catFilter === cat
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'text-ink-mute hover:text-ink'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-l border-base-700 pl-2">
          <span className="text-[10px] font-mono uppercase text-ink-mute mr-1">Risk:</span>
          {['ALL', 'HIGH', 'MEDIUM', 'LOW'].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setRiskFilter(lvl)}
              className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold transition-colors ${
                riskFilter === lvl
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'text-ink-mute hover:text-ink'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Suspect Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
        {filtered.map((p) => {
          const photo = p.photos[0] || 'http://localhost:8000/media/faces/wl_tariq.jpg'
          return (
            <div
              key={p.id}
              className="panel group overflow-hidden border border-base-750 hover:border-accent/60 transition-colors flex flex-col justify-between"
            >
              <div>
                <div
                  className="relative flex gap-1.5 bg-base-850 p-2 cursor-pointer"
                  onClick={() => onSelectPerson(p)}
                  title="Click to view full biometric dossier"
                >
                  <img
                    src={photo}
                    alt={p.name}
                    className="h-32 w-24 rounded border border-base-600 object-cover group-hover:border-accent transition-colors"
                  />
                  <div className="flex flex-col gap-1">
                    {p.photos.slice(1, 4).map((ph, i) => (
                      <img
                        key={i}
                        src={ph}
                        alt=""
                        className="h-10 w-8 rounded-sm border border-base-700 object-cover"
                      />
                    ))}
                  </div>

                  <div className="ml-auto flex flex-col items-end justify-between">
                    <Chip className={CATEGORY[p.category].style}>{CATEGORY[p.category].label}</Chip>
                    <button
                      className="text-ink-mute hover:text-crit disabled:opacity-30 p-1"
                      disabled={!canManage}
                      aria-label={`Remove ${p.name}`}
                      title={canManage ? 'Remove person' : 'Commander / Admin only'}
                      onClick={(e) => {
                        e.stopPropagation()
                        void service.removeWatchlistPerson(p.id).then(() => {
                          audit('WATCHLIST', 'Person removed', p.name)
                          reload()
                        })
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="p-2 text-xs">
                  <div
                    className="truncate font-semibold text-white cursor-pointer hover:text-accent transition-colors"
                    onClick={() => onSelectPerson(p)}
                    title={p.name}
                  >
                    {p.name}
                  </div>
                  <div className="mt-0.5 flex justify-between text-[11px]">
                    <span>
                      Risk: <span className={`font-semibold ${RISK[p.riskLevel]}`}>{p.riskLevel}</span>
                    </span>
                    <span className="font-mono text-ink-mute">added {fmtDate(p.addedAt)}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-ink-mute" title={p.notes}>
                    {p.notes}
                  </div>
                </div>
              </div>

              {/* Card Quick Action Bar */}
              <div className="flex items-center justify-between border-t border-base-750 bg-base-900/60 p-1.5 gap-1">
                <button
                  onClick={() => onSelectPerson(p)}
                  className="btn btn-sm flex-1 font-mono text-[10px] text-ink-dim hover:text-ink"
                  title="Inspect full intelligence dossier"
                >
                  <FileText size={10} /> Dossier
                </button>
                <button
                  onClick={() => onQuickSimulate(p.id)}
                  className="btn btn-sm flex-1 font-mono text-[10px] border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
                  title="Simulate live camera match for this suspect"
                >
                  <Zap size={10} className="text-amber-400" /> Test Match
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatchesTab({
  matches,
  persons,
  onReview,
}: {
  matches: FaceMatch[]
  persons: WatchlistPerson[]
  onReview: (id: string, review: ReviewState) => void
}) {
  const cameras = useData((s) => s.cameras)
  const byId = useMemo(() => Object.fromEntries(persons.map((p) => [p.id, p])), [persons])

  if (!matches.length) {
    return (
      <div className="panel">
        <EmptyState
          title="No face matches yet"
          hint="Click '⚡ Simulate Live Face Match' above to test detection against the watchlist."
          icon={ScanFace}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {matches.map((m) => {
        const person = byId[m.personId]
        const camName = cameras.find((c) => c.id === m.cameraId)?.name ?? m.cameraId
        return (
          <div key={m.id} className="panel flex gap-3 p-3 border-base-700 bg-base-900/90 shadow-md">
            <figure className="text-center shrink-0">
              <img
                src={m.capturedUrl}
                alt="Captured face"
                className="h-28 w-[88px] rounded border border-base-600 object-cover"
              />
              <figcaption className="mt-0.5 text-[10px] text-ink-mute font-mono">Captured</figcaption>
            </figure>

            <div className="flex w-16 flex-col items-center justify-center shrink-0">
              <div
                className={`font-mono text-xl font-bold ${
                  m.similarity >= 0.85 ? 'text-crit animate-pulse' : 'text-med'
                }`}
              >
                {pct(m.similarity)}
              </div>
              <div className="text-[9px] text-ink-mute uppercase tracking-wider">similarity</div>
              <span className="mt-1 h-1 w-8 rounded-full bg-crit/70" />
            </div>

            <figure className="text-center shrink-0">
              {person ? (
                <img
                  src={person.photos[0]}
                  alt="Watchlist"
                  className="h-28 w-[88px] rounded border border-base-600 object-cover"
                />
              ) : (
                <div className="flex h-28 w-[88px] items-center justify-center rounded border border-base-700 text-[10px] text-ink-mute">
                  removed
                </div>
              )}
              <figcaption className="mt-0.5 text-[10px] text-ink-mute font-mono">Watchlist</figcaption>
            </figure>

            <div className="flex min-w-0 flex-1 flex-col text-xs">
              <div className="truncate font-semibold text-white">{person?.name ?? m.personId}</div>
              <div className="truncate text-ink-dim font-mono text-[11px]">{camName}</div>
              <div className="font-mono text-[10px] text-ink-mute">{fmtDateTime(m.timestamp)}</div>

              <div className="mt-1.5 flex items-center gap-1.5">
                <Chip className={REVIEW[m.review]}>{m.review}</Chip>
                {m.reviewedBy && (
                  <span className="truncate text-[10px] text-ink-mute">by {m.reviewedBy}</span>
                )}
              </div>

              <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
                <button
                  className="btn btn-sm btn-danger"
                  disabled={m.review === 'CONFIRMED'}
                  onClick={() => onReview(m.id, 'CONFIRMED')}
                  title="Confirm match and escalate to armed QRT patrol"
                >
                  <Check size={11} /> Confirm
                </button>
                <button
                  className="btn btn-sm"
                  disabled={m.review === 'REJECTED'}
                  onClick={() => onReview(m.id, 'REJECTED')}
                  title="Mark as false positive"
                >
                  <X size={11} /> Reject
                </button>
                {m.alertId && (
                  <Link
                    to={`/alerts/${m.alertId}`}
                    className="ml-auto text-[11px] text-accent hover:underline font-mono"
                  >
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
  const userName = useAuth((s) => s.user?.name ?? 'Operator')
  const faceAlerts = useData((s) => s.alerts.filter((a) => a.type === 'FACE_MATCH').length)
  const [tab, setTab] = useState<'persons' | 'matches'>('persons')
  const [persons, setPersons] = useState<WatchlistPerson[] | null>(null)
  const [matches, setMatches] = useState<FaceMatch[] | null>(null)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [dossierPerson, setDossierPerson] = useState<WatchlistPerson | null>(null)

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

  useEffect(load, [load, faceAlerts])

  const review = async (id: string, state: ReviewState) => {
    const updated = await service.reviewFaceMatch(id, state, userName)
    audit(
      'WATCHLIST',
      `Match ${state.toLowerCase()}`,
      id,
      `similarity ${Math.round(updated.similarity * 100)}%`,
    )
    setMatches((list) => list?.map((m) => (m.id === id ? updated : m)) ?? null)
  }

  const handleQuickSimulate = async (personId: string) => {
    try {
      if (service.simulateFaceMatch) {
        await service.simulateFaceMatch({ personId, cameraId: 'cam-01' })
      }
      audit('WATCHLIST', 'Quick match simulated', personId)
      load()
      setTab('matches')
    } catch {
      // link down
    }
  }

  const pending = matches?.filter((m) => m.review === 'PENDING').length

  return (
    <Page>
      <PageHeader
        title={t('nav.faces')}
        subtitle="Biometric facial detection & watchlist recognition with human-in-the-loop verification"
      >
        <div className="flex items-center gap-1.5">
          <button
            className="btn btn-sm border-amber-500/60 bg-amber-950/40 text-amber-300 hover:bg-amber-950/70"
            onClick={() => setSimulating(true)}
            title="Simulate a live AI face detection match against the watchlist"
          >
            <Zap size={12} className="text-amber-400" />
            <span>Simulate Face Match</span>
          </button>

          <button
            className="btn btn-sm btn-primary"
            onClick={() => setAdding(true)}
            title="Enroll a new subject into the biometric watchlist"
          >
            <Plus size={12} />
            <span>Add Person</span>
          </button>
        </div>
      </PageHeader>

      <div className="mb-3 flex items-center justify-between rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
        <div className="flex items-center gap-2">
          <Info size={15} className="shrink-0" />
          <span className="font-medium">
            AI Matches are decision support only; final biometric confirmation required by authorised command personnel.
          </span>
        </div>
        <div className="font-mono text-[10px] text-ink-mute hidden sm:block">
          ENGINE: FACENET-128D // SENSITIVITY: 88%
        </div>
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
        <div className="panel">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : !persons || !matches ? (
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : tab === 'persons' ? (
        <PersonsTab
          persons={persons}
          reload={load}
          onSelectPerson={setDossierPerson}
          onQuickSimulate={handleQuickSimulate}
        />
      ) : (
        <MatchesTab
          matches={matches}
          persons={persons}
          onReview={(id, s) => void review(id, s)}
        />
      )}

      {/* Add Person Modal */}
      {adding && <AddPersonModal onClose={() => setAdding(false)} onAdded={load} />}

      {/* Simulate Match Modal */}
      {simulating && persons && (
        <SimulateModal
          persons={persons}
          onClose={() => setSimulating(false)}
          onSimulated={() => {
            load()
            setTab('matches')
          }}
        />
      )}

      {/* Biometric Dossier Modal */}
      {dossierPerson && (
        <DossierModal
          person={dossierPerson}
          onClose={() => setDossierPerson(null)}
          onSimulate={handleQuickSimulate}
        />
      )}
    </Page>
  )
}
