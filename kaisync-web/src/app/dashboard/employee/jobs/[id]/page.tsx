'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

// ── Types ──────────────────────────────────────────────────────────────────
interface Job {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  description: string | null
  client_id: string | null
  site_id: string | null
}

interface JobCard {
  id: string | null
  work_performed: string | null
  materials_used: string | null
  photo_urls: string[] | null
  start_time: string | null
  end_time: string | null
  is_completed: boolean
  client_signature_url: string | null
}

interface ChecklistItem {
  id: string
  description: string
  is_checked: boolean
  sort_order: number
}

interface JobDocument {
  id: string
  document_name: string
  document_type: string
  file_url: string
  created_at: string
  signedUrl?: string | null
}

interface SiteVisit {
  id: string
  job_id: string
  sign_in_at: string
  reported_by_name: string | null
}

interface InventoryItem {
  id: string
  name: string
  supplier: string | null
  quantity: number
  unit_cost: number | null
}

interface InventoryUsage {
  inventory_item_id: string
  item_name: string
  supplier: string | null
  quantity: number
  unit_cost: number | null
}

interface Feedback {
  rating: number
  comments: string | null
  created_at: string
}

interface Incident {
  id: string
  title: string
  severity: string | null
  status: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────
function toLocalDateTimeInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: true })
}

const STATUS_STYLES: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  in_progress: 'bg-warning/10 text-warning',
  completed:   'bg-success/10 text-success',
  cancelled:   'bg-error/10 text-error',
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function JobCardPage() {
  const params        = useParams()
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const jobId         = params.id as string

  const [empId,     setEmpId]     = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [token,     setToken]     = useState('')

  const [job,       setJob]       = useState<Job | null>(null)
  const [jobCard,   setJobCard]   = useState<JobCard | null>(null)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [docs,      setDocs]      = useState<JobDocument[]>([])
  const [siteVisit, setSiteVisit] = useState<SiteVisit | null>(null)
  const [inventory, setInventory] = useState<InventoryUsage[]>([])
  const [feedback,  setFeedback]  = useState<Feedback | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])

  const [loading,   setLoading]   = useState(true)
  const [notFound,  setNotFound]  = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Job card form
  const [startTime,      setStartTime]      = useState('')
  const [endTime,        setEndTime]        = useState('')
  const [workPerformed,  setWorkPerformed]  = useState('')
  const [materialsUsed,  setMaterialsUsed]  = useState('')
  const [isCompleted,    setIsCompleted]    = useState(false)
  const [savingCard,     setSavingCard]     = useState(false)

  // On-site modal
  const [siteModalOpen, setSiteModalOpen]   = useState(false)
  const [siteAction,    setSiteAction]      = useState<'sign_in'|'sign_out'|'switch'|'end_other'>('sign_in')
  const [siteName,      setSiteName]        = useState('')
  const [siteLoading,   setSiteLoading]     = useState(false)
  const [siteGeoLat,    setSiteGeoLat]      = useState<number | null>(null)
  const [siteGeoLng,    setSiteGeoLng]      = useState<number | null>(null)

  // Checklist
  const [newCheckItem,  setNewCheckItem]    = useState('')
  const [addingCheck,   setAddingCheck]     = useState(false)

  // Inventory modal
  const [invModalOpen,  setInvModalOpen]    = useState(false)
  const [invItems,      setInvItems]        = useState<InventoryItem[]>([])
  const [invItemId,     setInvItemId]       = useState('')
  const [invQty,        setInvQty]          = useState('')
  const [submittingInv, setSubmittingInv]   = useState(false)

  // Feedback modal
  const [fbModalOpen,   setFbModalOpen]     = useState(false)
  const [fbRating,      setFbRating]        = useState(5)
  const [fbComments,    setFbComments]      = useState('')
  const [submittingFb,  setSubmittingFb]    = useState(false)

  // Photo upload refs
  const beforePhotoRef = useRef<HTMLInputElement>(null)
  const afterPhotoRef  = useRef<HTMLInputElement>(null)
  const docRef         = useRef<HTMLInputElement>(null)

  useEffect(() => { init() }, [jobId])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const { data: { session } } = await supabase.auth.getSession()
    const tok = session?.access_token ?? ''
    setToken(tok)

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)

      const [jobsRes, cardRes, checkRes, docsRes, visitRes, invRes, fbRes, incRes] = await Promise.all([
        rpc('employee_get_jobs_for_employee', { p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
        rpc('employee_get_job_card_for_job',  { p_company_id: member.companyId, p_job_id: jobId, p_employee_id: member.employeeId, p_session_token: tok }),
        rpc('employee_get_checklist_for_job', { p_company_id: member.companyId, p_job_id: jobId, p_employee_id: member.employeeId, p_session_token: tok }),
        supabase.from('job_documents').select('*').eq('company_id', member.companyId).eq('job_id', jobId),
        rpc('employee_job_site_open_visit',   { p_company_id: member.companyId, p_employee_id: member.employeeId, p_session_token: tok }),
        rpc('employee_get_inventory_usage_for_job', { p_company_id: member.companyId, p_job_id: jobId, p_employee_id: member.employeeId, p_session_token: tok }),
        rpc('employee_get_job_feedback',      { p_company_id: member.companyId, p_employee_id: member.employeeId, p_job_id: jobId, p_session_token: tok }),
        supabase.from('incident_reports').select('id,title,severity,status').eq('company_id', member.companyId).eq('job_id', jobId).eq('employee_id', member.employeeId),
      ])

      const foundJob = ((jobsRes.data as Job[]) ?? []).find(j => j.id === jobId)
      if (!foundJob) { setNotFound(true); setLoading(false); return }
      setJob(foundJob)

      const card = (cardRes.data as JobCard[] | null)?.[0] ?? null
      setJobCard(card)
      if (card) {
        setStartTime(toLocalDateTimeInput(card.start_time))
        setEndTime(toLocalDateTimeInput(card.end_time))
        setWorkPerformed(card.work_performed ?? '')
        setMaterialsUsed(card.materials_used ?? '')
        setIsCompleted(card.is_completed)
        // Load signed photo URLs
        if (card.photo_urls?.length) {
          const signed = await Promise.all(card.photo_urls.map(async path => {
            const { data } = await supabase.storage.from('workforce-media').createSignedUrl(path, 3600)
            return data?.signedUrl ?? null
          }))
          setPhotoUrls(signed.filter(Boolean) as string[])
        }
      }

      setChecklist(((checkRes.data as ChecklistItem[]) ?? []).sort((a,b) => a.sort_order - b.sort_order))
      const rawDocs = (docsRes.data as JobDocument[]) ?? []
      const docsWithUrls = await Promise.all(rawDocs.map(async d => {
        const { data: s } = await supabase.storage.from('workforce-media').createSignedUrl(d.file_url, 3600)
        return { ...d, signedUrl: s?.signedUrl ?? null }
      }))
      setDocs(docsWithUrls)
      setSiteVisit((visitRes.data as SiteVisit[] | null)?.[0] ?? null)
      setInventory((invRes.data as InventoryUsage[]) ?? [])
      setFeedback((fbRes.data as Feedback[] | null)?.[0] ?? null)
      setIncidents((incRes.data as Incident[]) ?? [])

    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load job.')
    }
    setLoading(false)
  }

  // ── Job Card save ──────────────────────────────────────────────────────
  async function saveCard() {
    if (!empId || !companyId) return
    setSavingCard(true)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_upsert_job_card', {
        p_company_id:          companyId,
        p_employee_id:         empId,
        p_job_id:              jobId,
        p_start_time:          startTime ? new Date(startTime).toISOString() : null,
        p_end_time:            endTime   ? new Date(endTime).toISOString()   : null,
        p_work_performed:      workPerformed  || null,
        p_materials_used:      materialsUsed  || null,
        p_photo_urls:          jobCard?.photo_urls ?? [],
        p_is_completed:        isCompleted,
        p_client_signature_url: jobCard?.client_signature_url ?? null,
        p_session_token:       token,
      })
      if (rpcErr) throw rpcErr
      await init()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save job card.')
    }
    setSavingCard(false)
  }

  // ── Checklist ──────────────────────────────────────────────────────────
  async function toggleCheckItem(item: ChecklistItem) {
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_update_checklist_item', {
        p_company_id:   companyId,
        p_employee_id:  empId,
        p_job_id:       jobId,
        p_item_id:      item.id,
        p_is_checked:   !item.is_checked,
        p_session_token: token,
      })
      setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, is_checked: !c.is_checked } : c))
    } catch {
      // Fallback: direct update
      await supabase.from('job_checklist_items').update({ is_checked: !item.is_checked }).eq('id', item.id)
      setChecklist(prev => prev.map(c => c.id === item.id ? { ...c, is_checked: !c.is_checked } : c))
    }
  }

  async function addCheckItem() {
    if (!newCheckItem.trim() || !empId || !companyId) return
    setAddingCheck(true)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_insert_checklist_item', {
        p_company_id:    companyId,
        p_employee_id:   empId,
        p_job_id:        jobId,
        p_description:   newCheckItem.trim(),
        p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setNewCheckItem('')
      await init()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add checklist item.')
    }
    setAddingCheck(false)
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  async function uploadPhoto(phase: 'photo_before' | 'photo_after', ref: React.RefObject<HTMLInputElement | null>) {
    const file = ref.current?.files?.[0]
    if (!file || !companyId) return
    const supabase = createClient()
    const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const path = `jobs/${companyId}/${jobId}/${phase}/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: true, contentType: file.type })
    if (upErr) { setError(upErr.message); return }
    await supabase.from('job_documents').insert({
      company_id: companyId, job_id: jobId,
      document_name: file.name, document_type: phase, file_url: path,
    })
    if (ref.current) ref.current.value = ''
    await init()
  }

  async function uploadDoc() {
    const file = docRef.current?.files?.[0]
    if (!file || !companyId) return
    const name = prompt('Document name:', file.name) ?? file.name
    const supabase = createClient()
    const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
    const path = `jobs/${companyId}/${jobId}/docs/${crypto.randomUUID()}.${ext}`
    const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: true })
    if (upErr) { setError(upErr.message); return }
    await supabase.from('job_documents').insert({
      company_id: companyId, job_id: jobId,
      document_name: name, document_type: 'other', file_url: path,
    })
    if (docRef.current) docRef.current.value = ''
    await init()
  }

  // ── On-site flows ──────────────────────────────────────────────────────
  function openSiteModal(action: typeof siteAction) {
    setSiteAction(action); setSiteName(''); setSiteGeoLat(null); setSiteGeoLng(null)
    setSiteModalOpen(true)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { setSiteGeoLat(pos.coords.latitude); setSiteGeoLng(pos.coords.longitude) },
        () => {}
      )
    }
  }

  async function submitSite() {
    if (!empId || !companyId) return
    setSiteLoading(true)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
    try {
      if (siteAction === 'sign_in') {
        const { error: rpcErr } = await rpc('employee_job_site_sign_in', {
          p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
          p_latitude: siteGeoLat, p_longitude: siteGeoLng, p_address: null,
          p_reported_by_name: siteName || null, p_notes: null, p_session_token: token,
        })
        if (rpcErr?.message?.includes('ALREADY_ON_SITE')) {
          if (confirm('You already have an open site visit. Switch to this job instead?')) {
            await rpc('employee_job_site_switch_to_job', {
              p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
              p_latitude: siteGeoLat, p_longitude: siteGeoLng, p_address: null,
              p_reported_by_name: siteName || null, p_session_token: token,
            })
          }
        } else if (rpcErr) throw rpcErr
      } else if (siteAction === 'sign_out') {
        const { error: rpcErr } = await rpc('employee_job_site_sign_out', {
          p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
          p_latitude: siteGeoLat, p_longitude: siteGeoLng, p_address: null, p_session_token: token,
        })
        if (rpcErr) throw rpcErr
      } else if (siteAction === 'switch') {
        const { error: rpcErr } = await rpc('employee_job_site_switch_to_job', {
          p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
          p_latitude: siteGeoLat, p_longitude: siteGeoLng, p_address: null,
          p_reported_by_name: siteName || null, p_session_token: token,
        })
        if (rpcErr) throw rpcErr
      } else if (siteAction === 'end_other') {
        if (!confirm('End your open site visit on the other job?')) { setSiteLoading(false); return }
        const { error: rpcErr } = await rpc('employee_job_site_sign_out_open_visit', {
          p_company_id: companyId, p_employee_id: empId, p_session_token: token,
        })
        if (rpcErr) throw rpcErr
      }
      setSiteModalOpen(false)
      await init()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Site action failed.')
    }
    setSiteLoading(false)
  }

  // ── Inventory ──────────────────────────────────────────────────────────
  async function openInvModal() {
    if (!companyId) return
    const supabase = createClient()
    const { data } = await supabase.from('inventory_items').select('id, name, supplier, unit_cost').eq('company_id', companyId)
    setInvItems((data as InventoryItem[]) ?? [])
    setInvItemId(''); setInvQty('')
    setInvModalOpen(true)
  }

  async function submitInventory() {
    if (!invItemId || !invQty || !empId || !companyId) return
    setSubmittingInv(true)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_set_inventory_usage_for_job', {
        p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
        p_inventory_item_id: invItemId, p_quantity: Number(invQty), p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setInvModalOpen(false)
      await init()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to record inventory.')
    }
    setSubmittingInv(false)
  }

  // ── Feedback ───────────────────────────────────────────────────────────
  async function submitFeedback() {
    if (!empId || !companyId) return
    setSubmittingFb(true)
    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_submit_job_feedback', {
        p_company_id: companyId, p_employee_id: empId, p_job_id: jobId,
        p_rating: fbRating, p_comments: fbComments || null, p_session_token: token,
      })
      if (rpcErr) throw rpcErr
      setFbModalOpen(false)
      await init()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit feedback.')
    }
    setSubmittingFb(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )
  if (notFound || !job) return (
    <div className="flex flex-col items-center justify-center h-64 gap-2 text-text-secondary">
      <span className="material-icons text-[48px] text-text-disabled">work_off</span>
      <p className="text-[14px]">Job not found or you do not have access.</p>
    </div>
  )

  const beforePhotos = docs.filter(d => d.document_type === 'photo_before')
  const afterPhotos  = docs.filter(d => d.document_type === 'photo_after')
  const otherDocs    = docs.filter(d => !['photo_before','photo_after'].includes(d.document_type))

  const isOnThisJob    = !!siteVisit && siteVisit.job_id === jobId
  const isOnOtherJob   = !!siteVisit && siteVisit.job_id !== jobId
  const isNotOnAnySite = !siteVisit

  const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
    <div className="bg-surface border border-divider rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <p className="section-label">{title}</p>
        {action}
      </div>
      {children}
    </div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons">arrow_back</span>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-[18px] font-semibold text-text-primary truncate">{job.title}</h1>
          </div>
          {job.status && (
            <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize shrink-0 ${STATUS_STYLES[job.status] ?? 'bg-surface-elevated text-text-secondary'}`}>
              {job.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {/* ── On-site Status ── */}
        <Section title="On-Site Status">
          <div className="p-4 space-y-3">
            {isNotOnAnySite && (
              <>
                <div className="flex items-center gap-2 text-text-secondary">
                  <span className="material-icons text-[20px] text-text-disabled">location_off</span>
                  <p className="text-[13px]">Not on site for this job</p>
                </div>
                <p className="text-[11px] text-text-disabled italic">Separate from Clock In/Out on your dashboard. Use this to tell your manager you are physically on this job site.</p>
                <button onClick={() => openSiteModal('sign_in')}
                  className="w-full h-10 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors">
                  I&apos;m on this job
                </button>
              </>
            )}
            {isOnThisJob && (
              <>
                <div className="flex items-center gap-2 text-success">
                  <span className="material-icons text-[20px]">location_on</span>
                  <p className="text-[13px] font-semibold">
                    On this job{siteVisit.reported_by_name ? ` as ${siteVisit.reported_by_name}` : ''} since {fmtTime(siteVisit.sign_in_at)}
                  </p>
                </div>
                <button onClick={() => openSiteModal('sign_out')}
                  className="w-full h-10 rounded-xl bg-error text-white text-[14px] font-semibold hover:bg-error/90 transition-colors">
                  Finish on-site
                </button>
              </>
            )}
            {isOnOtherJob && (
              <>
                <div className="flex items-center gap-2 text-warning">
                  <span className="material-icons text-[20px]">swap_horiz</span>
                  <p className="text-[13px]">You are on site at another job since {fmtTime(siteVisit!.sign_in_at)}.</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openSiteModal('switch')}
                    className="flex-1 h-10 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors">
                    Switch to this job
                  </button>
                  <button onClick={() => openSiteModal('end_other')}
                    className="flex-1 h-10 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                    End other visit first
                  </button>
                </div>
              </>
            )}
          </div>
        </Section>

        {/* ── Job Card ── */}
        <Section title="Job Card (Work Record)">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actual Start</label>
                <div className="flex gap-2">
                  <input className="input flex-1 text-[12px]" type="datetime-local" value={startTime}
                    onChange={e => setStartTime(e.target.value)} />
                  <button onClick={() => setStartTime(toLocalDateTimeInput(new Date().toISOString()))}
                    className="text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-surface-elevated border border-divider hover:border-primary transition-colors whitespace-nowrap">
                    Now
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Actual End</label>
                <div className="flex gap-2">
                  <input className="input flex-1 text-[12px]" type="datetime-local" value={endTime}
                    onChange={e => setEndTime(e.target.value)} />
                  <button onClick={() => setEndTime(toLocalDateTimeInput(new Date().toISOString()))}
                    className="text-[11px] font-semibold px-2 py-1.5 rounded-lg bg-surface-elevated border border-divider hover:border-primary transition-colors whitespace-nowrap">
                    Now
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Work Performed</label>
              <textarea className="input resize-none" rows={3} value={workPerformed} onChange={e => setWorkPerformed(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Materials Used</label>
              <textarea className="input resize-none" rows={3} value={materialsUsed} onChange={e => setMaterialsUsed(e.target.value)} />
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" className="w-5 h-5 accent-primary"
                checked={isCompleted} onChange={e => setIsCompleted(e.target.checked)} />
              <span className="text-[14px] font-semibold text-text-primary">Mark as completed</span>
            </label>
            <button onClick={saveCard} disabled={savingCard}
              className="w-full h-10 rounded-xl bg-primary text-white text-[14px] font-semibold hover:bg-primary-dark transition-colors disabled:opacity-60">
              {savingCard ? 'Saving…' : 'Save Job Card'}
            </button>
          </div>
        </Section>

        {/* ── Checklist ── */}
        <Section title="Checklist">
          <div className="divide-y divide-divider">
            {checklist.map(item => (
              <label key={item.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-elevated transition-colors">
                <input type="checkbox" className="w-5 h-5 accent-primary"
                  checked={item.is_checked} onChange={() => toggleCheckItem(item)} />
                <span className={`text-[13px] ${item.is_checked ? 'line-through text-text-disabled' : 'text-text-primary'}`}>
                  {item.description}
                </span>
              </label>
            ))}
            <div className="flex gap-2 px-4 py-3">
              <input className="input flex-1 text-[13px]" type="text" placeholder="Add item…"
                value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCheckItem()} />
              <button onClick={addCheckItem} disabled={addingCheck || !newCheckItem.trim()}
                className="bg-primary text-white font-semibold text-[13px] px-4 rounded-lg disabled:opacity-50 hover:bg-primary-dark transition-colors">
                Add
              </button>
            </div>
          </div>
        </Section>

        {/* ── Photos ── */}
        <Section title="Photos">
          <div className="p-4 space-y-4">
            {/* Before */}
            <div>
              <p className="text-[12px] font-semibold text-text-secondary mb-2">Before</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {beforePhotos.map(d => (
                  <a key={d.id} href={d.signedUrl ?? '#'} target="_blank" rel="noopener noreferrer">
                    <img src={d.signedUrl ?? ''} alt={d.document_name} className="w-full aspect-square object-cover rounded-lg" />
                  </a>
                ))}
              </div>
              <input ref={beforePhotoRef} type="file" accept="image/*" className="hidden"
                onChange={() => uploadPhoto('photo_before', beforePhotoRef)} />
              <button onClick={() => beforePhotoRef.current?.click()}
                className="w-full h-9 rounded-lg border border-dashed border-divider text-[12px] text-text-secondary hover:border-primary hover:text-primary transition-colors">
                + Upload before photo
              </button>
            </div>
            {/* After */}
            <div>
              <p className="text-[12px] font-semibold text-text-secondary mb-2">After</p>
              <div className="grid grid-cols-3 gap-2 mb-2">
                {afterPhotos.map(d => (
                  <a key={d.id} href={d.signedUrl ?? '#'} target="_blank" rel="noopener noreferrer">
                    <img src={d.signedUrl ?? ''} alt={d.document_name} className="w-full aspect-square object-cover rounded-lg" />
                  </a>
                ))}
              </div>
              <input ref={afterPhotoRef} type="file" accept="image/*" className="hidden"
                onChange={() => uploadPhoto('photo_after', afterPhotoRef)} />
              <button onClick={() => afterPhotoRef.current?.click()}
                className="w-full h-9 rounded-lg border border-dashed border-divider text-[12px] text-text-secondary hover:border-primary hover:text-primary transition-colors">
                + Upload after photo
              </button>
            </div>
          </div>
        </Section>

        {/* ── Documents ── */}
        <Section title="Documents" action={
          <>
            <input ref={docRef} type="file" className="hidden" onChange={uploadDoc} />
            <button onClick={() => docRef.current?.click()}
              className="text-[12px] font-semibold text-primary hover:underline">+ Upload</button>
          </>
        }>
          <div className="divide-y divide-divider">
            {otherDocs.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-text-disabled">No documents.</p>
            )}
            {otherDocs.map(d => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className="material-icons text-text-disabled text-[20px]">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{d.document_name}</p>
                  <p className="text-[11px] text-text-disabled capitalize">{d.document_type.replace(/_/g,' ')}</p>
                </div>
                <button onClick={() => d.signedUrl && window.open(d.signedUrl, '_blank')}
                  className="text-[12px] font-semibold text-primary hover:underline shrink-0">Open</button>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Incidents ── */}
        <Section title="Incidents" action={
          <Link href={`/dashboard/employee/incidents/new?jobId=${jobId}&jobTitle=${encodeURIComponent(job.title)}`}
            className="text-[12px] font-semibold text-primary hover:underline">Report</Link>
        }>
          <div className="divide-y divide-divider">
            {incidents.length === 0 && <p className="px-4 py-3 text-[13px] text-text-disabled">No incidents linked to this job.</p>}
            {incidents.map(inc => (
              <Link key={inc.id} href={`/dashboard/employee/incidents/${inc.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-elevated transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary">{inc.title}</p>
                </div>
                {inc.severity && <span className="text-[11px] font-semibold text-error capitalize">{inc.severity}</span>}
              </Link>
            ))}
          </div>
        </Section>

        {/* ── Inventory ── */}
        <Section title="Inventory Used" action={
          <button onClick={openInvModal} className="text-[12px] font-semibold text-primary hover:underline">Record</button>
        }>
          <div className="divide-y divide-divider">
            {inventory.length === 0 && <p className="px-4 py-3 text-[13px] text-text-disabled">No inventory recorded.</p>}
            {inventory.map((inv, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">{inv.item_name}</p>
                  {inv.supplier && <p className="text-[11px] text-text-disabled">{inv.supplier}</p>}
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-text-primary">×{inv.quantity}</p>
                  {inv.unit_cost != null && (
                    <p className="text-[11px] text-text-disabled">R{(inv.unit_cost * inv.quantity).toFixed(2)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Client Feedback ── */}
        <Section title="Client Feedback" action={
          <button onClick={() => { setFbRating(5); setFbComments(''); setFbModalOpen(true) }}
            className="text-[12px] font-semibold text-primary hover:underline">Capture</button>
        }>
          <div className="p-4">
            {!feedback ? (
              <p className="text-[13px] text-text-disabled">No client feedback recorded yet.</p>
            ) : (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  {[1,2,3,4,5].map(s => (
                    <span key={s} className={`material-icons text-[20px] ${s <= feedback.rating ? 'text-warning' : 'text-text-disabled'}`}>star</span>
                  ))}
                  <span className="ml-1 text-[13px] font-semibold text-text-primary">{feedback.rating}/5</span>
                </div>
                {feedback.comments && <p className="text-[13px] text-text-secondary mt-1">"{feedback.comments}"</p>}
                <p className="text-[11px] text-text-disabled mt-1">
                  {new Date(feedback.created_at).toLocaleDateString('en-ZA', {day:'2-digit',month:'short',year:'numeric'})}
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* ── Job Chat ── */}
        <Section title="Job Chat">
          <div className="p-4">
            <button onClick={async () => {
              if (!empId || !companyId) return
              const supabase = createClient()
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const { data } = await (supabase.rpc as any)('get_or_create_job_thread', { p_company_id: companyId, p_job_id: jobId, p_employee_id: empId })
                const threadId = (data as { id?: string }[] | null)?.[0]?.id
                  ?? (data as { id?: string } | null)?.id
                if (threadId) router.push(`/dashboard/messages?threadId=${threadId}`)
                else router.push('/dashboard/messages')
              } catch {
                router.push('/dashboard/messages')
              }
            }} className="w-full h-10 rounded-xl border border-divider text-[14px] font-semibold text-text-primary hover:bg-surface-elevated transition-colors">
              Open job chat
            </button>
          </div>
        </Section>

        <div className="h-4" />
      </div>

      {/* ── On-site Modal ── */}
      {siteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">
                {siteAction === 'sign_in' ? "I'm on this job" : siteAction === 'sign_out' ? 'Finish on-site' : siteAction === 'switch' ? 'Switch to this job' : 'End other visit'}
              </h2>
              <button onClick={() => setSiteModalOpen(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>
            {(siteAction === 'sign_in' || siteAction === 'switch') && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Your Name (optional)</label>
                <input className="input" type="text" value={siteName} onChange={e => setSiteName(e.target.value)} />
              </div>
            )}
            <div className="flex items-center gap-2 text-[12px] text-text-secondary">
              <span className={`material-icons text-[16px] ${siteGeoLat != null ? 'text-success' : 'text-text-disabled'}`}>
                {siteGeoLat != null ? 'location_on' : 'location_off'}
              </span>
              {siteGeoLat != null ? `GPS: ${siteGeoLat.toFixed(4)}, ${siteGeoLng!.toFixed(4)}` : 'Location not captured'}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setSiteModalOpen(false)} disabled={siteLoading}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitSite} disabled={siteLoading}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {siteLoading ? '…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inventory Modal ── */}
      {invModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Record Inventory</h2>
              <button onClick={() => setInvModalOpen(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Item</label>
              <select className="input" value={invItemId} onChange={e => setInvItemId(e.target.value)}>
                <option value="">Select item…</option>
                {invItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Quantity</label>
              <input className="input" type="number" min="1" value={invQty} onChange={e => setInvQty(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setInvModalOpen(false)} disabled={submittingInv}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitInventory} disabled={submittingInv || !invItemId || !invQty}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {submittingInv ? '…' : 'Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Feedback Modal ── */}
      {fbModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-text-primary">Capture Feedback</h2>
              <button onClick={() => setFbModalOpen(false)} className="text-text-secondary hover:text-text-primary">
                <span className="material-icons">close</span>
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Rating</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(n => (
                  <button key={n} onClick={() => setFbRating(n)}
                    className={`flex-1 h-10 rounded-lg font-bold text-[14px] transition-colors ${
                      fbRating === n ? 'bg-warning text-white' : 'bg-surface-elevated border border-divider text-text-secondary'
                    }`}>{n}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Comments (optional)</label>
              <textarea className="input resize-none" rows={3} value={fbComments} onChange={e => setFbComments(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setFbModalOpen(false)} disabled={submittingFb}
                className="flex-1 h-11 rounded-xl border border-divider text-[14px] font-semibold text-text-secondary hover:bg-surface-elevated transition-colors">
                Cancel
              </button>
              <button onClick={submitFeedback} disabled={submittingFb}
                className="flex-1 h-11 rounded-xl bg-primary text-white text-[14px] font-bold hover:bg-primary-dark transition-colors disabled:opacity-60">
                {submittingFb ? '…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
