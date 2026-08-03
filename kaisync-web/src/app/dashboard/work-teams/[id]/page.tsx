'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { filterTeamsByScope, loadScopedEmployeeIds } from '@/lib/employee-scope'
import { listEmployeesScoped } from '@/lib/employees'
import {
  createWorkTeam,
  getWorkTeam,
  memberIdsOf,
  resolveWorkTeamMembers,
  setWorkTeamLeader,
  setWorkTeamMembers,
  updateWorkTeam,
  type WorkTeamMemberView,
  type WorkTeamRow,
} from '@/lib/work-teams'

interface EmployeeOption {
  id: string
  name: string
  surname: string
  branch_id: string | null
}

export default function WorkTeamDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const teamId = params.id
  const isNew = teamId === 'new'

  const [team, setTeam] = useState<WorkTeamRow | null>(null)
  const [members, setMembers] = useState<WorkTeamMemberView[]>([])
  const [allEmployees, setAllEmployees] = useState<EmployeeOption[]>([])
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

  const hasMixedBranches = (() => {
    const branchIds = members
      .map(m => m.employee?.branch_id)
      .filter(Boolean)
    return new Set(branchIds).size > 1
  })()

  const load = useCallback(async () => {
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); return }
    setCompanyId(member.companyId)

    const [empRes, scopeRes] = await Promise.all([
      listEmployeesScoped(supabase, member.companyId, member.employeeId, { activeOnly: true }),
      loadScopedEmployeeIds(supabase, member.companyId, member.employeeId),
    ])
    if (empRes.ok) {
      setAllEmployees(
        empRes.data.map(e => ({
          id: e.id,
          name: e.name,
          surname: e.surname,
          branch_id: e.branch_id,
        }))
      )
    }

    if (isNew) { setLoading(false); return }

    const teamRes = await getWorkTeam(supabase, member.companyId, teamId)
    if (!teamRes.ok || !teamRes.data) {
      router.push('/dashboard/work-teams')
      return
    }

    // Managers may only open teams in their scope
    if (scopeRes.ok && !scopeRes.seesAll) {
      const allowed = filterTeamsByScope(scopeRes.viewer, [teamRes.data])
      if (allowed.length === 0) {
        setErrorMsg('You do not have access to this team.')
        router.push('/dashboard/work-teams')
        return
      }
    }

    const t = teamRes.data
    setTeam(t)
    setName(t.name)
    setDescription(t.description ?? '')
    setIsActive(t.is_active)
    const membersRes = await resolveWorkTeamMembers(supabase, memberIdsOf(t), t.leader_employee_id)
    if (!membersRes.ok) {
      setErrorMsg(membersRes.message)
      setMembers([])
    } else {
      setMembers(membersRes.data)
    }
    setLoading(false)
  }, [teamId, isNew, router])

  useEffect(() => { load() }, [load])

  async function save() {
    if (!name.trim()) { setErrorMsg('Team name is required.'); return }
    if (!companyId) return
    setSaving(true)
    setErrorMsg('')
    const supabase = createClient()

    if (isNew) {
      const created = await createWorkTeam(supabase, {
        companyId,
        name,
        description,
        isActive,
      })
      if (!created.ok) { setErrorMsg(created.message); setSaving(false); return }
      router.push(`/dashboard/work-teams/${created.data.id}`)
    } else {
      const updated = await updateWorkTeam(supabase, teamId, {
        name,
        description,
        isActive,
      })
      if (!updated.ok) setErrorMsg(updated.message)
      else await load()
    }
    setSaving(false)
  }

  async function addMember() {
    if (!selectedEmployeeId || !team) return
    if (memberIdsOf(team).includes(selectedEmployeeId)) return
    setBusy(true)
    setErrorMsg('')
    const nextIds = [...memberIdsOf(team), selectedEmployeeId]
    const supabase = createClient()
    const result = await setWorkTeamMembers(supabase, teamId, nextIds)
    setBusy(false)
    if (!result.ok) { setErrorMsg(result.message); return }
    setSelectedEmployeeId('')
    setShowAddMember(false)
    await load()
  }

  async function removeMember(employeeId: string) {
    if (!team) return
    const label = members.find(m => m.employee_id === employeeId)?.employee
    const name = label ? `${label.name} ${label.surname}` : 'this member'
    if (!window.confirm(`Remove ${name} from the team?`)) return
    setBusy(true)
    setErrorMsg('')
    const nextIds = memberIdsOf(team).filter(id => id !== employeeId)
    const nextLeader = team.leader_employee_id === employeeId ? null : team.leader_employee_id
    const supabase = createClient()
    const result = await setWorkTeamMembers(supabase, teamId, nextIds, nextLeader)
    setBusy(false)
    if (!result.ok) { setErrorMsg(result.message); return }
    await load()
  }

  function toggleActive() {
    if (isActive) {
      if (!window.confirm('Deactivate this team? It will be hidden from Team Punch and default lists.')) {
        return
      }
    }
    setIsActive(v => !v)
  }

  async function toggleLeader(member: WorkTeamMemberView) {
    if (!team) return
    setBusy(true)
    setErrorMsg('')
    const nextLeader = member.is_leader ? null : member.employee_id
    const supabase = createClient()
    const result = await setWorkTeamLeader(supabase, teamId, nextLeader)
    setBusy(false)
    if (!result.ok) { setErrorMsg(result.message); return }
    await load()
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
              onClick={toggleActive}
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

        {hasMixedBranches && (
          <div className="rounded-lg px-3 py-2 border border-warning" style={{ backgroundColor: 'var(--color-warning-dark)' }}>
            <p className="text-[13px] font-semibold text-warning">Mixed Branches in This Team</p>
          </div>
        )}

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
              <div className="bg-surface border border-divider rounded-lg overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-divider bg-surface-elevated/50">
                      <th className="text-left px-3 py-2 font-medium text-text-secondary">Name</th>
                      <th className="text-left px-3 py-2 font-medium text-text-secondary">Role</th>
                      <th className="text-right px-3 py-2 font-medium text-text-secondary">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map(m => {
                      const emp = m.employee
                      const fullName = emp ? `${emp.name} ${emp.surname}` : 'Unknown employee'
                      return (
                        <tr key={m.employee_id} className="border-b border-divider last:border-0">
                          <td className="px-3 py-2.5">
                            <p className="font-medium text-text-primary">{fullName}</p>
                            {emp?.position && (
                              <p className="text-[11px] text-text-secondary">{emp.position}</p>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-text-secondary">
                            {m.is_leader ? 'Leader' : 'Member'}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => void toggleLeader(m)}
                              disabled={busy}
                              className="text-[12px] text-text-secondary hover:text-primary transition-colors px-1 disabled:opacity-50"
                            >
                              {m.is_leader ? 'Unset Leader' : 'Set Leader'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeMember(m.employee_id)}
                              disabled={busy}
                              className="text-[12px] text-error hover:opacity-70 transition-opacity px-1 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {busy && <p className="text-text-secondary text-[13px] text-center">Processing…</p>}
      </div>

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
              <button onClick={addMember} disabled={!selectedEmployeeId || busy} className="btn-primary h-9 px-4 text-[13px]">Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
