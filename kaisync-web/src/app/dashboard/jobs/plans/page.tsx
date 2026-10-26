'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { JobsTabs } from '@/components/jobs/JobsTabs'
import { FormField, entryClass } from '@/components/SectionCard'
import {
  areaOptions,
  listClientSites,
  listJobServices,
  listSiteAreas,
  type AreaOption,
  type JobService,
  type SiteRow,
} from '@/lib/job-services'
import {
  OUTCOME_LABEL,
  createDueJobs,
  listPlanVisits,
  listPlans,
  pastVisits,
  removePlan,
  savePlan,
  serviceForVisit,
  setPlanActive,
  todayIso,
  visitOutcome,
  type PlanVisit,
  type ServicePlan,
  type VisitOutcome,
} from '@/lib/service-plans'

type Person = { id: string; name: string }
type Draft = {
  id?: string
  clientId: string
  siteId: string
  areaId: string
  name: string
  serviceIds: string[]
  interval: string
  firstDue: string
  backfill: boolean
  leadDays: string
  startTime: string
  employeeIds: string[]
  includeEquipment: boolean
  notes: string
}

const small =
  'h-9 px-2.5 rounded-sm bg-surface-elevated border border-border text-[13px] text-text-primary ' +
  'focus:outline-none focus:ring-2 focus:ring-primary/30'

const INTERVALS = [1, 2, 3, 4, 6, 12]
const intervalLabel = (m: number) => (m === 1 ? 'Every month' : m === 12 ? 'Every year' : `Every ${m} months`)

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** First and last day of a YYYY-MM month. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/** YYYY-MM-DD plus n days. */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

const OUTCOME_CLASS: Record<VisitOutcome, string> = {
  done: 'text-success',
  incomplete: 'text-warning',
  overdue: 'text-error',
  upcoming: 'text-text-secondary',
  cancelled: 'text-text-disabled',
}

export default function ServicePlansPage() {
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)
  const [plans, setPlans] = useState<ServicePlan[]>([])
  const [services, setServices] = useState<JobService[]>([])
  const [clients, setClients] = useState<Person[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [siteNames, setSiteNames] = useState<Map<string, string>>(new Map())
  const [areaNames, setAreaNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftSites, setDraftSites] = useState<SiteRow[]>([])
  const [draftAreas, setDraftAreas] = useState<AreaOption[]>([])
  const [search, setSearch] = useState('')
  const [month, setMonth] = useState(() => todayIso().slice(0, 7))
  const [visits, setVisits] = useState<PlanVisit[]>([])
  const [outcomeFilter, setOutcomeFilter] = useState<VisitOutcome | ''>('')

  const canCreate = can(perms, PERM.jobsCreate)
  const canEdit = can(perms, PERM.jobsEdit)
  const today = todayIso()

  const loadNames = useCallback(async (companyId: string, list: ServicePlan[]) => {
    const supabase = createClient()
    const siteIds = [...new Set(list.map(p => p.site_id))]
    if (siteIds.length === 0) return
    const [{ data: sites }, areas] = await Promise.all([
      supabase.from('sites').select('id, name').eq('company_id', companyId).in('id', siteIds.slice(0, 500)),
      listSiteAreas(supabase, companyId, siteIds, { includeInactive: true }),
    ])
    setSiteNames(new Map((sites ?? []).map(s => [s.id as string, s.name as string])))
    if (areas.ok) setAreaNames(new Map(areaOptions(areas.data).map(a => [a.id, a.path])))
  }, [])

  const loadVisits = useCallback(async (companyId: string, month: string) => {
    const { from, to } = monthRange(month)
    const res = await listPlanVisits(createClient(), companyId, from, to)
    if (res.ok) setVisits(res.data)
    else setError(res.message)
  }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Your account is not linked to an active employee record.'); setLoading(false); return }
    setCompanyId(member.companyId)
    const { data: me } = await supabase.from('employees').select('access_level').eq('id', member.employeeId).maybeSingle()
    const [p, pl, sv, cl, em] = await Promise.all([
      loadPermissions(supabase, member.companyId, me?.access_level),
      listPlans(supabase, member.companyId),
      listJobServices(supabase, member.companyId, { includeInactive: true }),
      supabase.from('clients').select('id, name').eq('company_id', member.companyId).order('name').limit(5000),
      supabase.from('employees').select('id, name, surname').eq('company_id', member.companyId).eq('is_active', true).order('name').limit(5000),
    ])
    setPerms(p)
    if (!pl.ok) setError(pl.message); else setPlans(pl.data)
    if (sv.ok) setServices(sv.data)
    setClients((cl.data ?? []).map(c => ({ id: c.id as string, name: c.name as string })))
    setPeople((em.data ?? []).map(e => ({ id: e.id as string, name: `${e.name ?? ''} ${e.surname ?? ''}`.trim() })))
    if (pl.ok) await loadNames(member.companyId, pl.data)
    setLoading(false)
  }, [loadNames])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void load() })
    return () => { cancelled = true }
  }, [load])

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void loadVisits(companyId, month) })
    return () => { cancelled = true }
  }, [companyId, month, loadVisits])

  // Sites for the chosen client, areas for the chosen site (form).
  const draftClient = draft?.clientId ?? ''
  const draftSite = draft?.siteId ?? ''
  useEffect(() => {
    if (!companyId || !draftClient) return
    let cancelled = false
    void listClientSites(createClient(), companyId, draftClient).then(r => { if (!cancelled && r.ok) setDraftSites(r.data) })
    return () => { cancelled = true }
  }, [companyId, draftClient])
  useEffect(() => {
    if (!companyId || !draftSite) return
    let cancelled = false
    void listSiteAreas(createClient(), companyId, [draftSite]).then(r => { if (!cancelled && r.ok) setDraftAreas(areaOptions(r.data)) })
    return () => { cancelled = true }
  }, [companyId, draftSite])

  const serviceName = useMemo(() => new Map(services.map(s => [s.id, s.name])), [services])
  const clientName = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients])
  const planById = useMemo(() => new Map(plans.map(p => [p.id, p])), [plans])

  function startNew() {
    setDraftSites([]); setDraftAreas([])
    setDraft({
      clientId: '', siteId: '', areaId: '', name: '', serviceIds: [], interval: '3', firstDue: today, backfill: false,
      leadDays: '7', startTime: '08:00', employeeIds: [], includeEquipment: true, notes: '',
    })
    setError(null); setNotice(null)
  }

  function startEdit(p: ServicePlan) {
    setDraft({
      id: p.id, clientId: p.client_id, siteId: p.site_id, areaId: p.area_id ?? '', name: p.name, serviceIds: p.service_ids,
      interval: String(p.interval_months), firstDue: p.first_due, backfill: false, leadDays: String(p.lead_days),
      startTime: p.start_time.slice(0, 5), employeeIds: p.employee_ids, includeEquipment: p.include_equipment, notes: p.notes ?? '',
    })
    setError(null); setNotice(null)
  }

  async function save() {
    if (!draft || !companyId) return
    const interval = Number(draft.interval)
    const isNew = !draft.id
    const skip = isNew && !draft.backfill ? pastVisits(draft.firstDue, interval, today) : undefined
    setBusy(true); setError(null)
    const res = await savePlan(createClient(), companyId, {
      clientId: draft.clientId, siteId: draft.siteId, areaId: draft.areaId || null, name: draft.name,
      serviceIds: draft.serviceIds, intervalMonths: interval, firstDue: draft.firstDue, visitsCreated: skip,
      leadDays: Math.max(0, Math.min(90, Number(draft.leadDays) || 0)), startTime: draft.startTime,
      employeeIds: draft.employeeIds, includeEquipment: draft.includeEquipment, notes: draft.notes,
    }, draft.id)
    if (!res.ok) { setBusy(false); setError(res.message); return }
    // Make the jobs that are already due for this plan straight away.
    const made = await createDueJobs(createClient(), companyId, res.data.id)
    setBusy(false)
    setDraft(null)
    setNotice(`${isNew ? 'Added' : 'Saved'} ${res.data.name}.${made.ok && made.data ? ` ${made.data} job${made.data === 1 ? '' : 's'} created.` : ''}`)
    await load()
    await loadVisits(companyId, month)
  }

  async function runDue() {
    if (!companyId) return
    setBusy(true); setError(null); setNotice(null)
    const res = await createDueJobs(createClient(), companyId)
    setBusy(false)
    if (!res.ok) { setError(res.message); return }
    setNotice(res.data ? `${res.data} job${res.data === 1 ? '' : 's'} created.` : 'Nothing is due yet.')
    await load()
    await loadVisits(companyId, month)
  }

  async function toggle(p: ServicePlan) {
    if (!companyId) return
    const res = await setPlanActive(createClient(), companyId, p.id, !p.is_active)
    if (!res.ok) { setError(res.message); return }
    setPlans(prev => prev.map(x => x.id === p.id ? { ...x, is_active: !p.is_active } : x))
  }

  async function remove(p: ServicePlan) {
    if (!companyId) return
    if (!window.confirm(`Delete the plan "${p.name}"?\n\nJobs it already created stay. To stop it for now, choose Pause instead.`)) return
    const res = await removePlan(createClient(), companyId, p.id)
    if (!res.ok) { setError(res.message); return }
    setPlans(prev => prev.filter(x => x.id !== p.id))
  }

  const q = search.trim().toLowerCase()
  const shownPlans = plans.filter(p => !q || p.name.toLowerCase().includes(q) || (clientName.get(p.client_id) ?? '').toLowerCase().includes(q))
  const dueSoon = plans.filter(p => p.is_active && addDays(p.next_due, -p.lead_days) <= today).length

  const withOutcome = visits.map(v => ({ v, o: visitOutcome(v, today) }))
  const counts = withOutcome.reduce((m, x) => ({ ...m, [x.o]: (m[x.o] ?? 0) + 1 }), {} as Partial<Record<VisitOutcome, number>>)
  const shownVisits = withOutcome.filter(x => !outcomeFilter || x.o === outcomeFilter)

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [['Due date', 'Client', 'Plan', 'Site', 'Area', 'Service', 'Job', 'Result', 'Units done'].join(',')]
    for (const { v, o } of withOutcome) {
      const p = planById.get(v.service_plan_id)
      const done = v.units.filter(u => u.status === 'done').length
      lines.push([v.plan_due_date, clientName.get(p?.client_id ?? '') ?? '', p?.name ?? '', siteNames.get(p?.site_id ?? '') ?? '',
        p?.area_id ? areaNames.get(p.area_id) ?? '' : '', v.service?.name ?? '', v.job_code ?? '', OUTCOME_LABEL[o],
        v.units.length ? `${done}/${v.units.length}` : ''].map(x => esc(String(x))).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `service-report-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const nextDueLabel = (p: ServicePlan) => {
    const sid = serviceForVisit(p.service_ids, p.visits_created)
    return `${fmtDate(p.next_due)}${sid ? ` · ${serviceName.get(sid) ?? 'Service'}` : ''}`
  }

  const form = draft && (
    <form onSubmit={e => { e.preventDefault(); void save() }} className="bg-surface border border-primary/40 rounded-lg p-4 space-y-3 max-w-3xl">
      <p className="text-[13px] font-semibold text-text-primary">{draft.id ? 'Edit service plan' : 'New service plan'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Plan name *">
          <input className={entryClass} value={draft.name} maxLength={160} required placeholder="e.g. SAB Rosslyn aircons"
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </FormField>
        <FormField label="Client *">
          <select className={entryClass} value={draft.clientId} required disabled={!!draft.id}
            onChange={e => { setDraftSites([]); setDraftAreas([]); setDraft({ ...draft, clientId: e.target.value, siteId: '', areaId: '' }) }}>
            <option value="">Choose a client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Site *" hint={draft.clientId && draftSites.length === 0 ? 'Add a site on the client page first.' : undefined}>
          <select className={entryClass} value={draft.siteId} required disabled={!draft.clientId}
            onChange={e => { setDraftAreas([]); setDraft({ ...draft, siteId: e.target.value, areaId: '' }) }}>
            <option value="">Choose a site</option>
            {draftSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FormField>
        <FormField label="Area" hint="Optional. Leave empty for the whole site.">
          <select className={entryClass} value={draft.areaId} disabled={!draft.siteId}
            onChange={e => setDraft({ ...draft, areaId: e.target.value })}>
            <option value="">Whole site</option>
            {draftAreas.map(a => <option key={a.id} value={a.id}>{a.path}</option>)}
          </select>
        </FormField>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-[12px] font-medium text-text-secondary mb-1">Services, in order *</legend>
        <p className="text-[11px] text-text-secondary">Visits go through this list and start again, e.g. Minor, Minor, Minor, Major for a major service once a year.</p>
        {draft.serviceIds.length > 0 && (
          <ol className="space-y-1">
            {draft.serviceIds.map((id, i) => (
              <li key={`${id}-${i}`} className="flex items-center gap-2 text-[13px]">
                <span className="w-16 text-text-secondary">Visit {i + 1}</span>
                <span className="flex-1">{serviceName.get(id) ?? 'Service'}</span>
                <button type="button" className="text-error text-[11px]"
                  onClick={() => setDraft({ ...draft, serviceIds: draft.serviceIds.filter((_, j) => j !== i) })}>Remove</button>
              </li>
            ))}
          </ol>
        )}
        {draft.serviceIds.length < 12 && (
          <select className={small} aria-label="Add a service to the rotation" value=""
            onChange={e => { if (e.target.value) setDraft({ ...draft, serviceIds: [...draft.serviceIds, e.target.value] }) }}>
            <option value="">{services.length ? '+ Add a service…' : 'No services yet (Jobs › Job services)'}</option>
            {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-4">
        <FormField label="How often">
          <select className={entryClass} value={draft.interval} onChange={e => setDraft({ ...draft, interval: e.target.value })}>
            {INTERVALS.map(m => <option key={m} value={m}>{intervalLabel(m)}</option>)}
          </select>
        </FormField>
        <FormField label="First visit *">
          <input className={entryClass} type="date" value={draft.firstDue} required onChange={e => setDraft({ ...draft, firstDue: e.target.value })} />
        </FormField>
        <FormField label="Start time">
          <input className={entryClass} type="time" value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })} />
        </FormField>
        <FormField label="Create job (days before)">
          <input className={entryClass} type="number" min="0" max="90" value={draft.leadDays}
            onWheel={e => e.currentTarget.blur()} onChange={e => setDraft({ ...draft, leadDays: e.target.value })} />
        </FormField>
      </div>
      {!draft.id && draft.firstDue < today && (
        <label className="flex items-center gap-2 text-[12px] text-text-primary">
          <input type="checkbox" className="accent-primary" checked={draft.backfill} onChange={e => setDraft({ ...draft, backfill: e.target.checked })} />
          The first visit is in the past. Also create jobs for past visits (to record work already done).
        </label>
      )}

      <fieldset>
        <legend className="text-[12px] font-medium text-text-secondary mb-1">Technicians (optional)</legend>
        <div className="flex flex-wrap gap-1.5">
          {draft.employeeIds.map(id => (
            <span key={id} className="inline-flex items-center gap-1 h-7 px-2 rounded-full bg-primary/10 text-[12px] text-text-primary">
              {people.find(p => p.id === id)?.name ?? 'Employee'}
              <button type="button" aria-label="Remove technician" className="text-text-secondary"
                onClick={() => setDraft({ ...draft, employeeIds: draft.employeeIds.filter(x => x !== id) })}>×</button>
            </span>
          ))}
          <select className={small} aria-label="Add a technician" value=""
            onChange={e => { if (e.target.value) setDraft({ ...draft, employeeIds: [...draft.employeeIds, e.target.value] }) }}>
            <option value="">+ Add…</option>
            {people.filter(p => !draft.employeeIds.includes(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-[13px] text-text-primary">
        <input type="checkbox" className="accent-primary" checked={draft.includeEquipment} onChange={e => setDraft({ ...draft, includeEquipment: e.target.checked })} />
        Put the area&apos;s equipment on each job card
      </label>
      <FormField label="Notes for the job">
        <textarea className={`${entryClass} h-auto py-2 resize-y`} rows={2} maxLength={2000} value={draft.notes}
          onChange={e => setDraft({ ...draft, notes: e.target.value })} />
      </FormField>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !draft.name.trim() || !draft.siteId || draft.serviceIds.length === 0}
          className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50">{busy ? 'Saving…' : 'Save plan'}</button>
        <button type="button" onClick={() => { setDraft(null); setError(null) }} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
      </div>
    </form>
  )

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[16px] font-bold text-text-primary">Jobs</h1>
            <JobsTabs active="plans" />
          </div>
          <div className="flex gap-2">
            {canCreate && plans.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void runDue()} className="btn-outlined h-8 px-2.5 text-[12px] disabled:opacity-50">
                Create due jobs{dueSoon ? ` (${dueSoon})` : ''}
              </button>
            )}
            {canCreate && !draft && (
              <button type="button" onClick={startNew}
                className="flex items-center gap-1 h-8 px-2.5 rounded-sm bg-primary text-white text-[12px] font-semibold hover:bg-primary-dark">
                <span className="material-icons text-[16px]" aria-hidden="true">add</span>
                New plan
              </button>
            )}
          </div>
        </div>
        <p className="text-[12px] text-text-secondary max-w-2xl">
          Regular visits, for example a client&apos;s aircons every 3 months with a major service once a year.
          Jobs are created automatically each morning, the set number of days before each visit.
        </p>
        {error && <p className="text-[13px] text-error" role="alert">{error}</p>}
        {notice && !error && <p className="text-[13px] text-success" aria-live="polite">{notice}</p>}
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 pb-4 space-y-4">
        {form}

        {loading ? (
          <p className="py-10 text-center text-[13px] text-text-secondary">Loading…</p>
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="section-label">PLANS ({plans.length})</p>
                {plans.length > 5 && (
                  <input type="search" className={`${small} max-w-xs`} aria-label="Search plans" placeholder="Search plan or client"
                    value={search} onChange={e => setSearch(e.target.value)} />
                )}
              </div>
              {plans.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No service plans yet.{canCreate ? ' Add one with New plan.' : ''}</p>
              ) : (
                <div className="bg-surface border border-divider rounded-lg overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-[11px] text-text-secondary uppercase">
                      <tr className="border-b border-divider">
                        <th className="px-3 py-2">Plan</th><th className="px-3 py-2">Where</th><th className="px-3 py-2">Services</th>
                        <th className="px-3 py-2">How often</th><th className="px-3 py-2">Next visit</th><th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {shownPlans.map(p => (
                        <tr key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                          <td className="px-3 py-2">
                            <p className="text-text-primary font-medium">{p.name}</p>
                            <p className="text-[11px] text-text-secondary">{clientName.get(p.client_id) ?? ''}{!p.is_active && ' · Paused'}</p>
                          </td>
                          <td className="px-3 py-2 text-text-secondary">
                            {siteNames.get(p.site_id) ?? 'Site'}{p.area_id ? ` › ${areaNames.get(p.area_id) ?? 'Area'}` : ''}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{p.service_ids.map(id => serviceName.get(id) ?? '?').join(', ')}</td>
                          <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{intervalLabel(p.interval_months)}</td>
                          <td className={`px-3 py-2 whitespace-nowrap ${p.is_active && p.next_due < today ? 'text-error' : 'text-text-primary'}`}>{nextDueLabel(p)}</td>
                          <td className="px-3 py-2 whitespace-nowrap text-[11px] space-x-3 text-right">
                            {canEdit && <button type="button" className="text-primary" onClick={() => startEdit(p)}>Edit</button>}
                            {canEdit && <button type="button" className="text-text-secondary" onClick={() => void toggle(p)}>{p.is_active ? 'Pause' : 'Resume'}</button>}
                            {canEdit && <button type="button" className="text-error" onClick={() => void remove(p)}>Delete</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="section-label">SERVICE REPORT</p>
                <input type="month" className={small} aria-label="Month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} />
                {visits.length > 0 && <button type="button" onClick={exportCsv} className="text-primary text-[12px] hover:underline">Download CSV</button>}
              </div>
              <div className="flex flex-wrap gap-2">
                {(['done', 'incomplete', 'overdue', 'upcoming'] as VisitOutcome[]).map(o => (
                  <button key={o} type="button" onClick={() => setOutcomeFilter(outcomeFilter === o ? '' : o)}
                    aria-pressed={outcomeFilter === o}
                    className={`rounded-lg border px-3 py-2 text-left min-w-[120px] ${outcomeFilter === o ? 'border-primary bg-primary/5' : 'border-divider bg-surface'}`}>
                    <p className={`text-[18px] font-bold ${OUTCOME_CLASS[o]}`}>{counts[o] ?? 0}</p>
                    <p className="text-[11px] text-text-secondary">{OUTCOME_LABEL[o]}</p>
                  </button>
                ))}
              </div>
              {visits.length === 0 ? (
                <p className="text-[13px] text-text-secondary">No planned visits in this month.</p>
              ) : (
                <div className="bg-surface border border-divider rounded-lg overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead className="text-left text-[11px] text-text-secondary uppercase">
                      <tr className="border-b border-divider">
                        <th className="px-3 py-2">Due</th><th className="px-3 py-2">Client / plan</th><th className="px-3 py-2">Where</th>
                        <th className="px-3 py-2">Service</th><th className="px-3 py-2">Job</th><th className="px-3 py-2">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {shownVisits.map(({ v, o }) => {
                        const p = planById.get(v.service_plan_id)
                        const done = v.units.filter(u => u.status === 'done').length
                        return (
                          <tr key={v.id}>
                            <td className="px-3 py-2 whitespace-nowrap">{fmtDate(v.plan_due_date)}</td>
                            <td className="px-3 py-2">
                              <p className="text-text-primary">{clientName.get(p?.client_id ?? '') ?? '—'}</p>
                              <p className="text-[11px] text-text-secondary">{p?.name ?? ''}</p>
                            </td>
                            <td className="px-3 py-2 text-text-secondary">
                              {siteNames.get(p?.site_id ?? '') ?? ''}{p?.area_id ? ` › ${areaNames.get(p.area_id) ?? ''}` : ''}
                            </td>
                            <td className="px-3 py-2 text-text-secondary">{v.service?.name ?? '—'}</td>
                            <td className="px-3 py-2"><Link href={`/dashboard/jobs/${v.id}`} className="text-primary hover:underline">{v.job_code ?? 'Open'}</Link></td>
                            <td className={`px-3 py-2 whitespace-nowrap ${OUTCOME_CLASS[o]}`}>
                              {OUTCOME_LABEL[o]}
                              {v.units.length > 0 && <span className="text-text-secondary text-[11px]"> · {done}/{v.units.length} units</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
