'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession } from '@/lib/auth/code-session'
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
  access_level?: string | null
  is_active?: boolean | null
}

interface JobOption {
  id: string
  title: string
  site_id?: string | null
  status?: string | null
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

export default function HrNewIncidentPage() {
  const router = useRouter()
  const photoRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState('low')
  const [category, setCategory] = useState('general')
  const [occurredDate, setOccurredDate] = useState(todayStr())
  const [occurredTime, setOccurredTime] = useState(nowTimeStr())
  const [location, setLocation] = useState('')
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedSiteId, setSelectedSiteId] = useState('')
  const [captureGps, setCaptureGps] = useState(true)

  const [geoLat, setGeoLat] = useState<number | null>(null)
  const [geoLng, setGeoLng] = useState<number | null>(null)
  const [geoLoading, setGeoLoading] = useState(false)

  const [managers, setManagers] = useState<Manager[]>([])
  const [jobs, setJobs] = useState<JobOption[]>([])
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

  useEffect(() => { void init() }, [])

  useEffect(() => {
    if (!captureGps || geoLat != null) return
    captureLocation(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureGps])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); setError('not_linked'); return }

    empIdRef.current = member.employeeId
    compIdRef.current = member.companyId
    isCodeAuthRef.current = member.sessionToken !== null
    tokRef.current = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null

    const [{ data: empRows }, { data: jobRows }, { data: clientRows }] = await Promise.all([
      supabase
        .from('employees')
        .select('id, name, surname, access_level, is_active')
        .eq('company_id', member.companyId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('jobs')
        .select('id, title, site_id, status')
        .eq('company_id', member.companyId)
        .in('status', ['open', 'scheduled', 'in_progress'])
        .order('title'),
      supabase
        .from('clients')
        .select('id, name')
        .eq('company_id', member.companyId)
        .order('name'),
    ])

    setManagers(
      ((empRows ?? []) as Manager[]).filter(e =>
        MGMT.includes((e.access_level ?? '').toLowerCase()),
      ),
    )
    setJobs((jobRows ?? []) as JobOption[])
    setClients((clientRows ?? []) as ClientOption[])
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
      setTimeout(() => router.push('/dashboard/incidents'), 1200)
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
      router.push('/dashboard/incidents')
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
        setTimeout(() => router.push('/dashboard/incidents'), 1200)
        return
      }

      setError(msg.includes('DESCRIPTION_REQUIRED') ? 'Description is required.' : msg)
      setSubmitting(false)
    }
  }

  if (error === 'not_linked') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-2">
          <span className="material-icons text-[48px] text-text-disabled">person_off</span>
          <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-[13px] text-text-secondary">Loading…</div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/incidents" className="text-text-secondary hover:text-text-primary transition-colors">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary">New Incident</h1>
        </div>
        <button
          onClick={submit}
          disabled={submitting}
          className="h-10 px-5 text-[14px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
        >
          {submitting ? 'Saving…' : 'Submit'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        {error && error !== 'not_linked' && (
          <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[13px] text-error">{error}</div>
        )}
        {offlineSaved && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
            Saved offline — will sync when back online.
          </div>
        )}

        <section className="card p-4 space-y-3">
          <p className="section-label">DETAILS</p>
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} className="dark-entry w-full" placeholder="Optional short title" />
          </Field>
          <Field label="Description *">
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="dark-entry w-full min-h-[120px]"
              placeholder="What happened?"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Severity">
              <select value={severity} onChange={e => setSeverity(e.target.value)} className="dark-entry w-full">
                {INCIDENT_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Category">
              <select value={category} onChange={e => setCategory(e.target.value)} className="dark-entry w-full">
                {INCIDENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Occurred date">
              <input type="date" value={occurredDate} onChange={e => setOccurredDate(e.target.value)} className="dark-entry w-full" />
            </Field>
            <Field label="Occurred time">
              <input type="time" value={occurredTime} onChange={e => setOccurredTime(e.target.value)} className="dark-entry w-full" />
            </Field>
          </div>
        </section>

        <section className="card p-4 space-y-3">
          <p className="section-label">CONTEXT</p>
          <Field label="Assign to manager">
            <select value={selectedManagerId} onChange={e => setSelectedManagerId(e.target.value)} className="dark-entry w-full">
              <option value="">Unassigned</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>{m.name} {m.surname}</option>
              ))}
            </select>
          </Field>
          <Field label="Linked job">
            <select value={selectedJobId} onChange={e => onJobChange(e.target.value)} className="dark-entry w-full">
              <option value="">None</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
            </select>
          </Field>
          <Field label="Client">
            <select value={selectedClientId} onChange={e => onClientChange(e.target.value)} className="dark-entry w-full">
              <option value="">None</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {sites.length > 0 && (
            <Field label="Site">
              <select value={selectedSiteId} onChange={e => setSelectedSiteId(e.target.value)} className="dark-entry w-full">
                <option value="">None</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Location text">
            <input value={location} onChange={e => setLocation(e.target.value)} className="dark-entry w-full" />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text-primary">
            <input type="checkbox" checked={captureGps} onChange={e => setCaptureGps(e.target.checked)} />
            Capture GPS
            {geoLoading && <span className="text-text-secondary text-[12px]">Locating…</span>}
            {!geoLoading && geoLat != null && geoLng != null && (
              <span className="text-text-secondary text-[12px]">{geoLat.toFixed(5)}, {geoLng.toFixed(5)}</span>
            )}
          </label>
          {captureGps && (
            <button type="button" onClick={() => captureLocation(false)} className="text-[13px] text-primary hover:opacity-70 w-fit">
              Refresh location
            </button>
          )}
          <Field label="Photos">
            <input ref={photoRef} type="file" accept="image/*" multiple className="text-[13px] text-text-secondary" />
          </Field>
        </section>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-text-secondary font-medium">{label}</label>
      {children}
    </div>
  )
}
