'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import { isOpenJob } from '@/lib/job-ownership'
import {
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
} from '@/lib/incident-types'
import { uploadIncidentPhoto } from '@/lib/incident-media'
import {
  enqueueIncident,
  fileToQueuedPhoto,
  shouldQueueIncidentFailure,
} from '@/lib/incident-queue'

interface Manager {
  id: string
  name: string
  surname: string
  position: string | null
  access_level?: string | null
  is_active?: boolean | null
}

interface Job {
  id: string
  title: string
  status?: string | null
  site_id?: string | null
  client_id?: string | null
}

interface ClientOption {
  id: string
  name: string
}

interface SiteOption {
  id: string
  name: string
  client_id: string | null
}

const MGMT = ['manager', 'hr', 'hr_admin', 'owner', 'admin']

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function labelCategory(c: string): string {
  return c.charAt(0).toUpperCase() + c.slice(1)
}

export default function NewIncidentPage() {
  const allowed = useEmployeeModuleGate('incidents')
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillJobId = searchParams.get('jobId') ?? ''
  const prefillJobTitle = searchParams.get('jobTitle') ?? ''
  const isJobLinkedFlow = !!prefillJobId
  const photoRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('low')
  const [category, setCategory] = useState('general')
  const [occurredDate, setOccurredDate] = useState(todayStr())
  const [occurredTime, setOccurredTime] = useState(nowTimeStr())
  const [location, setLocation] = useState('')
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [selectedJobId, setSelectedJobId] = useState(prefillJobId)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [jobTitleBanner, setJobTitleBanner] = useState(prefillJobTitle)
  const [captureGps, setCaptureGps] = useState(true)

  const [geoLat, setGeoLat] = useState<number | null>(null)
  const [geoLng, setGeoLng] = useState<number | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)

  const [managers, setManagers] = useState<Manager[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [clients, setClients] = useState<ClientOption[]>([])
  const [sites, setSites] = useState<SiteOption[]>([])

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offlineSaved, setOfflineSaved] = useState(false)

  const empIdRef = useRef<string | null>(null)
  const compIdRef = useRef<string | null>(null)
  const tokRef = useRef<string | null>(null)
  const isCodeAuthRef = useRef(false)

  useEffect(() => {
    if (allowed !== true) return
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])

  useEffect(() => {
    if (!captureGps || geoLat != null) return
    captureLocation(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureGps])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    empIdRef.current = member.employeeId
    compIdRef.current = member.companyId
    isCodeAuthRef.current = member.sessionToken !== null

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)

    if (isJobLinkedFlow) {
      const jobRes = await rpc('employee_get_job_for_employee', {
        p_company_id: member.companyId,
        p_employee_id: member.employeeId,
        p_job_id: prefillJobId,
        p_session_token: tok,
      })
      const job = ((jobRes.data as Job[]) ?? [])[0] ?? null
      if (job) {
        setJobTitleBanner(job.title || prefillJobTitle)
        setSelectedJobId(job.id)
        if (job.site_id) setSelectedSiteId(job.site_id)
      }
      const peersRes = await rpc('employee_list_company_peers', {
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      })
      setManagers(
        ((peersRes.data as Manager[]) ?? []).filter(
          e => MGMT.includes((e.access_level ?? '').toLowerCase()) && e.is_active !== false,
        ),
      )
    } else {
      const [peersRes, jobsRes] = await Promise.all([
        rpc('employee_list_company_peers', {
          p_employee_id: member.employeeId,
          p_company_id: member.companyId,
          p_session_token: tok,
        }),
        rpc('employee_get_jobs_for_employee', {
          p_employee_id: member.employeeId,
          p_company_id: member.companyId,
          p_session_token: tok,
        }),
      ])
      setManagers(
        ((peersRes.data as Manager[]) ?? []).filter(
          e => MGMT.includes((e.access_level ?? '').toLowerCase()) && e.is_active !== false,
        ),
      )
      const openJobs = ((jobsRes.data as Job[]) ?? []).filter(j => isOpenJob(j))
      setJobs(openJobs)

      const { data: clientRows } = await supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', member.companyId)
        .order('name')
      setClients((clientRows as ClientOption[]) ?? [])
    }

    setLoading(false)
  }

  async function onClientChange(clientId: string) {
    setSelectedClientId(clientId)
    setSelectedSiteId('')
    setSites([])
    if (!clientId || !compIdRef.current) return
    const supabase = createClient()
    const { data } = await supabase
      .from('sites')
      .select('id, name, client_id')
      .eq('company_id', compIdRef.current)
      .eq('client_id', clientId)
      .order('name')
    setSites((data as SiteOption[]) ?? [])
  }

  function onJobChange(jobId: string) {
    setSelectedJobId(jobId)
    const job = jobs.find(j => j.id === jobId)
    if (job?.site_id) setSelectedSiteId(job.site_id)
  }

  function captureLocation(silent = false) {
    if (!navigator.geolocation) {
      if (!silent) setError('Geolocation not supported.')
      return
    }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeoLat(pos.coords.latitude)
        setGeoLng(pos.coords.longitude)
        setGeoLoading(false)
      },
      () => {
        if (!silent) setError('Could not get location.')
        setGeoLoading(false)
      },
      { enableHighAccuracy: true, timeout: 12000 },
    )
  }

  async function resolveReporterName(empId: string): Promise<string | null> {
    if (isCodeAuthRef.current) {
      const cs = getCodeSession()
      if (cs?.employee?.name) {
        return `${cs.employee.name}${cs.employee.surname ? ` ${cs.employee.surname}` : ''}`.trim()
      }
    }
    const supabase = createClient()
    const { data: empData } = await supabase
      .from('employees')
      .select('name, surname')
      .eq('id', empId)
      .maybeSingle()
    if (empData) return `${empData.name} ${empData.surname}`.trim()
    return null
  }

  async function submit() {
    if (!description.trim()) { setError('Description is required.'); return }
    const empId = empIdRef.current
    const compId = compIdRef.current
    if (!empId || !compId) { setError('Not linked to an employee record.'); return }

    setSubmitting(true)
    setError(null)
    setOfflineSaved(false)

    const supabase = createClient()
    const reporterName = await resolveReporterName(empId)
    const occurredAt = (occurredDate && occurredTime)
      ? new Date(`${occurredDate}T${occurredTime}:00`).toISOString()
      : new Date().toISOString()

    const jobId = selectedJobId || null
    const siteId = selectedSiteId || (jobs.find(j => j.id === selectedJobId)?.site_id ?? null)

    const files = photoRef.current?.files
    const fileList = files ? Array.from(files) : []

    // Offline enqueue (MAUI PendingIncident)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const photos = []
      for (const f of fileList) photos.push(await fileToQueuedPhoto(f))
      enqueueIncident({
        local_id: crypto.randomUUID(),
        company_id: compId,
        employee_id: empId,
        description: description.trim(),
        severity,
        category: category || 'general',
        title: title.trim() || null,
        job_id: jobId,
        site_id: siteId,
        assignee_id: selectedManagerId || null,
        reported_by_name: reporterName,
        occurred_at: occurredAt,
        latitude: captureGps ? geoLat : null,
        longitude: captureGps ? geoLng : null,
        location_text: location.trim() || null,
        photos,
        queued_at: new Date().toISOString(),
      })
      setOfflineSaved(true)
      setSubmitting(false)
      setTimeout(() => router.push('/dashboard/employee/incidents'), 1200)
      return
    }

    try {
      const photoUrls: string[] = []
      for (const file of fileList) {
        const path = await uploadIncidentPhoto({
          supabase,
          companyId: compId,
          employeeId: empId,
          file,
          sessionToken: tokRef.current,
          softFail: true,
        })
        if (path) photoUrls.push(path)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_insert_incident', {
        p_company_id: compId,
        p_employee_id: empId,
        p_description: description.trim(),
        p_severity: severity,
        p_job_id: jobId,
        p_site_id: siteId,
        p_assignee_id: selectedManagerId || null,
        p_photo_urls: photoUrls.length > 0 ? photoUrls : null,
        p_reported_by_name: reporterName,
        p_title: title.trim() || null,
        p_category: category || 'general',
        p_occurred_at: occurredAt,
        p_latitude: captureGps ? geoLat : null,
        p_longitude: captureGps ? geoLng : null,
        p_location_text: location.trim() || null,
        p_session_token: tokRef.current,
      })
      if (rpcErr) throw rpcErr
      router.push('/dashboard/employee/incidents')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : (typeof e === 'object' && e && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Failed to submit incident.')

      if (shouldQueueIncidentFailure(msg)) {
        const photos = []
        for (const f of fileList) photos.push(await fileToQueuedPhoto(f))
        enqueueIncident({
          local_id: crypto.randomUUID(),
          company_id: compId,
          employee_id: empId,
          description: description.trim(),
          severity,
          category: category || 'general',
          title: title.trim() || null,
          job_id: jobId,
          site_id: siteId,
          assignee_id: selectedManagerId || null,
          reported_by_name: reporterName,
          occurred_at: occurredAt,
          latitude: captureGps ? geoLat : null,
          longitude: captureGps ? geoLng : null,
          location_text: location.trim() || null,
          photos,
          queued_at: new Date().toISOString(),
        })
        setOfflineSaved(true)
        setSubmitting(false)
        setTimeout(() => router.push('/dashboard/employee/incidents'), 1200)
        return
      }

      const friendly = msg.includes('NOT_ASSIGNED_TO_JOB')
        ? 'You are not assigned to that job.'
        : msg.includes('DESCRIPTION_REQUIRED')
          ? 'Description is required.'
          : msg
      setError(friendly)
      setSubmitting(false)
    }
  }

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary">Report Incident</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}
        {offlineSaved && (
          <div className="rounded-xl px-4 py-3 bg-warning/10 border border-warning/30">
            <p className="text-[13px] text-warning font-semibold">
              Saved offline. It will sync when you are back online.
            </p>
          </div>
        )}

        {isJobLinkedFlow && (
          <div className="rounded-xl px-4 py-3 bg-primary/10 border border-primary/20">
            <p className="text-[12px] text-primary font-semibold">
              Linked to job: {jobTitleBanner || 'Selected job'}
            </p>
          </div>
        )}

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Incident Details</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Title</label>
              <input
                className="input"
                type="text"
                placeholder="Brief title (optional)"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Description *</label>
              <textarea
                className="input resize-none"
                rows={4}
                placeholder="What happened? Include all relevant details."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Severity</label>
              <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                {INCIDENT_SEVERITIES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                {INCIDENT_CATEGORIES.map(c => (
                  <option key={c} value={c}>{labelCategory(c)}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Occurred Date</label>
                <input className="input" type="date" value={occurredDate} onChange={e => setOccurredDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Time</label>
                <input className="input" type="time" value={occurredTime} onChange={e => setOccurredTime(e.target.value)} />
              </div>
            </div>
            {!isJobLinkedFlow && (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Location notes</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Where did this happen?"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Assignment (optional)</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Notify / Assign To</label>
              <select className="input" value={selectedManagerId} onChange={e => setSelectedManagerId(e.target.value)}>
                <option value="">None</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.surname}{m.position ? ` — ${m.position}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {!isJobLinkedFlow && (
              <>
                {clients.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Client</label>
                    <select
                      className="input"
                      value={selectedClientId}
                      onChange={e => void onClientChange(e.target.value)}
                    >
                      <option value="">None</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}
                {sites.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Site</label>
                    <select className="input" value={selectedSiteId} onChange={e => setSelectedSiteId(e.target.value)}>
                      <option value="">None</option>
                      {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Job</label>
                  <select className="input" value={selectedJobId} onChange={e => onJobChange(e.target.value)}>
                    <option value="">None</option>
                    {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        </div>

        {!isJobLinkedFlow && (
          <div className="bg-surface border border-divider rounded-xl p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-text-primary">Capture GPS</p>
              {geoLat != null ? (
                <p className="text-[12px] text-success mt-0.5">{geoLat.toFixed(5)}, {geoLng!.toFixed(5)}</p>
              ) : (
                <p className="text-[12px] text-text-secondary mt-0.5">
                  {captureGps ? (geoLoading ? 'Capturing…' : 'Waiting for location') : 'Off'}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => captureLocation(false)}
                disabled={geoLoading || !captureGps}
                className="flex items-center gap-1.5 bg-surface-elevated border border-divider text-[13px] font-semibold text-text-primary px-3 py-2 rounded-lg hover:border-primary transition-colors disabled:opacity-60"
              >
                <span className={`material-icons text-[16px] ${geoLoading ? 'animate-spin' : ''}`}>
                  {geoLoading ? 'refresh' : 'my_location'}
                </span>
                Refresh
              </button>
              <label className="flex items-center gap-2 text-[13px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={captureGps}
                  onChange={e => setCaptureGps(e.target.checked)}
                />
                On
              </label>
            </div>
          </div>
        )}

        <div className="bg-surface border border-divider rounded-xl p-4">
          <p className="text-[13px] font-semibold text-text-primary mb-2">Photos (optional)</p>
          <input ref={photoRef} type="file" accept="image/*" multiple className="text-[13px] text-text-secondary" />
        </div>

        <button
          onClick={() => void submit()}
          disabled={submitting || !description.trim()}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
