'use client'

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { filterTeamsByScope, loadScopedEmployeeIds } from '@/lib/employee-scope'
import {
  createWorkTeam,
  listWorkTeams,
  memberCountOf,
  resolveTeamLeaderNames,
  setWorkTeamActive,
  type WorkTeamRow,
} from '@/lib/work-teams'

type StatusFilter = 'active' | 'inactive' | 'all'

export default function WorkTeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<WorkTeamRow[]>([])
  const [leaderNames, setLeaderNames] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDesc, setNewTeamDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [archiveBusy, setArchiveBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setActionError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const [result, scopeRes] = await Promise.all([
      listWorkTeams(supabase, member.companyId),
      loadScopedEmployeeIds(supabase, member.companyId, member.employeeId),
    ])
    if (!result.ok) {
      setActionError(result.message)
      setTeams([])
    } else if (!scopeRes.ok) {
      setActionError(scopeRes.message)
      setTeams([])
    } else {
      const scoped = filterTeamsByScope(scopeRes.viewer, result.data)
      setTeams(scoped)
      const leaders = await resolveTeamLeaderNames(supabase, scoped)
      if (leaders.ok) setLeaderNames(leaders.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function createTeam() {
    if (!newTeamName.trim() || !companyId) return
    setCreating(true)
    setActionError(null)
    const supabase = createClient()
    const created = await createWorkTeam(supabase, {
      companyId,
      name: newTeamName,
      description: newTeamDesc,
    })

    setCreating(false)
    if (!created.ok) {
      setActionError(created.message)
      return
    }
    setNewTeamName('')
    setNewTeamDesc('')
    setShowCreate(false)
    router.push(`/dashboard/work-teams/${created.data.id}`)
  }

  async function toggleArchive(team: WorkTeamRow, e: MouseEvent) {
    e.stopPropagation()
    const nextActive = !team.is_active
    const label = nextActive ? 'reactivate' : 'deactivate'
    if (!window.confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} team "${team.name}"?`)) {
      return
    }
    setArchiveBusy(team.id)
    setActionError(null)
    const supabase = createClient()
    const result = await setWorkTeamActive(supabase, team.id, nextActive)
    setArchiveBusy(null)
    if (!result.ok) {
      setActionError(result.message)
      return
    }
    await load()
  }

  const filtered = useMemo(() => {
    return teams.filter(t => {
      if (statusFilter === 'active' && !t.is_active) return false
      if (statusFilter === 'inactive' && t.is_active) return false
      if (search) {
        const q = search.toLowerCase()
        const leader = t.leader_employee_id
          ? (leaderNames.get(t.leader_employee_id) ?? '').toLowerCase()
          : ''
        return (
          t.name.toLowerCase().includes(q) ||
          (t.description ?? '').toLowerCase().includes(q) ||
          leader.includes(q)
        )
      }
      return true
    })
  }, [teams, statusFilter, search, leaderNames])

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
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-surface border-b border-divider">
        <h1 className="text-[18px] font-semibold text-text-primary">Work Teams</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary h-9 px-3 text-[13px]">
          + Team
        </button>
      </div>

      {actionError && (
        <p className="px-4 py-2 text-error text-[13px] shrink-0">{actionError}</p>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-2 shrink-0">
        <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md flex-1 min-w-[200px]">
          <span className="material-icons text-text-disabled text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search teams or leader…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 text-[13px] bg-transparent focus:outline-none text-text-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="h-10 px-3 rounded-md border border-border bg-surface text-[13px] text-text-primary"
        >
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="material-icons text-[48px] text-text-disabled">groups</span>
            <p className="text-text-secondary text-[14px]">
              {teams.length === 0 ? 'No teams yet.' : 'No teams match your filters.'}
            </p>
            {teams.length === 0 && (
              <button onClick={() => setShowCreate(true)} className="btn-primary h-9 px-4 text-[13px] mt-2">
                + Team
              </button>
            )}
          </div>
        ) : (
          <div className="bg-surface border border-divider rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface-elevated/50">
                    <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Team</th>
                    <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Leader</th>
                    <th className="text-center px-4 py-2.5 font-medium text-text-secondary">Members</th>
                    <th className="text-left px-4 py-2.5 font-medium text-text-secondary">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium text-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(team => (
                    <tr
                      key={team.id}
                      className="border-b border-divider last:border-0 hover:bg-background/60 cursor-pointer"
                      onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium text-text-primary">{team.name}</p>
                        {team.description && (
                          <p className="text-[11px] text-text-secondary truncate max-w-[280px]">
                            {team.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-secondary">
                        {team.leader_employee_id
                          ? (leaderNames.get(team.leader_employee_id) ?? '—')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center text-text-primary">
                        {memberCountOf(team)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[11px] font-bold px-2 py-1 rounded-xl"
                          style={team.is_active
                            ? { backgroundColor: '#DCFCE7', color: '#166534' }
                            : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                          }
                        >
                          {team.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          disabled={archiveBusy === team.id}
                          onClick={e => void toggleArchive(team, e)}
                          className="text-[12px] font-medium text-text-secondary hover:text-primary disabled:opacity-50"
                        >
                          {archiveBusy === team.id
                            ? '…'
                            : team.is_active
                              ? 'Deactivate'
                              : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-5 space-y-3">
            <h3 className="font-semibold text-text-primary">New Team</h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Team name *</label>
              <input
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder="e.g. Site A Crew, Night Shift"
                className="dark-entry w-full"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-text-secondary">Description (optional)</label>
              <textarea
                value={newTeamDesc}
                onChange={e => setNewTeamDesc(e.target.value)}
                rows={2}
                placeholder="Notes…"
                className="dark-entry w-full resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCreate(false); setNewTeamName(''); setNewTeamDesc('') }}
                className="btn-outlined h-9 px-4 text-[13px]"
              >
                Cancel
              </button>
              <button
                onClick={() => void createTeam()}
                disabled={!newTeamName.trim() || creating}
                className="btn-primary h-9 px-4 text-[13px] disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
