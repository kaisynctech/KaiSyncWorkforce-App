'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

export default function NewIncidentPage() {
  const router = useRouter()

  const [title,       setTitle]       = useState('')
  const [severity,    setSeverity]    = useState('medium')
  const [description, setDescription] = useState('')
  const [location,    setLocation]    = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [geoLat,      setGeoLat]      = useState<number | null>(null)
  const [geoLng,      setGeoLng]      = useState<number | null>(null)
  const [geoLoading,  setGeoLoading]  = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  function getLocation() {
    if (!navigator.geolocation) { setError('Geolocation not supported.'); return }
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setGeoLat(pos.coords.latitude)
        setGeoLng(pos.coords.longitude)
        setGeoLoading(false)
      },
      () => { setError('Could not get location.'); setGeoLoading(false) }
    )
  }

  async function submit() {
    if (!title.trim()) { setError('Title is required.'); return }
    setSubmitting(true)
    setError(null)

    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('Not linked to an employee record.'); setSubmitting(false); return }

    const photoUrls: string[] = []
    const files = photoRef.current?.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        const path = `incident-photos/${member.companyId}/${member.employeeId}/${Date.now()}_${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('workforce-media').upload(path, file, { upsert: true })
        if (upErr) { setError(upErr.message); setSubmitting(false); return }
        photoUrls.push(path)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('employee_insert_incident', {
      p_employee_id:  member.employeeId,
      p_company_id:   member.companyId,
      p_title:        title.trim(),
      p_severity:     severity,
      p_description:  description || null,
      p_location:     location || null,
      p_incident_date: incidentDate || null,
      p_latitude:     geoLat,
      p_longitude:    geoLng,
      p_photo_urls:   photoUrls.length > 0 ? photoUrls : null,
    })

    if (rpcErr) {
      setError(rpcErr.message)
      setSubmitting(false)
    } else {
      router.push('/dashboard/employee/incidents')
    }
  }

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

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Incident Details</p>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Title *</label>
              <input className="input" type="text" placeholder="Brief description of the incident"
                value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Severity</label>
              <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Incident Date</label>
              <input className="input" type="date" value={incidentDate} onChange={e => setIncidentDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Location</label>
              <input className="input" type="text" placeholder="Where did this happen?"
                value={location} onChange={e => setLocation(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Description</label>
              <textarea className="input resize-none" rows={4} placeholder="What happened? Include any relevant details."
                value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Location */}
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

        <button onClick={submit} disabled={submitting}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60">
          {submitting ? 'Submitting…' : 'Submit Report'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
