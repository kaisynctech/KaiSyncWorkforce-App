'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { WorkTeam, TeamMember } from '@/types/database'

interface Employee { id: string; name: string; surname: string }

export default function WorkTeamDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const teamId = params.id
  const isNew = teamId === 'new'

  const [team, setTeam] = useState<WorkTeam | null>(null)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isActive, setIsActive] = useState(true)

  const [showAddMember, setShowAddMember] = useState(false)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')

  const hasMixedBranches = false // computed from members if needed

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)

    const { data: emps } = await supabase.from('employees').select('id, name, surname')
      .eq('company_id', member.companyId).eq('is_active', true).order('name')
    setAllEmployees((emps ?? []) as Employee[])

    if (isNew) { setLoading(false); return }

    const { data } = await supabase
      .from('work_teams')
      .select('*, members:work_team_members(id, employee_id, is_leader, employee:employees(name, surname))')
      .eq('id', teamId)
      .single()

    if (!data) { router.push('/dashboard/work-teams'); return }

    const t = data as WorkTeam & { members: TeamMember[] }
    setTeam(t)
    setName(t.name)
    setDescription(t.description ?? '')
    setIsActive(t.is_active)
    setMembers(t.members ?? [])
    setLoading(false)
  }, [teamId, isNew])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!name.trim()) { setErrorMsg('Team name is required.'); return }
    setSaving(true)
    setErrorMsg('')
    const supabase = createClient()

    if (isNew) {
      const { data: nt, error: e } = await supabase
        .from('work_teams')
        .insert({ name: name.trim(), description: description.trim() || null, is_active: isActive, company_id: companyId })
        .select()
        .single()
      if (e) { setErrorMsg(e.message); setSaving(false); return }
      router.push(`/dashboard/work-teams/${nt.id}`)
    } else {
      const { error: e } = await supabase
        .from('work_teams')
        .update({ name: name.trim(), description: description.trim() || null, is_active: isActive })
        .eq('id', teamId)
      if (e) setErrorMsg(e.message)
    }
    setSaving(false)
  }

  async function addMember() {
    if (!selectedEmployeeId) return
    setBusy(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('work_team_members')
      .insert({ team_id: teamId, employee_id: selectedEmployeeId, is_leader: false })
      .select('id, employee_id, is_leader, employee:employees(name, surname)')
      .single()
    if (data) setMembers(prev => [...prev, data as unknown as TeamMember])
    setSelectedEmployeeId('')
    setShowAddMember(false)
    setBusy(false)
  }

  async function removeMember(memberId: string) {
    const supabase = createClient()
    await supabase.from('work_team_members').delete().eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  async function toggleLeader(member: TeamMember) {
    const supabase = createClient()
    try {
      if (!member.is_leader) {
        await supabase.rpc('set_team_leader', { team_id: teamId, employee_id: member.employee_id })
      } else {
        await supabase.from('work_team_members').update({ is_leader: false }).eq('id', member.id)
      }
    } catch {}
    setMembers(prev => prev.map(m => m.id === member.id ? { ...m, is_leader: !m.is_leader } : m))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-secondary text-[13px]">Loading…</span>
      </div>
    )
  }

  if (error === 'not_linked') return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center space-y-2">
        <span className="material-icons text-[48px] text-text-disabled">person_off</span>
        <p className="text-[14px] font-semibold text-text-primary">Account not linked</p>
        <p className="text-[13px] text-text-secondary">
          Your account is not linked to an active employee record.<br/>
          Please contact your administrator.
        </p>
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto] items-center px-4 py-3 border-b border-divider shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/dashboard/work-teams" className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
            <span className="material-icons text-[20px]">arrow_back</span>
          </Link>
          <h1 className="text-[20px] font-semibold text-text-primary truncate">{name || (isNew ? 'New Team' : 'Team')}</h1>
        </div>
        <button onClick={save} disabled={saving}
          className="h-11 px-5 text-[16px] font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 transition-colors min-w-[80px]">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {errorMsg && <p className="px-4 py-2 text-error text-[13px] shrink-0">{errorMsg}</p>}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-xl">

        {/* TEAM INFO */}
        <div className="card p-4 space-y-3">
          <p className="section-label">TEAM INFO</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-primary">Team name *</label>
            <input placeholder="Team name" value={name} onChange={e => setName(e.target.value)} className="dark-entry w-full" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-primary">Description</label>
            <input placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} className="dark-entry w-full" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-primary">Active</span>
            <button
              role="switch"
              aria-checked={isActive}
              onClick={() => setIsActive(v => !v)}
              className="relative w-[44px] h-[26px] rounded-full transition-colors shrink-0"
              style={{ backgroundColor: isActive ? '#3B82F6' : 'var(--color-border)' }}
            >
              <span
                className="absolute top-[3px] left-[3px] w-5 h-5 rounded-full bg-white transition-transform"
                style={{ transform: isActive ? 'translateX(18px)' : 'translateX(0)' }}
              />
            </button>
          </div>
        </div>

        {/* Mixed branches warning */}
        {hasMixedBranches && (
          <div className="rounded-lg px-3 py-2 border border-warning" style={{ backgroundColor: 'var(--color-warning-dark)' }}>
            <p className="text-[13px] font-semibold text-warning">Mixed Branches in This Team</p>
          </div>
        )}

        {/* MEMBERS — only for saved teams */}
        {!isNew && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">MEMBERS</p>
              <button onClick={() => setShowAddMember(true)} className="btn-primary h-9 px-3 text-[13px]">
                + Add Member
              </button>
            </div>

            {members.length === 0 ? (
              <p className="text-text-secondary text-[13px] text-center py-4">No members yet. Add some above.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {members.map(m => {
                  const emp = m.employee as { name: string; surname: string } | undefined
                  const fullName = emp ? `${emp.name} ${emp.surname}` : '—'
                  return (
                    <div key={m.id} className="card p-3 grid grid-cols-[1fr_auto] items-center gap-2">
                      <div>
                        <p className="text-sm font-medium text-text-primary">{fullName}</p>
                        {m.is_leader && (
                          <p className="text-xs" style={{ color: 'var(--color-accent)' }}>Leader</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggleLeader(m)}
                          className="text-[12px] text-text-secondary hover:text-primary transition-colors px-1">
                          {m.is_leader ? 'Unset Leader' : 'Set Leader'}
                        </button>
                        <button onClick={() => removeMember(m.id)}
                          className="text-[12px] text-error hover:opacity-70 transition-opacity px-1">
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {busy && <p className="text-text-secondary text-[13px] text-center">Processing…</p>}
      </div>

      {/* Add member modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">Add Member</h3>
            <select value={selectedEmployeeId} onChange={e => setSelectedEmployeeId(e.target.value)}
              className="dark-entry w-full appearance-none">
              <option value="">Select employee…</option>
              {allEmployees
                .filter(e => !members.some(m => m.employee_id === e.id))
                .map(e => (
                  <option key={e.id} value={e.id}>{e.name} {e.surname}</option>
                ))
              }
            </select>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddMember(false)} className="btn-outlined h-9 px-4 text-[13px]">Cancel</button>
              <button onClick={addMember} disabled={!selectedEmployeeId} className="btn-primary h-9 px-4 text-[13px]">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
