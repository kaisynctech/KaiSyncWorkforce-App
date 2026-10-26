'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { JobsTabs } from '@/components/jobs/JobsTabs'
import { FormField, entryClass } from '@/components/SectionCard'
import {
  deleteJobService,
  formatPrice,
  listJobServices,
  saveJobService,
  setJobServiceActive,
  type JobService,
} from '@/lib/job-services'

type Draft = {
  id?: string
  name: string
  category: string
  description: string
  hours: string
  minutes: string
  price: string
  checklist: string
}

const EMPTY: Draft = { name: '', category: '', description: '', hours: '', minutes: '', price: '', checklist: '' }

function draftOf(s: JobService): Draft {
  const total = s.default_duration_minutes ?? 0
  return {
    id: s.id,
    name: s.name,
    category: s.category ?? '',
    description: s.description ?? '',
    hours: s.default_duration_minutes == null ? '' : String(Math.floor(total / 60)),
    minutes: s.default_duration_minutes == null ? '' : String(total % 60),
    price: s.default_price == null ? '' : String(s.default_price),
    checklist: s.checklist.join('\n'),
  }
}

function durationLabel(minutes: number | null): string {
  if (minutes == null) return ''
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min'
}

export default function JobServicesPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [services, setServices] = useState<JobService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const canEdit = can(perms, PERM.jobsEdit)

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Your account is not linked to an active employee record.'); setLoading(false); return }
    setCompanyId(member.companyId)
    const { data: me } = await supabase.from('employees').select('access_level').eq('id', member.employeeId).maybeSingle()
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))
    const res = await listJobServices(supabase, member.companyId, { includeInactive: true })
    if (res.ok) setServices(res.data)
    else setError(res.message)
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  async function save() {
    if (!draft || !companyId) return
    const hours = Number(draft.hours || 0)
    const minutes = Number(draft.minutes || 0)
    const hasDuration = draft.hours.trim() !== '' || draft.minutes.trim() !== ''
    if (hasDuration && (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0 || minutes > 59)) {
      setError('Enter the usual time as hours and minutes (0–59).'); return
    }
    const price = draft.price.trim() === '' ? null : Number(draft.price)
    if (price != null && (!Number.isFinite(price) || price < 0)) { setError('Enter a price of 0 or more.'); return }
    setBusy(true)
    setError(null)
    const res = await saveJobService(createClient(), companyId, {
      name: draft.name,
      category: draft.category,
      description: draft.description,
      defaultDurationMinutes: hasDuration ? Math.round(hours * 60 + minutes) : null,
      defaultPrice: price,
      checklist: draft.checklist.split('\n'),
    }, draft.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setServices(prev => {
      const others = prev.filter(s => s.id !== res.data.id)
      return [...others, res.data].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    })
    setNotice(draft.id ? `Saved ${res.data.name}.` : `Added ${res.data.name}.`)
    setDraft(null)
  }

  async function toggleActive(s: JobService) {
    if (!companyId) return
    setBusy(true)
    const res = await setJobServiceActive(createClient(), companyId, s.id, !s.is_active)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setServices(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !s.is_active } : x))
    setNotice(s.is_active ? `${s.name} is hidden from new jobs.` : `${s.name} is available again.`)
  }

  async function remove(s: JobService) {
    if (!companyId) return
    if (!window.confirm(`Delete "${s.name}"?\n\nJobs that used it keep their title and history. To keep it for old reports, choose Hide instead.`)) return
    setBusy(true)
    const res = await deleteJobService(createClient(), companyId, s.id)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setServices(prev => prev.filter(x => x.id !== s.id))
    setNotice(`Deleted ${s.name}.`)
  }

  const q = search.trim().toLowerCase()
  const shown = services.filter(s =>
    (showInactive || s.is_active) &&
    (!q || s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q)))
  const hiddenCount = services.filter(s => !s.is_active).length

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[16px] font-bold text-text-primary">Jobs</h1>
            <JobsTabs active="services" />
          </div>
          {canEdit && !draft && (
            <button
              type="button"
              onClick={() => { setDraft({ ...EMPTY }); setNotice(null); setError(null) }}
              className="flex items-center gap-1 h-8 px-2.5 rounded-sm bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark"
            >
              <span className="material-icons text-[16px]" aria-hidden="true">add</span>
              New service
            </button>
          )}
        </div>
        <p className="text-[12px] text-text-secondary max-w-2xl">
          The services your company does, for example Minor service, Major service or Breakdown call-out.
          They appear in a dropdown when creating a job. To give a client only some of these, or a special
          price, open the client and use Job services there.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 max-w-md">
            <span className="material-icons text-text-disabled text-[16px]" aria-hidden="true">search</span>
            <input
              type="search"
              aria-label="Search services"
              placeholder="Search services"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
            />
          </div>
          {hiddenCount > 0 && (
            <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
              Show hidden ({hiddenCount})
            </label>
          )}
        </div>
        {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
        {notice && !error && <p className="text-[13px] text-success" aria-live="polite">{notice}</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-4 space-y-3">
        {draft && (
          <form
            onSubmit={e => { e.preventDefault(); void save() }}
            className="bg-surface border border-primary/40 rounded-lg p-4 space-y-3 max-w-2xl"
          >
            <p className="text-[13px] font-semibold text-text-primary">{draft.id ? 'Edit service' : 'New service'}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Name *">
                <input className={entryClass} value={draft.name} autoFocus required maxLength={120}
                  onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Minor service" />
              </FormField>
              <FormField label="Category" hint="Optional, e.g. Maintenance or Repairs">
                <input className={entryClass} value={draft.category} maxLength={80}
                  onChange={e => setDraft({ ...draft, category: e.target.value })} />
              </FormField>
              <FormField label="Usual price (R)" hint="Optional. A client's agreed price replaces it.">
                <input className={entryClass} type="number" min="0" step="0.01" inputMode="decimal" value={draft.price}
                  onWheel={e => e.currentTarget.blur()}
                  onChange={e => setDraft({ ...draft, price: e.target.value })} />
              </FormField>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-[12px] font-medium text-text-secondary mb-1.5">Usual time (optional)</legend>
                <div className="flex gap-2">
                  <input className={entryClass} type="number" min="0" aria-label="Hours" placeholder="Hours" value={draft.hours}
                    onWheel={e => e.currentTarget.blur()}
                    onChange={e => setDraft({ ...draft, hours: e.target.value })} />
                  <input className={entryClass} type="number" min="0" max="59" aria-label="Minutes" placeholder="Minutes" value={draft.minutes}
                    onWheel={e => e.currentTarget.blur()}
                    onChange={e => setDraft({ ...draft, minutes: e.target.value })} />
                </div>
                <p className="text-[11px] text-text-secondary">Sets the job end time from its start time.</p>
              </fieldset>
            </div>
            <FormField label="Description">
              <textarea className={`${entryClass} h-auto py-2 resize-y`} rows={2} maxLength={2000} value={draft.description}
                onChange={e => setDraft({ ...draft, description: e.target.value })} />
            </FormField>
            <FormField label="Checklist steps" hint="One step per line. They are added to the job for the technician to tick off.">
              <textarea className={`${entryClass} h-auto py-2 resize-y`} rows={4} value={draft.checklist}
                placeholder={'Clean filters\nCheck gas pressure\nTest drain'}
                onChange={e => setDraft({ ...draft, checklist: e.target.value })} />
            </FormField>
            <div className="flex gap-2">
              <button type="submit" disabled={busy || !draft.name.trim()} className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">
                {busy ? 'Saving…' : 'Save service'}
              </button>
              <button type="button" onClick={() => { setDraft(null); setError(null) }} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p>
        ) : shown.length === 0 ? (
          <div className="py-12 text-center space-y-1">
            <span className="material-icons text-[40px] text-text-disabled" aria-hidden="true">handyman</span>
            <p className="text-[14px] text-text-secondary">{services.length === 0 ? 'No services yet.' : 'No services match.'}</p>
            {services.length === 0 && canEdit && (
              <p className="text-[12px] text-text-secondary">Add the services you do, for example Minor service, Major service and Breakdown call-out.</p>
            )}
          </div>
        ) : (
          <ul className="bg-surface border border-divider rounded-lg divide-y divide-divider max-w-3xl">
            {shown.map(s => (
              <li key={s.id} className="px-4 py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-medium ${s.is_active ? 'text-text-primary' : 'text-text-disabled'}`}>
                    {s.name}
                    {!s.is_active && <span className="ml-2 text-[11px] font-normal text-text-secondary">Hidden</span>}
                  </p>
                  <p className="text-[12px] text-text-secondary">
                    {[s.category, formatPrice(s.default_price), durationLabel(s.default_duration_minutes),
                      s.checklist.length ? `${s.checklist.length} checklist step${s.checklist.length === 1 ? '' : 's'}` : '']
                      .filter(Boolean).join(' · ') || 'No price or time set'}
                  </p>
                  {s.description && <p className="text-[12px] text-text-secondary mt-0.5">{s.description}</p>}
                </div>
                {canEdit && (
                  <div className="flex items-center gap-3 shrink-0 text-[12px]">
                    <button type="button" className="text-primary hover:underline" onClick={() => { setDraft(draftOf(s)); setNotice(null) }}>Edit</button>
                    <button type="button" className="text-text-secondary hover:underline" disabled={busy} onClick={() => void toggleActive(s)}>
                      {s.is_active ? 'Hide' : 'Show'}
                    </button>
                    <button type="button" className="text-error hover:underline" disabled={busy} onClick={() => void remove(s)}>Delete</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
