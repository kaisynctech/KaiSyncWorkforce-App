'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { useEmployeeModuleGate } from '@/lib/employee-module-gate'

interface PATask {
  id: string
  title: string
  notes: string | null
  status: string
  priority: string
  due_at: string | null
  remind_at: string | null
  linked_type: string | null
  linked_id: string | null
  linked_label: string | null
  recurrence_pattern: string | null
  meeting_with: string | null
  meeting_at: string | null
  meeting_minutes: string | null
  meeting_follow_up: string | null
}

interface LinkOption { id: string; label: string }

const PRIORITIES = ['low', 'medium', 'high', 'urgent']
const LINK_TYPES = ['none', 'client', 'job', 'deal', 'meeting']
const RECURRENCES = ['none', 'daily', 'weekly', 'monthly']

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultDue(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return toDateTimeLocal(d.toISOString())
}

interface Props {
  mode: 'new' | 'edit'
  taskId?: string
}

export default function PATaskEditor({ mode, taskId }: Props) {
  const allowed = useEmployeeModuleGate('myPa')
  const router        = useRouter()
  const isCodeAuthRef = useRef(false)

  const [loading,    setLoading]    = useState(mode === 'edit')
  const [notFound,   setNotFound]   = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [empId,      setEmpId]      = useState<string | null>(null)
  const [companyId,  setCompanyId]  = useState<string | null>(null)
  const [token,      setToken]      = useState('')
  const [allTasks,   setAllTasks]   = useState<PATask[]>([])

  // Form state
  const [title,          setTitle]          = useState('')
  const [notes,          setNotes]          = useState('')
  const [priority,       setPriority]       = useState('medium')
  const [dueAt,          setDueAt]          = useState(defaultDue())
  const [remindAt,       setRemindAt]       = useState('')
  const [linkedType,     setLinkedType]     = useState('none')
  const [linkedId,       setLinkedId]       = useState('')
  const [recurrence,     setRecurrence]     = useState('none')
  const [meetingWith,    setMeetingWith]    = useState('')
  const [meetingAt,      setMeetingAt]      = useState('')
  const [meetingMinutes, setMeetingMinutes] = useState('')
  const [meetingFollowUp,setMeetingFollowUp]= useState('')
  const [linkOptions,    setLinkOptions]    = useState<LinkOption[]>([])
  const [loadingLinks,   setLoadingLinks]   = useState(false)

  useEffect(() => {
    if (allowed !== true) return
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed])
  useEffect(() => {
    if (linkedType !== 'none' && linkedType !== 'meeting') loadLinkOptions()
  }, [linkedType])

  async function init() {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) return
    setEmpId(member.employeeId)
    setCompanyId(member.companyId)

    const tok = member.sessionToken
      ?? (await supabase.auth.getSession()).data.session?.access_token
      ?? ''
    setToken(tok)
    isCodeAuthRef.current = member.sessionToken !== null

    if (mode === 'edit' && taskId) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error: rpcErr } = await (supabase.rpc as any)('employee_get_pa_tasks', {
          p_company_id:    member.companyId,
          p_employee_id:   member.employeeId,
          p_session_token: tok,
        })
        if (rpcErr) throw rpcErr
        const tasks = (data as PATask[]) ?? []
        setAllTasks(tasks)
        const t = tasks.find(t => t.id === taskId)
        if (!t) { setNotFound(true); setLoading(false); return }
        setTitle(t.title)
        setNotes(t.notes ?? '')
        setPriority(t.priority)
        setDueAt(toDateTimeLocal(t.due_at))
        setRemindAt(toDateTimeLocal(t.remind_at))
        setLinkedType(t.linked_type ?? 'none')
        setLinkedId(t.linked_id ?? '')
        setRecurrence(t.recurrence_pattern ?? 'none')
        setMeetingWith(t.meeting_with ?? '')
        setMeetingAt(toDateTimeLocal(t.meeting_at))
        setMeetingMinutes(t.meeting_minutes ?? '')
        setMeetingFollowUp(t.meeting_follow_up ?? '')
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load task.')
      }
      setLoading(false)
    }
  }

  async function loadLinkOptions() {
    if (!companyId) return
    setLoadingLinks(true)
    const supabase = createClient()
    try {
      let data: LinkOption[] = []
      if (linkedType === 'client') {
        if (!isCodeAuthRef.current) {
          const { data: rows } = await supabase.from('clients').select('id, name').eq('company_id', companyId)
          data = (rows ?? []).map(r => ({ id: r.id, label: r.name }))
        }
      } else if (linkedType === 'job') {
        if (empId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: rows } = await (supabase.rpc as any)('employee_get_jobs_for_employee', {
            p_employee_id:   empId,
            p_company_id:    companyId,
            p_session_token: token,
          })
          data = ((rows ?? []) as { id: string; title: string }[]).map(r => ({ id: r.id, label: r.title }))
        }
      } else if (linkedType === 'deal') {
        if (!isCodeAuthRef.current) {
          const { data: rows } = await supabase.from('client_deals').select('id, title').eq('company_id', companyId)
          data = (rows ?? []).map(r => ({ id: r.id, label: r.title }))
        }
      }
      setLinkOptions(data)
    } catch (e) { console.error(e) }
    setLoadingLinks(false)
  }

  // Conflict detection
  const conflicts = useMemo(() => {
    if (!dueAt && !meetingAt) return []
    return allTasks.filter(t => {
      if (t.id === taskId) return false
      const due = dueAt && t.due_at && Math.abs(new Date(t.due_at).getTime() - new Date(dueAt).getTime()) < 60000
      const mt  = meetingAt && t.meeting_at && Math.abs(new Date(t.meeting_at).getTime() - new Date(meetingAt).getTime()) < 60000
      return due || mt
    })
  }, [dueAt, meetingAt, allTasks, taskId])

  async function save() {
    if (!title.trim()) { setError('Task title is required.'); return }
    if (!empId || !companyId) return
    setError(null)
    setSubmitting(true)

    const selectedLink = linkOptions.find(o => o.id === linkedId)
    const params = {
      p_company_id:          companyId,
      p_employee_id:         empId,
      p_title:               title.trim(),
      p_notes:               notes.trim() || null,
      p_due_at:              dueAt ? new Date(dueAt).toISOString() : null,
      p_priority:            priority,
      p_remind_at:           remindAt ? new Date(remindAt).toISOString() : null,
      p_linked_type:         linkedType === 'none' ? null : linkedType,
      p_linked_id:           linkedId || null,
      p_linked_label:        selectedLink?.label ?? null,
      p_recurrence_pattern:  recurrence === 'none' ? null : recurrence,
      p_meeting_with:        linkedType === 'meeting' ? meetingWith || null : null,
      p_meeting_at:          linkedType === 'meeting' && meetingAt ? new Date(meetingAt).toISOString() : null,
      p_meeting_minutes:     linkedType === 'meeting' ? meetingMinutes || null : null,
      p_meeting_follow_up:   linkedType === 'meeting' ? meetingFollowUp || null : null,
      p_source_type:         'manual',
      p_session_token:       token,
    }

    const supabase = createClient()
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rpc = (fn: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => (supabase.rpc as any)(fn, args, opts)
      if (mode === 'new') {
        const { error: rpcErr } = await rpc('employee_insert_pa_task', params)
        if (rpcErr) throw rpcErr
      } else {
        const { error: rpcErr } = await rpc('employee_update_pa_task', { ...params, p_task_id: taskId })
        if (rpcErr) throw rpcErr
      }
      router.push('/dashboard/employee/pa')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save task.')
    }
    setSubmitting(false)
  }

  if (allowed === null || (allowed && loading)) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )
  if (allowed === false) return null
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )
  if (notFound) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Task not found.</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary">{mode === 'new' ? 'New Task' : 'Edit Task'}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">
        {error && (
          <div className="rounded-xl px-4 py-3 bg-error-dark border border-error/30">
            <p className="text-[13px] text-error font-semibold">{error}</p>
          </div>
        )}

        {/* Title */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Title *</label>
          <input className="input" type="text" placeholder="What do you need to do?"
            value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Notes</label>
          <textarea className="input resize-none" rows={3}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        {/* Priority */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Priority</label>
          <div className="flex gap-2">
            {PRIORITIES.map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className={`flex-1 text-[12px] font-semibold py-1.5 rounded-lg capitalize transition-colors ${
                  priority === p ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                }`}>{p}</button>
            ))}
          </div>
        </div>

        {/* Due Date & Time */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Due Date & Time</label>
          <input className="input" type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} />
        </div>

        {/* Reminder */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Reminder (optional)</label>
          <input className="input" type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} />
        </div>

        {/* Link type */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Link Type</label>
          <select className="input" value={linkedType} onChange={e => { setLinkedType(e.target.value); setLinkedId('') }}>
            {LINK_TYPES.map(t => (
              <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>

        {/* Secondary link selector */}
        {['client','job','deal'].includes(linkedType) && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide capitalize">
              Select {linkedType}
            </label>
            {loadingLinks ? (
              <p className="text-[13px] text-text-disabled">Loading…</p>
            ) : (
              <select className="input" value={linkedId} onChange={e => setLinkedId(e.target.value)}>
                <option value="">Select…</option>
                {linkOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Meeting fields */}
        {linkedType === 'meeting' && (
          <div className="bg-surface border border-divider rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-divider">
              <p className="section-label">Meeting Details</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Meeting With</label>
                <input className="input" type="text" value={meetingWith} onChange={e => setMeetingWith(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Date & Time</label>
                <input className="input" type="datetime-local" value={meetingAt} onChange={e => setMeetingAt(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Meeting Minutes</label>
                <textarea className="input resize-none" rows={3} value={meetingMinutes} onChange={e => setMeetingMinutes(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Follow-up Notes</label>
                <textarea className="input resize-none" rows={3} value={meetingFollowUp} onChange={e => setMeetingFollowUp(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Recurrence */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Recurrence</label>
          <div className="flex gap-2">
            {RECURRENCES.map(r => (
              <button key={r} onClick={() => setRecurrence(r)}
                className={`flex-1 text-[12px] font-semibold py-1.5 rounded-lg capitalize transition-colors ${
                  recurrence === r ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                }`}>{r}</button>
            ))}
          </div>
        </div>

        {/* Conflict warning */}
        {conflicts.length > 0 && (
          <div className="rounded-xl px-4 py-3 bg-warning/10 border border-warning/30">
            <p className="text-[13px] text-warning font-semibold">
              Conflicts: {conflicts.map(t => t.title).join(', ')}
            </p>
          </div>
        )}

        <button onClick={save} disabled={submitting}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60">
          {submitting ? 'Saving…' : mode === 'new' ? 'Create Task' : 'Save Changes'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
