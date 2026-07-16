'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Manager {
  id: string
  full_name: string
  position: string | null
}

interface Job {
  id: string
  title: string
}

const SEVERITIES  = ['low', 'medium', 'high', 'critical']
const CATEGORIES  = ['injury', 'property_damage', 'near_miss', 'environmental', 'security', 'other']

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function nowTimeStr(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export default function NewIncidentPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const prefillJobId = searchParams.get('jobId') ?? ''
  const photoRef     = useRef<HTMLInputElement>(null)

  // Fields
  const [title,             setTitle]             = useState('')
  const [description,       setDescription]       = useState('')
  const [severity,          setSeverity]          = useState('medium')
  const [category,          setCategory]          = useState('')
  const [occurredDate,      setOccurredDate]      = useState(todayStr())
  const [occurredTime,      setOccurredTime]      = useState(nowTimeStr())
  const [location,          setLocation]          = useState('')
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [selectedJobId,     setSelectedJobId]     = useState(prefillJobId)

  // GPS
  const [geoLat,    setGeoLat]    = useState<number | null>(null)
  const [geoLng,    setGeoLng]    = useState<number | null>(null)
  const [geoLoading,setGeoLoading]= useState(false)

  // Options
  const [managers, setManagers] = useState<Manager[]>([])
  const [jobs,     setJobs]     = useState<Job[]>([])

  // State
  const [loading,    setLoading]    = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Member refs for submit
  const empIdRef  = useRef<string | null>(null)
  const compIdRef = useRef<string | null>(null)

  useEffect(() => { init() }, [])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    empIdRef.current  = member.employeeId
    compIdRef.current = member.companyId

    const [managersRes, jobsRes] = await Promise.all([
      supabase.from('employees')
        .select('id, full_name, position')
        .eq('company_id', member.companyId)
        .in('access_level', ['manager', 'hr', 'owner'])
        .order('full_name'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)('employee_get_jobs_for_employee', {
        p_employee_id: member.employeeId,
        p_company_id:  member.companyId,
      }),
    ])

    setManagers((managersRes.data as Manager[]) ?? [])
    setJobs((jobsRes.data as Job[]) ?? [])
    setLoading(false)
  }

  function getLocation() {
    if (!navigator.geolocation) { setError('Geolocation not supported.'); return }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setGeoLat(pos.coords.latitude); setGeoLng(pos.coords.longitude); setGeoLoading(false) },
      () => { setError('Could not get location.'); setGeoLoading(false) }
    )
  }

  async function submit() {
    if (!description.trim()) { setError('Description is required.'); return }
    const empId  = empIdRef.current
    const compId = compIdRef.current
    if (!empId || !compId) { setError('Not linked to an employee record.'); return }

    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    // Get employee full name
    const { data: empData } = await supabase
      .from('employees')
      .select('full_name')
      .eq('id', empId)
      .single()

    // Upload photos
    const photoUrls: string[] = []
    const files = photoRef.current?.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `incident-photos/${compId}/${empId}/${Date.now()}_${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: true })
        if (upErr) { setError(upErr.message); setSubmitting(false); return }
        photoUrls.push(path)
      }
    }

    // Combine date + time into timestamptz
    const occurredAt = (occurredDate && occurredTime)
      ? new Date(`${occurredDate}T${occurredTime}:00`).toISOString()
      : new Date().toISOString()

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_insert_incident', {
        p_company_id:       compId,
        p_employee_id:      empId,
        p_description:      description.trim(),
        p_severity:         severity,
        p_job_id:           selectedJobId || null,
        p_site_id:          null,
        p_assignee_id:      selectedManagerId || null,
        p_photo_urls:       photoUrls.length > 0 ? photoUrls : null,
        p_reported_by_name: empData?.full_name ?? null,
        p_title:            title.trim() || null,
        p_category:         category || null,
        p_occurred_at:      occurredAt,
        p_latitude:         geoLat,
        p_longitude:        geoLng,
        p_location_text:    location.trim() || null,
        p_session_token:    session?.access_token ?? null,
      })
      if (rpcErr) throw rpcErr
      router.push('/dashboard/employee/incidents')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit incident.')
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

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

        {/* Incident Details */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Incident Details</p>
          </div>
          <div className="p-4 space-y-4">
            {/* Title — optional */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Title</label>
              <input className="input" type="text" placeholder="Brief title (optional)"
                value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            {/* Description — required */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Description *</label>
              <textarea className="input resize-none" rows={4}
                placeholder="What happened? Include all relevant details."
                value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            {/* Severity */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Severity</label>
              <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                {SEVERITIES.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
            {/* Category */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Category</label>
              <select className="input" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Select category</option>
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                ))}
              </select>
            </div>
            {/* Date + Time */}
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
            {/* Location */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Location</label>
              <input className="input" type="text" placeholder="Where did this happen?"
                value={location} onChange={e => setLocation(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Assignment */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Assignment (optional)</p>
          </div>
          <div className="p-4 space-y-4">
            {/* Assigned to manager */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Assign To</label>
              <select className="input" value={selectedManagerId} onChange={e => setSelectedManagerId(e.target.value)}>
                <option value="">None</option>
                {managers.map(m => (
                  <option key={m.id} value={m.id}>{m.full_name}{m.position ? ` — ${m.position}` : ''}</option>
                ))}
              </select>
            </div>
            {/* Linked job */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Job</label>
              <select className="input" value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)}>
                <option value="">None</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* GPS Location */}
        <div className="bg-surface border border-divider rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-text-primary">GPS Location</p>
            {geoLat != null ? (
              <p className="text-[12px] text-success mt-0.5">{geoLat.toFixed(5)}, {geoLng!.toFixed(5)}</p>
            ) : (
              <p className="text-[12px] text-text-secondary mt-0.5">Not captured</p>
            )}
          </div>
          <button onClick={getLocation} disabled={geoLoading}
            className="flex items-center gap-1.5 bg-surface-elevated border border-divider text-[13px] font-semibold text-text-primary px-3 py-2 rounded-lg hover:border-primary transition-colors disabled:opacity-60">
            {geoLoading ? (
              <span className="material-icons animate-spin text-[16px]">refresh</span>
            ) : (
              <span className="material-icons text-[16px]">my_location</span>
            )}
            {geoLat != null ? 'Refresh' : 'Capture'}
          </button>
        </div>

        {/* Photos */}
        <div className="bg-surface border border-divider rounded-xl p-4">
          <p className="text-[13px] font-semibold text-text-primary mb-2">Photos (optional)</p>
          <input ref={photoRef} type="file" accept="image/*" multiple className="text-[13px] text-text-secondary" />
        </div>

        <button onClick={submit} disabled={submitting || !description.trim()}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60">
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
