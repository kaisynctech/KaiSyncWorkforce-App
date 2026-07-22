'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { getCodeSession, getEmpContext } from '@/lib/auth/code-session'
import {
  loadEmployeeWorkspace,
} from '@/lib/employee-workspace'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'
import {
  SEVERITY_STYLES,
  STATUS_STYLES,
  canManageIncident,
  displayIncidentTitle,
  formatIncidentLabel,
  parseIncidentRpcJson,
} from '@/lib/incident-types'
import { resolveIncidentPhotoUrl, uploadIncidentPhoto } from '@/lib/incident-media'

interface Incident {
  id: string
  title: string | null
  severity: string | null
  status: string | null
  category: string | null
  occurred_at: string | null
  location_text: string | null
  description: string | null
  created_at: string
  photo_urls: string[] | null
  assignee_id: string | null
  resolution_notes: string | null
  job_id: string | null
}

interface Comment {
  id: string
  author_name: string | null
  body: string
  created_at: string
}

interface StatusHistoryRow {
  id?: string
  new_status: string
  old_status: string | null
  created_at: string
  changed_by_employee_id: string | null
  notes: string | null
}

interface Manager {
  id: string
  name: string
  surname: string
  access_level?: string | null
  is_active?: boolean | null
}

const MGMT = ['manager', 'hr', 'hr_admin', 'owner', 'admin']
const STATUS_ACTIONS = [
  { key: 'investigating', label: 'Investigating' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
] as const

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function IncidentDetailPage() {
  const allowed = useEmployeeModuleGate('incidents')
  const params = useParams()
  const router = useRouter()
  const incId = params.id as string

  const [incident, setIncident] = useState<Incident | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [history, setHistory] = useState<StatusHistoryRow[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [managers, setManagers] = useState<Manager[]>([])
  const [loading, setLoading] = useState(true)
  const [comment, setComment] = useState('')
  const [sending, setSending] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [empId, setEmpId] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const tokRef = useRef<string | null>(null)

  useEffect(() => {
    if (allowed !== true) return
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, incId])

  async function init() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setLoading(false); return }

    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? null
    tokRef.current = tok

    const empWs = await loadEmployeeWorkspace(supabase, member.employeeId)
    const accessLevel = empWs?.access_level
      ?? getCodeSession()?.employee.access_level
      ?? getEmpContext()?.access_level
      ?? 'employee'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args)
    const [incRes, cRes, hRes, peersRes] = await Promise.all([
      rpc('employee_get_incident', {
        p_incident_id: incId,
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      }),
      rpc('employee_get_incident_comments', {
        p_incident_id: incId,
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      }),
      rpc('employee_get_incident_status_history', {
        p_incident_id: incId,
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      }),
      rpc('employee_list_company_peers', {
        p_employee_id: member.employeeId,
        p_company_id: member.companyId,
        p_session_token: tok,
      }),
    ])

    if (incRes.error) {
      setIncident(null)
      setLoading(false)
      return
    }

    const inc = parseIncidentRpcJson<Incident>(incRes.data)
    setIncident(inc)
    setResolutionNotes(inc?.resolution_notes ?? '')
    setAssigneeId(inc?.assignee_id ?? '')
    setCanManage(canManageIncident(accessLevel, inc?.assignee_id, member.employeeId))
    setComments((cRes.data as Comment[]) ?? [])
    setHistory((hRes.data as StatusHistoryRow[]) ?? [])
    setManagers(
      ((peersRes.data as Manager[]) ?? []).filter(
        e => MGMT.includes((e.access_level ?? '').toLowerCase()) && e.is_active !== false,
      ),
    )

    if (inc?.photo_urls?.length) {
      const signed = await Promise.all(
        inc.photo_urls.map(path => resolveIncidentPhotoUrl(supabase, path)),
      )
      setPhotoUrls(signed.filter(Boolean) as string[])
    } else {
      setPhotoUrls([])
    }

    setLoading(false)
  }

  async function addComment() {
    if (!comment.trim() || !empId || !companyId) return
    setSending(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('employee_add_incident_comment', {
      p_incident_id: incId,
      p_employee_id: empId,
      p_company_id: companyId,
      p_body: comment.trim(),
      p_session_token: tokRef.current,
    })
    if (rpcErr) setError(rpcErr.message)
    else {
      setComment('')
      await init()
    }
    setSending(false)
  }

  async function appendPhotos() {
    const files = photoRef.current?.files
    if (!files || files.length === 0 || !empId || !companyId) return
    setUpdating(true)
    setError(null)
    const supabase = createClient()
    const paths: string[] = []
    for (const file of Array.from(files)) {
      try {
        const path = await uploadIncidentPhoto({
          supabase,
          companyId,
          employeeId: empId,
          file,
          sessionToken: tokRef.current,
        })
        if (path) paths.push(path)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Photo upload failed.')
        setUpdating(false)
        return
      }
    }
    if (paths.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_append_incident_photos', {
        p_incident_id: incId,
        p_employee_id: empId,
        p_company_id: companyId,
        p_photo_urls: paths,
        p_session_token: tokRef.current,
      })
      if (rpcErr) setError(rpcErr.message)
      else await init()
    }
    if (photoRef.current) photoRef.current.value = ''
    setUpdating(false)
  }

  async function updateStatus(status: string) {
    if (!empId || !companyId) return
    setUpdating(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('employee_update_incident', {
      p_company_id: companyId,
      p_employee_id: empId,
      p_incident_id: incId,
      p_status: status,
      p_resolution_notes: resolutionNotes.trim() || null,
      p_assignee_id: null,
      p_clear_assignee: false,
      p_session_token: tokRef.current,
    })
    if (rpcErr) setError(rpcErr.message)
    else await init()
    setUpdating(false)
  }

  async function saveAssignee() {
    if (!empId || !companyId) return
    setUpdating(true)
    setError(null)
    const supabase = createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rpcErr } = await (supabase.rpc as any)('employee_update_incident', {
      p_company_id: companyId,
      p_employee_id: empId,
      p_incident_id: incId,
      p_status: null,
      p_resolution_notes: null,
      p_assignee_id: assigneeId || null,
      p_clear_assignee: !assigneeId,
      p_session_token: tokRef.current,
    })
    if (rpcErr) setError(rpcErr.message)
    else await init()
    setUpdating(false)
  }

  if (allowed === null || (allowed && loading)) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
    )
  }
  if (allowed === false) return null
  if (!incident) {
    return (
      <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Incident not found.</div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary truncate flex-1">
          {displayIncidentTitle(incident.title, incident.description)}
        </h1>
        <div className="flex gap-2 shrink-0">
          {incident.severity && (
            <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${SEVERITY_STYLES[incident.severity] ?? ''}`}>
              {incident.severity}
            </span>
          )}
          {incident.status && (
            <span className={`text-[11px] font-semibold px-2 py-[3px] rounded-full capitalize ${STATUS_STYLES[incident.status] ?? ''}`}>
              {formatIncidentLabel(incident.status)}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Details</p>
          </div>
          <div className="p-4 space-y-3">
            {incident.category && (
              <div className="flex gap-3">
                <span className="material-icons text-text-disabled text-[18px] mt-0.5">category</span>
                <div>
                  <p className="text-[11px] text-text-disabled uppercase font-semibold">Category</p>
                  <p className="text-[13px] text-text-primary mt-0.5 capitalize">{formatIncidentLabel(incident.category)}</p>
                </div>
              </div>
            )}
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
            {incident.resolution_notes && (
              <div className="flex gap-3">
                <span className="material-icons text-text-disabled text-[18px] mt-0.5">notes</span>
                <div>
                  <p className="text-[11px] text-text-disabled uppercase font-semibold">Resolution notes</p>
                  <p className="text-[13px] text-text-primary mt-0.5">{incident.resolution_notes}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {canManage && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Manage</p>
            </div>
            <div className="p-4 space-y-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Assignee</label>
                <div className="flex gap-2">
                  <select className="input flex-1" value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                    <option value="">Unassigned</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.name} {m.surname}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={updating}
                    onClick={() => void saveAssignee()}
                    className="bg-surface-elevated border border-divider text-[13px] font-semibold px-3 py-2 rounded-lg hover:border-primary disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Resolution notes</label>
                <textarea
                  className="input resize-none text-[13px]"
                  rows={2}
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Optional notes when resolving/closing"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {STATUS_ACTIONS.map(a => (
                  <button
                    key={a.key}
                    type="button"
                    disabled={updating || incident.status === a.key}
                    onClick={() => void updateStatus(a.key)}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-divider hover:border-primary disabled:opacity-50"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {photoUrls.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Photos</p>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {photoUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="bg-surface border border-divider rounded-xl p-4">
          <p className="text-[13px] font-semibold text-text-primary mb-2">Add Photos</p>
          <div className="flex gap-3 items-center">
            <input ref={photoRef} type="file" accept="image/*" multiple className="flex-1 text-[13px] text-text-secondary" />
            <button
              onClick={() => void appendPhotos()}
              disabled={updating}
              className="bg-primary text-white text-[13px] font-semibold px-3 py-2 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              Upload
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Status History</p>
            </div>
            <div className="divide-y divide-divider">
              {history.map((h, i) => (
                <div key={h.id ?? i} className="px-4 py-3 flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-primary mt-[6px] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary capitalize">
                      {formatIncidentLabel(h.new_status)}
                    </p>
                    <p className="text-[11px] text-text-disabled mt-0.5">{fmtFull(h.created_at)}</p>
                    {h.notes && <p className="text-[12px] text-text-secondary mt-0.5">{h.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-surface border border-divider rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-divider">
            <p className="section-label">Comments ({comments.length})</p>
          </div>
          <div className="divide-y divide-divider">
            {comments.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[13px] font-semibold text-text-primary">{c.author_name || 'Unknown'}</p>
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
            <button
              onClick={() => void addComment()}
              disabled={sending || !comment.trim()}
              className="bg-primary text-white rounded-lg px-4 font-semibold text-[13px] hover:bg-primary-dark transition-colors disabled:opacity-50 self-end py-2.5"
            >
              {sending ? '…' : 'Post'}
            </button>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  )
}
