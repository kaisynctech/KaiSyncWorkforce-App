'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { can, loadPermissions, PERM, type PermissionSet } from '@/lib/permissions'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { hrAddIncidentComment, hrUpdateIncident } from '@/lib/incidents'
import { resolveIncidentPhotoUrl } from '@/lib/incident-media'
import type { IncidentComment, IncidentReport, IncidentStatusHistory } from '@/types/database'

const SEVERITY_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#FEE2E2', fg: '#991B1B' },
  high:     { bg: '#FEF3C7', fg: '#92400E' },
  medium:   { bg: '#DBEAFE', fg: '#1E40AF' },
  low:      { bg: '#DCFCE7', fg: '#166534' },
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  open:          { bg: '#FEE2E2', fg: '#991B1B' },
  investigating: { bg: '#FEF3C7', fg: '#92400E' },
  resolved:      { bg: '#DBEAFE', fg: '#1E40AF' },
  closed:        { bg: '#DCFCE7', fg: '#166534' },
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

const fmtDateTime = (d: string) =>
  new Intl.DateTimeFormat('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d))

function sevBg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).bg }
function sevFg(s: string) { return (SEVERITY_COLORS[s?.toLowerCase()] ?? SEVERITY_COLORS.low).fg }
function stBg(s: string)  { return (STATUS_COLORS[s?.toLowerCase()]   ?? STATUS_COLORS.open).bg }
function stFg(s: string)  { return (STATUS_COLORS[s?.toLowerCase()]   ?? STATUS_COLORS.open).fg }

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const incidentId = params.id

  const [incident, setIncident] = useState<IncidentReport | null>(null)
  const [comments, setComments] = useState<IncidentComment[]>([])
  const [history, setHistory] = useState<IncidentStatusHistory[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [employees, setEmployees] = useState<{ id: string; name: string; surname: string }[]>([])
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assigningEmpId, setAssigningEmpId] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [myName, setMyName] = useState<string | null>(null)
  const [perms, setPerms] = useState<PermissionSet | null>(null)

  const canEdit = can(perms, PERM.incidentsEdit)

  useEffect(() => { void load() }, [incidentId])

  async function load() {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setMyEmployeeId(member.employeeId)

    const { data: me } = await supabase
      .from('employees')
      .select('access_level, name, surname')
      .eq('id', member.employeeId)
      .maybeSingle()
    setMyName(me ? `${me.name} ${me.surname}`.trim() : null)
    setPerms(await loadPermissions(supabase, member.companyId, me?.access_level))

    const [incRes, commRes, histRes, empRes] = await Promise.all([
      supabase.from('incident_reports')
        .select('*, jobs(title), assignee:employees!assignee_id(name, surname), reporter:employees!employee_id(name, surname)')
        .eq('id', incidentId)
        .eq('company_id', member.companyId)
        .single(),
      supabase.from('incident_comments')
        .select('*, employees:author_employee_id(name, surname)')
        .eq('incident_id', incidentId)
        .order('created_at'),
      supabase.from('incident_status_history')
        .select('*')
        .eq('incident_id', incidentId)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, surname')
        .eq('company_id', member.companyId).eq('is_active', true).order('name'),
    ])

    if (incRes.error || !incRes.data) {
      router.push('/dashboard/incidents')
      return
    }

    const row = incRes.data as IncidentReport
    setIncident(row)
    setComments((commRes.data ?? []) as IncidentComment[])
    setHistory((histRes.data ?? []) as IncidentStatusHistory[])
    setEmployees((empRes.data ?? []) as { id: string; name: string; surname: string }[])

    const paths = (row.photo_urls ?? []).filter(Boolean)
    if (paths.length > 0) {
      const urls = await Promise.all(paths.map(p => resolveIncidentPhotoUrl(supabase, p)))
      setPhotoUrls(urls.filter((u): u is string => Boolean(u)))
    } else {
      setPhotoUrls([])
    }

    setLoading(false)
  }

  async function setStatus(newStatus: string, resolutionNotes?: string) {
    if (!canEdit || !companyId) return
    setError(null)
    const supabase = createClient()
    const res = await hrUpdateIncident(supabase, {
      companyId,
      incidentId,
      status: newStatus,
      resolutionNotes: resolutionNotes ?? null,
    })
    if (!res.ok) { setError(res.message); return }
    await load()
  }

  async function resolveOrClose(newStatus: 'resolved' | 'closed') {
    const label = newStatus === 'closed' ? 'close' : 'resolve'
    const notes = window.prompt(`Resolution notes (${label} incident, optional):`)
    if (notes === null) return
    await setStatus(newStatus, notes)
  }

  async function assignIncident() {
    if (!canEdit || !companyId) return
    setError(null)
    const supabase = createClient()
    const res = await hrUpdateIncident(supabase, {
      companyId,
      incidentId,
      assigneeId: assigningEmpId || null,
      clearAssignee: !assigningEmpId,
    })
    if (!res.ok) { setError(res.message); return }
    setShowAssignModal(false)
    setAssigningEmpId('')
    await load()
  }

  async function addComment() {
    if (!newComment.trim() || !companyId || !myEmployeeId) return
    setPosting(true)
    setError(null)
    const supabase = createClient()
    const res = await hrAddIncidentComment(supabase, {
      companyId,
      incidentId,
      body: newComment.trim(),
      authorEmployeeId: myEmployeeId,
      authorName: myName,
    })
    if (!res.ok) {
      setError(res.message)
      setPosting(false)
      return
    }
    setNewComment('')
    await load()
    setPosting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  if (!incident) return null

  const canManage = canEdit && incident.status !== 'closed'

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/incidents" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1 truncate">
          {incident.title ?? 'Incident Report'}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">
        {error && (
          <div className="rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[13px] text-error">{error}</div>
        )}

        <div className="card p-4 flex justify-between items-start gap-3">
          <div className="space-y-1 flex-1 min-w-0">
            <h2 className="font-bold text-[18px] text-text-primary truncate">{incident.title ?? incident.description}</h2>
            <div>
              <StatusBadge label={incident.status} bg={stBg(incident.status)} fg={stFg(incident.status)} />
            </div>
            <p className="text-text-secondary text-[12px]">Reported {fmtDateTime(incident.created_at)}</p>
          </div>
          <StatusBadge label={incident.severity} bg={sevBg(incident.severity)} fg={sevFg(incident.severity)} />
        </div>

        {incident.jobs?.title && (
          <div className="card p-4">
            <p className="text-text-primary text-[14px]">Linked job: {incident.jobs.title}</p>
          </div>
        )}

        {incident.reporter && (
          <div className="card p-4 flex items-center gap-3">
            <span className="text-text-secondary text-[13px] whitespace-nowrap">Reported by</span>
            <span className="text-text-primary text-[14px]">
              {incident.reporter.name} {incident.reporter.surname}
            </span>
          </div>
        )}

        <div className="card p-4 space-y-2">
          <p className="section-label">DESCRIPTION</p>
          <p className="text-text-primary text-[14px] leading-relaxed">{incident.description}</p>
          {incident.category && (
            <p className="text-text-secondary text-[12px]">Category: {incident.category}</p>
          )}
        </div>

        {photoUrls.length > 0 && (
          <div className="card p-4 space-y-2">
            <p className="section-label">PHOTOS</p>
            <div className="grid grid-cols-2 gap-2">
              {photoUrls.map(url => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt="Incident" className="rounded-lg border border-divider object-cover w-full h-32" />
              ))}
            </div>
          </div>
        )}

        {(incident.status === 'closed' || incident.status === 'resolved') && (
          <div className="card p-4 space-y-2">
            <p className="section-label">RESOLUTION</p>
            <p className="text-text-secondary text-[14px]">{incident.resolution_notes || 'No notes.'}</p>
          </div>
        )}

        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="section-label">ASSIGNED TO</p>
            <p className="text-text-primary text-[14px] mt-0.5">
              {incident.assignee ? `${incident.assignee.name} ${incident.assignee.surname}` : 'Unassigned'}
            </p>
          </div>
          {canManage && (
            <button onClick={() => { setAssigningEmpId(incident.assignee_id ?? ''); setShowAssignModal(true) }}
              className="bg-surface-elevated border border-border text-text-primary rounded-lg px-3 py-1.5 text-[12px] hover:bg-background transition-colors">
              Assign
            </button>
          )}
        </div>

        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => void setStatus('investigating')} className="btn-outlined text-[11px] h-9 px-3">Investigating</button>
            <button onClick={() => void resolveOrClose('resolved')} className="btn-outlined text-[11px] h-9 px-3">Resolved</button>
            <button onClick={() => void resolveOrClose('closed')} className="btn-primary text-[11px] h-9 px-3">Close</button>
          </div>
        )}

        <div className="card p-4 space-y-3">
          <p className="section-label">STATUS HISTORY</p>
          {history.length === 0 ? (
            <p className="text-text-secondary text-[13px]">No status changes recorded yet.</p>
          ) : (
            history.map(h => (
              <div key={h.id} className="py-1.5 border-b border-divider last:border-0">
                <p className="text-[13px] text-text-primary capitalize">
                  {(h.old_status ?? '—')} → {h.new_status}
                </p>
                {h.notes && <p className="text-[12px] text-text-secondary">{h.notes}</p>}
                <p className="text-[10px] text-text-secondary">{fmtDateTime(h.created_at)}</p>
              </div>
            ))
          )}
        </div>

        <div className="card p-4 space-y-3">
          <p className="section-label">COMMENTS</p>
          {comments.length === 0 && (
            <p className="text-text-secondary text-[13px]">No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="py-1.5 space-y-0.5 border-b border-divider last:border-0">
              <p className="text-text-primary text-[12px] font-medium">
                {c.author_name
                  ?? (c.employees ? `${c.employees.name} ${c.employees.surname}` : 'Unknown')}
              </p>
              <p className="text-text-primary text-[14px]">{c.body}</p>
              <p className="text-text-secondary text-[10px]">{fmtDate(c.created_at)}</p>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input placeholder="Add a comment…" value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !posting && void addComment()}
              className="flex-1 dark-entry" />
            <button onClick={() => void addComment()} disabled={posting}
              className="btn-primary h-[42px] px-4 text-[13px] disabled:opacity-50">
              Post
            </button>
          </div>
        </div>
      </div>

      {showAssignModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">Assign Incident</h3>
            <select value={assigningEmpId} onChange={e => setAssigningEmpId(e.target.value)}
              className="dark-entry w-full appearance-none">
              <option value="">Unassigned</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAssignModal(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={() => void assignIncident()} className="btn-primary h-9 px-4 text-[13px]">Assign</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
