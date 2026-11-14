/**
 * The Job report (signed by the technician and the client): put together from what is already on the job — visits
 * and time (visit reports and clock-ins on the job), work done, the checklist, parts used and the photos chosen for
 * the client. What is signed is kept as a frozen copy (job_signoffs.content), so a signed report never changes.
 * Decided 14 Nov 2026: a sign-off per visit (optional per job) and one for the whole job; "Not happy" only notifies.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type JobReportPerson = { name: string; arrived: string | null; left: string | null; minutes: number }
export type JobReportVisit = { date: string; people: JobReportPerson[]; minutes: number }
export type JobReportContent = {
  job: { code: string | null; title: string; client: string | null; address: string | null; service: string | null }
  visits: JobReportVisit[]
  total_minutes: number
  work: { date: string; author: string | null; text: string }[]
  checklist: { text: string; done: boolean }[]
  parts: { name: string; qty: number; unit: string | null }[]
  materials: string[]
  /** Storage paths in workforce-media (job photos chosen for the client). */
  photos: string[]
  still_to_do: string
}

export type ReportRow = { id: string; employee_id: string | null; author: string | null; report_date: string; start_time: string | null; end_time: string | null; work_performed: string; materials_used: string | null }
export type PunchRow = { employee_id: string; name: string; type: 'in' | 'out' | string; date_time: string }

const TZ = 'Africa/Johannesburg'
export const sastDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const mins = (a: string | null, b: string | null) => {
  if (!a || !b) return 0
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return Number.isFinite(m) && m > 0 ? m : 0
}

/**
 * Visits by day and person. A visit report's own start / end win; otherwise clock-in → clock-out on the job that day
 * (an "in" with no "out" counts nothing). Days with only clock-ins still show (someone was on site).
 */
export function buildVisits(reports: ReportRow[], punches: PunchRow[]): JobReportVisit[] {
  const key = (date: string, name: string) => `${date}|${name}`
  const people = new Map<string, JobReportPerson & { date: string }>()
  const fromReports = new Set<string>()
  for (const r of reports) {
    const name = r.author?.trim() || 'Office'
    const k = key(r.report_date, name)
    if (!r.start_time && !r.end_time) { if (!people.has(k)) people.set(k, { date: r.report_date, name, arrived: null, left: null, minutes: 0 }); continue }
    fromReports.add(k)
    const prev = people.get(k)
    const arrived = [prev?.arrived, r.start_time].filter(Boolean).sort()[0] ?? null
    const left = [prev?.left, r.end_time].filter(Boolean).sort().reverse()[0] ?? null
    people.set(k, { date: r.report_date, name, arrived, left, minutes: (prev?.minutes ?? 0) + mins(r.start_time, r.end_time) })
  }
  // Clock-ins on the job: pair each "in" with that person's next punch when it is an "out" the same day.
  const byPerson = new Map<string, PunchRow[]>()
  for (const p of [...punches].sort((a, b) => a.date_time.localeCompare(b.date_time))) {
    byPerson.set(p.employee_id, [...(byPerson.get(p.employee_id) ?? []), p])
  }
  for (const list of byPerson.values()) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      if (p.type !== 'in') continue
      const date = sastDate(p.date_time)
      // Only the very next punch, if it is an "out" the same day (a forgotten clock-out never spans days).
      const nx = list[i + 1]
      const out = nx && nx.type === 'out' && sastDate(nx.date_time) === date ? nx : undefined
      const k = key(date, p.name)
      if (fromReports.has(k)) continue
      const prev = people.get(k)
      people.set(k, {
        date, name: p.name,
        arrived: [prev?.arrived, p.date_time].filter(Boolean).sort()[0] ?? null,
        left: out ? [prev?.left, out.date_time].filter(Boolean).sort().reverse()[0] ?? null : prev?.left ?? null,
        minutes: (prev?.minutes ?? 0) + (out ? mins(p.date_time, out.date_time) : 0),
      })
    }
  }
  const days = new Map<string, JobReportPerson[]>()
  for (const v of people.values()) days.set(v.date, [...(days.get(v.date) ?? []), { name: v.name, arrived: v.arrived, left: v.left, minutes: v.minutes }])
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, ps]) => ({
    date, people: ps.sort((a, b) => a.name.localeCompare(b.name)), minutes: ps.reduce((s, x) => s + x.minutes, 0),
  }))
}

export function buildJobReportContent(v: {
  job: JobReportContent['job']
  reports: ReportRow[]
  punches: PunchRow[]
  checklist: { description: string; is_checked: boolean }[]
  parts: { name: string; qty: number; unit: string | null }[]
  photos: string[]
  stillToDo: string
  /** Tidied wording per visit report id (the visit reports stay as written). */
  workEdits?: Record<string, string>
}): JobReportContent {
  const visits = buildVisits(v.reports, v.punches)
  const sorted = [...v.reports].sort((a, b) => (a.report_date + (a.start_time ?? '')).localeCompare(b.report_date + (b.start_time ?? '')))
  // Parts with the same name add up.
  const parts = new Map<string, { name: string; qty: number; unit: string | null }>()
  for (const p of v.parts) {
    const k = `${p.name}|${p.unit ?? ''}`
    const prev = parts.get(k)
    parts.set(k, { name: p.name, unit: p.unit, qty: Math.round(((prev?.qty ?? 0) + (Number(p.qty) || 0)) * 100) / 100 })
  }
  return {
    job: v.job,
    visits,
    total_minutes: visits.reduce((s, d) => s + d.minutes, 0),
    work: sorted.map(r => ({ date: r.report_date, author: r.author, text: (v.workEdits?.[r.id] ?? r.work_performed).trim() })).filter(w => w.text),
    checklist: v.checklist.map(c => ({ text: c.description, done: !!c.is_checked })),
    parts: [...parts.values()],
    materials: sorted.map(r => r.materials_used?.trim() ?? '').filter(Boolean),
    photos: v.photos,
    still_to_do: v.stillToDo.trim(),
  }
}

export function fmtMinutes(m: number): string {
  if (!(m > 0)) return '—'
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${h} h${r ? ` ${String(r).padStart(2, '0')}` : ''}` : `${r} min`
}

export const fmtClock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—'

export const fmtDay = (d: string) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export type Signoff = {
  id: string; job_id: string; scope: 'visit' | 'job'; report_id: string | null; visit_date: string | null; version: number
  status: 'draft' | 'awaiting_client' | 'signed' | 'not_happy'; content: JobReportContent
  technician_name: string | null; technician_signature: string | null; technician_signed_at: string | null
  client_name: string | null; client_signature: string | null; client_comment: string | null; client_signed_at: string | null
  signed_via: 'on_site' | 'link' | null; created_at: string
}

const SIGNOFF_COLUMNS = 'id, job_id, scope, report_id, visit_date, version, status, content, technician_name, technician_signature, technician_signed_at, client_name, client_signature, client_comment, client_signed_at, signed_via, created_at'

/** Everything the office needs to put the report together (RLS: jobs.view). */
export async function loadJobReportSources(supabase: SupabaseClient, companyId: string, jobId: string) {
  const [job, reports, punches, checklist, usage, signoffs] = await Promise.all([
    supabase.from('jobs').select('id, job_code, title, address, visit_signoff, photo_urls, photo_urls_before, photo_urls_after, clients(name), sites(name, address), service:service_id(name)')
      .eq('id', jobId).eq('company_id', companyId).maybeSingle(),
    supabase.from('job_reports').select('id, employee_id, report_date, start_time, end_time, work_performed, materials_used, employee:employee_id(name, surname)')
      .eq('job_id', jobId).eq('company_id', companyId).order('report_date'),
    supabase.from('time_punches').select('employee_id, type, date_time, employee:employee_id(name, surname)')
      .eq('job_id', jobId).eq('company_id', companyId).order('date_time').limit(2000),
    supabase.from('job_checklist_items').select('description, is_checked, sort_order').eq('job_id', jobId).eq('company_id', companyId).order('sort_order'),
    supabase.from('inventory_usage').select('quantity_used, item:inventory_item_id(name, unit_of_measure)').eq('job_id', jobId).eq('company_id', companyId),
    supabase.from('job_signoffs').select(SIGNOFF_COLUMNS).eq('job_id', jobId).eq('company_id', companyId).order('created_at'),
  ])
  if (job.error || !job.data) throw new Error(job.error?.message ?? 'Job not found.')
  const nm = (e: unknown) => { const x = e as { name?: string; surname?: string } | null; return x ? [x.name, x.surname].filter(Boolean).join(' ') : null }
  const j = job.data as Record<string, unknown>
  // Photos to choose from (the shared bucket paths the job already keeps).
  const photos = [
    ...((j.photo_urls_before as string[] | null) ?? []).map(p => ({ path: p, phase: 'before' as const })),
    ...((j.photo_urls_after as string[] | null) ?? []).map(p => ({ path: p, phase: 'after' as const })),
    ...((j.photo_urls as string[] | null) ?? []).map(p => ({ path: p, phase: 'other' as const })),
  ].filter((p, i, a) => p.path && a.findIndex(x => x.path === p.path) === i)
  return {
    job: {
      code: (j.job_code as string | null) ?? null, title: String(j.title ?? ''),
      client: ((j.clients as { name?: string } | null)?.name) ?? null,
      address: (j.address as string | null) || ((j.sites as { address?: string } | null)?.address ?? null),
      service: ((j.service as { name?: string } | null)?.name) ?? null,
    },
    visitSignoff: (j.visit_signoff as boolean | null) ?? null,
    reports: ((reports.data ?? []) as Record<string, unknown>[]).map(r => ({
      id: String(r.id), employee_id: (r.employee_id as string | null) ?? null, author: nm(r.employee), report_date: String(r.report_date),
      start_time: (r.start_time as string | null) ?? null, end_time: (r.end_time as string | null) ?? null,
      work_performed: String(r.work_performed ?? ''), materials_used: (r.materials_used as string | null) ?? null,
    })) as ReportRow[],
    punches: ((punches.data ?? []) as Record<string, unknown>[]).map(p => ({
      employee_id: String(p.employee_id), name: nm(p.employee) ?? 'Team member', type: String(p.type), date_time: String(p.date_time),
    })) as PunchRow[],
    checklist: (checklist.data ?? []) as { description: string; is_checked: boolean }[],
    parts: ((usage.data ?? []) as Record<string, unknown>[]).map(u => ({
      name: ((u.item as { name?: string } | null)?.name) ?? 'Item', qty: Number(u.quantity_used ?? 0),
      unit: ((u.item as { unit_of_measure?: string } | null)?.unit_of_measure) ?? null,
    })),
    photos,
    signoffs: (signoffs.data ?? []) as Signoff[],
  }
}

export function signoffError(message: string): string {
  if (/REPORT_SIGNED_LOCKED/.test(message)) return 'This report is signed and locked. Make a new version to change it.'
  if (/CLIENT_NAME_REQUIRED/.test(message)) return 'Type the name of the person signing.'
  if (/CLIENT_SIGNATURE_REQUIRED/.test(message)) return 'The client needs to sign in the box.'
  if (/VISIT_ALREADY_SIGNED/.test(message)) return 'This visit is already signed.'
  if (/NOT_ASSIGNED_TO_JOB/.test(message)) return 'You are not assigned to this job.'
  if (/row-level security|permission denied|NOT_ALLOWED/i.test(message)) return 'You don’t have permission to do this.'
  if (/one_open_job_report/.test(message)) return 'There is already a report waiting for signing on this job.'
  return message
}
