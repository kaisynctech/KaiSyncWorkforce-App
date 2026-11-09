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
import { StatusFilterTabs, TAB_ALL, MONEY_TH, MONEY_TD } from '@/components/ui/StatusFilterTabs'
import {
  ResetFiltersButton,
  TextHeaderFilter,
  matchText,
  statusTab,
} from '@/components/ui/MoneyListFilters'
import { ModalShell } from '@/components/ui/ModalShell'

const STATUS_TABS = [
  statusTab('active', 'Active', ['active'], 'green'),
  statusTab('inactive', 'Inactive', ['inactive'], 'gray'),
  TAB_ALL,
]

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
  const [teamNameCol, setTeamNameCol] = useState('')
  const [leaderCol, setLeaderCol] = useState('')
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | ''>('active')
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
      const leader = t.leader_employee_id
        ? (leaderNames.get(t.leader_employee_id) ?? '')
        : ''
      if (search) {
        if (
          !matchText(t.name, search) &&
          !matchText(t.description, search) &&
          !matchText(leader, search)
        ) return false
      }
      if (!matchText(t.name, teamNameCol)) return false
      if (!matchText(leader, leaderCol)) return false
      return true
    })
  }, [teams, statusFilter, search, teamNameCol, leaderCol, leaderNames])

  const filtersActive = !!(search || teamNameCol || leaderCol || statusFilter)

  function resetFilters() {
    setSearch('')
    setTeamNameCol('')
    setLeaderCol('')
    setStatusFilter('')
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
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Work Teams</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{teams.length} total</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark transition-colors"
        >
          <span className="material-icons text-[18px]">group_add</span>
          Create Team
        </button>
      </div>

      {actionError && (
        <p className="mb-3 text-error text-[13px]">{actionError}</p>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1.5 h-8 px-2 bg-surface border border-border rounded-sm flex-1 min-w-[180px]">
          <span className="material-icons text-text-disabled text-[16px]">search</span>
          <input
            type="search"
            placeholder="Search teams or leader…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-0 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
          />
        </div>
        <ResetFiltersButton disabled={!filtersActive} onReset={resetFilters} />
        <StatusFilterTabs
          tabs={STATUS_TABS}
          value={statusFilter || 'all'}
          counts={{
            all: teams.length,
            active: teams.filter(t => t.is_active).length,
            inactive: teams.filter(t => !t.is_active).length,
          }}
          onChange={id => setStatusFilter(id === 'all' ? '' : id as 'active' | 'inactive')}
        />
      </div>

      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 720 }}>
            <thead>
              <tr className="bg-surface-elevated border-b border-divider">
                <th className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter
                    label="Team"
                    value={teamNameCol}
                    onChange={setTeamNameCol}
                    placeholder="Team name…"
                  />
                </th>
                <th style={{ width: 160 }} className={`${MONEY_TH} text-left`}>
                  <TextHeaderFilter
                    label="Leader"
                    value={leaderCol}
                    onChange={setLeaderCol}
                    placeholder="Leader…"
                  />
                </th>
                <th style={{ width: 90 }} className={`${MONEY_TH} text-center`}>Members</th>
                <th style={{ width: 90 }} className={`${MONEY_TH} text-left`}>Status</th>
                <th style={{ width: 110 }} className={`${MONEY_TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-[12px] text-text-disabled">
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <span className="material-icons text-[40px] text-text-disabled block mb-2">groups</span>
                    <p className="text-[13px] text-text-secondary">
                      {teams.length === 0 ? 'No teams yet.' : 'No teams match your filters.'}
                    </p>
                    {teams.length === 0 && (
                      <button
                        type="button"
                        onClick={() => setShowCreate(true)}
                        className="mt-2 text-primary text-[12px] hover:underline"
                      >
                        + Create your first team
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                filtered.map(team => {
                  const leader = team.leader_employee_id
                    ? (leaderNames.get(team.leader_employee_id) ?? '—')
                    : '—'
                  return (
                    <tr
                      key={team.id}
                      className="border-b border-divider last:border-0 hover:bg-background transition-colors cursor-pointer"
                      onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
                    >
                      <td className={MONEY_TD}>
                        <p className="font-medium text-text-primary">{team.name}</p>
                        {team.description && (
                          <p className="text-[11px] text-text-secondary truncate max-w-[280px]">
                            {team.description}
                          </p>
                        )}
                      </td>
                      <td className={`${MONEY_TD} text-text-secondary`}>{leader}</td>
                      <td className={`${MONEY_TD} text-center text-text-primary tabular-nums`}>
                        {memberCountOf(team)}
                      </td>
                      <td className={MONEY_TD}>
                        <span className={`flex items-center gap-1 text-[11px] font-medium w-fit ${
                          team.is_active ? 'text-success' : 'text-text-disabled'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            team.is_active ? 'bg-success' : 'bg-text-disabled'
                          }`} />
                          {team.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className={`${MONEY_TD} text-right`}>
                        <button
                          type="button"
                          disabled={archiveBusy === team.id}
                          onClick={e => void toggleArchive(team, e)}
                          className="h-7 px-2 rounded-md text-[11px] font-medium text-text-secondary hover:text-primary hover:bg-surface-elevated disabled:opacity-50"
                        >
                          {archiveBusy === team.id
                            ? '…'
                            : team.is_active
                              ? 'Deactivate'
                              : 'Reactivate'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ModalShell
        open={showCreate}
        onClose={() => { setShowCreate(false); setNewTeamName(''); setNewTeamDesc('') }}
        title="New Team"
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setNewTeamName(''); setNewTeamDesc('') }}
              className="h-11 px-4 rounded-md border border-border text-[13px] text-text-secondary hover:bg-background transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createTeam()}
              disabled={!newTeamName.trim() || creating}
              className="h-11 px-4 rounded-md bg-primary text-white text-[13px] font-semibold hover:bg-primary-dark disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-text-secondary">Team name *</label>
            <input
              type="text"
              value={newTeamName}
              onChange={e => setNewTeamName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void createTeam()}
              placeholder="e.g. Site A Crew, Night Shift"
              autoFocus
              className="w-full h-11 px-3 bg-background border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[12px] text-text-secondary">Description (optional)</label>
            <textarea
              value={newTeamDesc}
              onChange={e => setNewTeamDesc(e.target.value)}
              rows={2}
              placeholder="Notes…"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-[13px] text-text-primary resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
