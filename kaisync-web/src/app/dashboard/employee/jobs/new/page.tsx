'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'

interface Employee {
  id: string
  name: string
  surname: string
  position: string | null
  access_level: string | null
}

const LEADERSHIP_LEVELS = ['owner', 'hr_admin', 'admin', 'hr', 'manager']
const PRIORITIES = ['none', 'low', 'medium', 'high', 'critical']

function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function NewJobPage() {
  const router = useRouter()

  const [empId,     setEmpId]     = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [allEmps,   setAllEmps]   = useState<Employee[]>([])
  const [loading,   setLoading]   = useState(true)
  const [submitting,setSubmitting]= useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const tokRef = useRef<string | null>(null)

  // Form
  const [title,       setTitle]       = useState('')
  const [description, setDescription] = useState('')
  const [priority,    setPriority]    = useState('medium')
  const [startDT,     setStartDT]     = useState(() => {
    const d = new Date(); d.setHours(8, 0, 0, 0); return toLocalDateTimeInput(d)
  })
  const [managerId,   setManagerId]   = useState<string>('')
  const [teamSearch,  setTeamSearch]  = useState('')
  const [selectedTeam, setSelectedTeam] = useState<Set<string>>(new Set())

  useEffect(() => { init() }, [])

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

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: employeesData, error: rpcErr } = await (supabase.rpc as any)('employee_list_company_peers', {
        p_employee_id:   member.employeeId,
        p_company_id:    member.companyId,
        p_session_token: tok,
      })
      if (rpcErr) throw rpcErr
      const emps = (employeesData ?? []) as Employee[]
      setAllEmps(emps)

      // Pre-select line manager — look for manager access level, prefer the first one found
      const mgr = emps.find(e => LEADERSHIP_LEVELS.includes(e.access_level ?? ''))
      if (mgr) setManagerId(mgr.id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load employees.')
    }
    setLoading(false)
  }

  function toggleTeam(id: string) {
    setSelectedTeam(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function submit() {
    if (!title.trim()) { setError('Please enter a job title.'); return }
    if (!empId || !companyId) return
    setError(null)
    setSubmitting(true)

    const scheduled = new Date(startDT)
    const scheduledEnd = new Date(scheduled.getTime() + 8 * 3600000)

    const supabase = createClient()
    try {
      const token = tokRef.current ?? ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: rpcErr } = await (supabase.rpc as any)('employee_create_job', {
        p_company_id:                companyId,
        p_creator_employee_id:       empId,
        p_title:                     title.trim(),
        p_description:               description.trim() || null,
        p_priority:                  priority,
        p_scheduled_start:           scheduled.toISOString(),
        p_scheduled_end:             scheduledEnd.toISOString(),
        p_site_id:                   null,
        p_client_id:                 null,
        p_assignee_employee_id:      empId,
        p_assigned_employee_ids:     Array.from(selectedTeam),
        p_notify_manager_employee_id: managerId || null,
        p_visibility:                managerId ? 'restricted' : 'inherit',
        p_session_token:             token,
      })
      if (rpcErr) throw rpcErr
      alert('Your job was saved and is visible to your team, managers, and HR.')
      router.push('/dashboard/employee/jobs')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create job.')
    }
    setSubmitting(false)
  }

  const leadership = allEmps.filter(e => LEADERSHIP_LEVELS.includes(e.access_level ?? '') && e.id !== empId)
  const coworkers  = allEmps.filter(e => !LEADERSHIP_LEVELS.includes(e.access_level ?? '') && e.id !== empId)
  const filteredCoworkers = coworkers.filter(e => {
    const q = teamSearch.toLowerCase()
    return `${e.name} ${e.surname} ${e.position ?? ''}`.toLowerCase().includes(q)
  })

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-text-secondary text-[14px]">Loading…</div>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <button onClick={() => router.back()} className="text-text-secondary hover:text-text-primary transition-colors">
          <span className="material-icons">arrow_back</span>
        </button>
        <h1 className="text-[18px] font-semibold text-text-primary">Create Job</h1>
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
          <input className="input" type="text" placeholder="Job title"
            value={title} onChange={e => setTitle(e.target.value)} />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Description</label>
          <textarea className="input resize-none" rows={3}
            value={description} onChange={e => setDescription(e.target.value)} />
        </div>

        {/* Priority */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Priority</label>
          <div className="flex gap-2 flex-wrap">
            {PRIORITIES.map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className={`text-[12px] font-semibold px-3 py-1.5 rounded-full capitalize transition-colors ${
                  priority === p ? 'bg-primary text-white' : 'bg-surface-elevated text-text-secondary border border-divider'
                }`}>{p}</button>
            ))}
          </div>
        </div>

        {/* Scheduled Start */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Scheduled Start</label>
          <input className="input" type="datetime-local" value={startDT} onChange={e => setStartDT(e.target.value)} />
          <p className="text-[11px] text-text-disabled">End time is automatically set to 8 hours after start.</p>
        </div>

        {/* Notify Manager */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Notify Manager</label>
          <select className="input" value={managerId} onChange={e => setManagerId(e.target.value)}>
            <option value="">None — no manager notification</option>
            {leadership.map(e => (
              <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
            ))}
          </select>
        </div>

        {/* Team Members */}
        {coworkers.length > 0 && (
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Team Members</label>
            <input className="input" type="text" placeholder="Search team members…"
              value={teamSearch} onChange={e => setTeamSearch(e.target.value)} />
            <div className="bg-surface border border-divider rounded-xl overflow-hidden max-h-56 overflow-y-auto divide-y divide-divider">
              {filteredCoworkers.map(e => (
                <label key={e.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-elevated transition-colors">
                  <input type="checkbox" className="w-4 h-4 accent-primary"
                    checked={selectedTeam.has(e.id)}
                    onChange={() => toggleTeam(e.id)} />
                  <div>
                    <p className="text-[13px] font-medium text-text-primary">{e.name} {e.surname}</p>
                    {e.position && <p className="text-[11px] text-text-secondary">{e.position}</p>}
                  </div>
                </label>
              ))}
              {filteredCoworkers.length === 0 && (
                <div className="px-4 py-3 text-[13px] text-text-disabled">No team members found.</div>
              )}
            </div>
          </div>
        )}

        <button onClick={submit} disabled={submitting}
          className="w-full h-12 rounded-xl bg-primary text-white font-bold text-[15px] hover:bg-primary-dark transition-colors disabled:opacity-60">
          {submitting ? 'Creating…' : 'Create Job'}
        </button>

        <div className="h-4" />
      </div>
    </div>
  )
}
