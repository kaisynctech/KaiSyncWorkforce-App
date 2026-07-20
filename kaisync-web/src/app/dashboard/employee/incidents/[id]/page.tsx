'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Incident {
  id: string
  title: string
  severity: string | null
  status: string | null
  occurred_at: string | null
  location_text: string | null
  description: string | null
  created_at: string
  photo_urls: string[] | null
}

interface Comment {
  id: string
  author_name: string
  body: string
  created_at: string
}

interface StatusEntry {
  status: string
  changed_at: string
  changed_by_name: string | null
  notes: string | null
}

const SEVERITY_STYLES: Record<string, string> = {
  low:      'bg-surface-elevated text-text-secondary',
  medium:   'bg-warning/10 text-warning',
  high:     'bg-error/10 text-error',
  critical: 'bg-error text-white',
}
const STATUS_STYLES: Record<string, string> = {
  open:        'bg-primary/10 text-primary',
  under_review:'bg-warning/10 text-warning',
  resolved:    'bg-success/10 text-success',
  closed:      'bg-surface-elevated text-text-secondary',
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function IncidentDetailPage() {
  const params   = useParams()
  const router   = useRouter()
  const incId    = params.id as string

  const [incident,   setIncident]   = useState<Incident | null>(null)
  const [comments,   setComments]   = useState<Comment[]>([])
  const [history,    setHistory]    = useState<StatusEntry[]>([])
  const [photoUrls,  setPhotoUrls]  = useState<string[]>([])
  const [loading,    setLoading]    = useState(true)
  const [comment,    setComment]    = useState('')
  const [sending,    setSending]    = useState(false)
  const [empId,      setEmpId]      = useState<string | null>(null)
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const tokRef   = useRef<string | null>(null)

  useEffect(() => { init() }, [incId])

  async function init() {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }
    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
    const [incRes, cRes, hRes] = await Promise.all([
      rpc('employee_get_incident', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_get_incident_comments', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
      rpc('employee_get_incident_status_history', { p_incident_id: incId, p_employee_id: member.employeeId, p_company_id: member.companyId, p_session_token: tok }),
    ])

    const inc = ((incRes.data as Incident[] | null)?.[0]) ?? null
    setIncident(inc)
    setComments((cRes.data as Comment[]) ?? [])
    setHistory((hRes.data as StatusEntry[]) ?? [])

    if (inc?.photo_urls && inc.photo_urls.length > 0) {
      const signed = await Promise.all(inc.photo_urls.map(async (path: string) => {
        const { data } = await supabase.storage.from('workforce-media').createSignedUrl(path, 3600)
        return data?.signedUrl ?? null
      }))
      setPhotoUrls(signed.filter(Boolean) as string[])
    }

    setLoading(false)
  }

  async function addComment() {
    if (!comment.trim() || !empId || !companyId) return
    setSending(true)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.rpc as any)('employee_add_incident_comment', {
      p_incident_id:   incId,
      p_employee_id:   empId,
      p_company_id:    companyId,
      p_body:          comment.trim(),
      p_session_token: tokRef.current,
    })
    setComment('')
    await init()
    setSending(false)
  }

  async function appendPhotos() {
    const files = photoRef.current?.files
    if (!files || files.length === 0 || !empId || !companyId) return
    const supabase = createClient()
    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const path = `incident-photos/${companyId}/${empId}/${Date.now()}_${i}.${ext}`
      await supabase.storage.from('workforce-media').upload(path, file, { upsert: true })
      paths.push(path)
    }
    if (paths.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.rpc as any)('employee_append_incident_photos', {
        p_incident_id:   incId,
        p_employee_id:   empId,
        p_company_id:    companyId,
        p_photo_urls:    paths,
        p_session_token: tokRef.current,
      })
      await init()
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )
  if (!incident) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Incident not found.</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary truncate flex-1">{incident.title}</h1>
        <div className="flex gap-2 shrink-0">
          {incident.severity && (
            <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${SEVERITY_STYLES[incident.severity] ?? ''}`}>
              {incident.severity}
            </span>
          )}
          {incident.status && (
            <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_STYLES[incident.status] ?? ''}`}>
              {incident.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">

        {/* Details */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Details</p>
          </div>
          <div className="p-4 space-y-3">
            {incident.occurred_at && (
              <div className="flex gap-3">
                <span className="material-icons text-text-disabled text-[18px] mt-0.5">event</span>
                <div>
                  <p className="text-[11px] text-text-disabled uppercase font-semibold">Incident Date</p>
                  <p className="text-[13px] text-text-primary mt-0.5">
                    {new Date(incident.occurred_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </p>
                </div>
              </div>
            )}
            {incident.location_text && (
              <div className="flex gap-3">
                <span className="material-icons text-text-disabled text-[18px] mt-0.5">location_on</span>
                <div>
                  <p className="text-[11px] text-text-disabled uppercase font-semibold">Location</p>
                  <p className="text-[13px] text-text-primary mt-0.5">{incident.location_text}</p>
                </div>
              </div>
            )}
            {incident.description && (
              <div className="flex gap-3">
                <span className="material-icons text-text-disabled text-[18px] mt-0.5">description</span>
                <div>
                  <p className="text-[11px] text-text-disabled uppercase font-semibold">Description</p>
                  <p className="text-[13px] text-text-primary mt-0.5 leading-relaxed">{incident.description}</p>
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <span className="material-icons text-text-disabled text-[18px] mt-0.5">schedule</span>
              <div>
                <p className="text-[11px] text-text-disabled uppercase font-semibold">Reported</p>
                <p className="text-[13px] text-text-primary mt-0.5">{fmtFull(incident.created_at)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Photos */}
        {photoUrls.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Photos</p>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {photoUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Append photos */}
        <div className="bg-surface border border-divider rounded-xl p-4">
          <p className="text-[13px] font-semibold text-text-primary mb-2">Add Photos</p>
          <div className="flex gap-3 items-center">
            <input ref={photoRef} type="file" accept="image/*" multiple className="flex-1 text-[13px] text-text-secondary" />
            <button onClick={appendPhotos}
              className="bg-primary text-white text-[13px] font-semibold px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors">
              Upload
            </button>
          </div>
        </div>

        {/* Status History */}
        {history.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Status History</p>
            </div>
            <div className="divide-y divide-divider">
              {history.map((h, i) => (
                <div key={i} className="px-4 py-3 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-primary mt-[6px] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary capitalize">{h.status.replace(/_/g, ' ')}</p>
                    <p className="text-[11px] text-text-disabled mt-0.5">{fmtFull(h.changed_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</p>
                    {h.notes && <p className="text-[12px] text-text-secondary mt-0.5">{h.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Comments ({comments.length})</p>
          </div>
          <div className="divide-y divide-divider">
            {comments.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[13px] font-semibold text-text-primary">{c.author_name}</p>
                  <p className="text-[11px] text-text-disabled">{fmtFull(c.created_at)}</p>
                </div>
                <p className="text-[13px] text-text-secondary leading-relaxed">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="p-4 flex gap-3 border-t border-divider">
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Add a comment…"
              className="input flex-1 resize-none text-[13px]"
              rows={2}
            />
            <button onClick={addComment} disabled={sending || !comment.trim()}
              className="bg-primary text-white rounded-lg px-4 font-semibold text-[13px] hover:bg-primary-dark transition-colors disabled:opacity-50 self-end py-2.5">
              {sending ? '…' : 'Post'}
            </button>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
