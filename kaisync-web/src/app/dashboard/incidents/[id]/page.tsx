'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { IncidentReport, IncidentComment } from '@/types/database'

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
  const [loading, setLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [posting, setPosting] = useState(false)

  useEffect(() => { load() }, [incidentId])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const [incRes, commRes] = await Promise.all([
      supabase.from('incident_reports')
        .select('*, jobs(title), employees!assigned_to(name, surname)')
        .eq('id', incidentId)
        .single(),
      supabase.from('incident_comments')
        .select('*, employees(name, surname)')
        .eq('incident_id', incidentId)
        .order('created_at'),
    ])
    if (!incRes.data) { router.push('/dashboard/incidents'); return }
    setIncident(incRes.data as IncidentReport)
    setComments((commRes.data ?? []) as IncidentComment[])
    setLoading(false)
  }

  async function setStatus(newStatus: string) {
    const supabase = createClient()
    await supabase.from('incident_reports').update({ status: newStatus }).eq('id', incidentId)
    setIncident(prev => prev ? { ...prev, status: newStatus } : prev)
  }

  async function closeIncident() {
    if (!window.confirm('Close this incident?')) return
    await setStatus('closed')
  }

  async function addComment() {
    if (!newComment.trim()) return
    setPosting(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setPosting(false); return }

    const { data: me } = await supabase.from('employees').select('id, name, surname').eq('user_id', user.id).maybeSingle()
    const { data: c } = await supabase.from('incident_comments').insert({
      incident_id: incidentId,
      body: newComment.trim(),
      author_id: me?.id ?? user.id,
    }).select('*, employees(name, surname)').single()

    if (c) {
      setComments(prev => [...prev, c as IncidentComment])
      setNewComment('')
    }
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

  const canManage = incident.status !== 'closed'

  return (
    <div className="h-full flex flex-col">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <Link href="/dashboard/incidents" className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons text-[20px]">arrow_back</span>
        </Link>
        <h1 className="text-[18px] font-semibold text-text-primary flex-1 truncate">
          {incident.title ?? 'Incident Report'}
        </h1>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl">

        {/* Header card */}
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

        {/* Linked job */}
        {incident.jobs?.title && (
          <div className="card p-4">
            <p className="text-text-primary text-[14px]">Linked job: {incident.jobs.title}</p>
          </div>
        )}

        {/* Reported by */}
        {incident.employees && (
          <div className="card p-4 flex items-center gap-3">
            <span className="text-text-secondary text-[13px] whitespace-nowrap">Reported by</span>
            <span className="text-text-primary text-[14px]">
              {incident.employees.name} {incident.employees.surname}
            </span>
          </div>
        )}

        {/* Description */}
        <div className="card p-4 space-y-2">
          <p className="section-label">DESCRIPTION</p>
          <p className="text-text-primary text-[14px] leading-relaxed">{incident.description}</p>
          {incident.category && (
            <p className="text-text-secondary text-[12px]">Category: {incident.category}</p>
          )}
        </div>

        {/* Resolution */}
        {incident.status === 'closed' && (
          <div className="card p-4 space-y-2">
            <p className="section-label">RESOLUTION</p>
            <p className="text-text-secondary text-[14px]">{incident.resolution_notes || 'No notes.'}</p>
          </div>
        )}

        {/* Assigned to */}
        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="section-label">ASSIGNED TO</p>
            <p className="text-text-primary text-[14px] mt-0.5">
              {incident.employees ? `${incident.employees.name} ${incident.employees.surname}` : 'Unassigned'}
            </p>
          </div>
          {canManage && (
            <button className="bg-surface-elevated border border-border text-text-primary rounded-lg px-3 py-1.5 text-[12px] hover:bg-background transition-colors">
              Assign
            </button>
          )}
        </div>

        {/* Action buttons */}
        {canManage && (
          <div className="flex gap-2">
            <button onClick={() => setStatus('investigating')} className="btn-outlined text-[11px] h-9 px-3">Investigating</button>
            <button onClick={() => setStatus('resolved')}      className="btn-outlined text-[11px] h-9 px-3">Resolved</button>
            <button onClick={closeIncident}                    className="btn-primary  text-[11px] h-9 px-3">Close</button>
          </div>
        )}

        {/* Comments */}
        <div className="card p-4 space-y-3">
          <p className="section-label">COMMENTS</p>
          {comments.length === 0 && (
            <p className="text-text-secondary text-[13px]">No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="py-1.5 space-y-0.5 border-b border-divider last:border-0">
              <p className="text-text-primary text-[12px] font-medium">
                {c.employees ? `${c.employees.name} ${c.employees.surname}` : 'Unknown'}
              </p>
              <p className="text-text-primary text-[14px]">{c.body}</p>
              <p className="text-text-secondary text-[10px]">{fmtDate(c.created_at)}</p>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input placeholder="Add a comment…" value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !posting && addComment()}
              className="flex-1 dark-entry" />
            <button onClick={addComment} disabled={posting}
              className="btn-primary h-[42px] px-4 text-[13px] disabled:opacity-50">
              Post
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
