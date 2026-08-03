'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import { withMemberCount, type WorkTeamRow } from '@/lib/work-teams'
import type { WorkTeam } from '@/types/database'

export default function WorkTeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<WorkTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDesc, setNewTeamDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setActionError(null)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)

    const { data, error: qErr } = await supabase
      .from('work_teams')
      .select('id, company_id, name, description, leader_employee_id, member_ids, is_active, created_at')
      .eq('company_id', member.companyId)
      .order('name')

    if (qErr) {
      setActionError(qErr.message)
      setTeams([])
    } else {
      setTeams((data ?? []).map(t => withMemberCount(t as WorkTeamRow)) as WorkTeam[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function createTeam() {
    if (!newTeamName.trim() || !companyId) return
    setCreating(true)
    setActionError(null)
    const supabase = createClient()
    const { data, error: insertErr } = await supabase
      .from('work_teams')
      .insert({
        company_id: companyId,
        name: newTeamName.trim(),
        description: newTeamDesc.trim() || null,
        is_active: true,
        member_ids: [],
      })
      .select('id')
      .single()

    setCreating(false)
    if (insertErr) {
      setActionError(insertErr.message)
      return
    }
    setNewTeamName('')
    setNewTeamDesc('')
    setShowCreate(false)
    if (data?.id) router.push(`/dashboard/work-teams/${data.id}`)
    else await load()
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
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-surface-dark">
        <h1 className="text-sm font-semibold uppercase tracking-wider text-text-primary">Work Teams</h1>
        <button onClick={() => setShowCreate(true)} className="btn-primary h-9 px-3 text-[13px]">
          + Team
        </button>
      </div>

      {actionError && (
        <p className="px-4 py-2 text-error text-[13px] shrink-0">{actionError}</p>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="material-icons text-[48px] text-text-disabled">groups</span>
            <p className="text-text-secondary text-[14px]">No teams yet.</p>
            <button onClick={() => setShowCreate(true)} className="btn-primary h-9 px-4 text-[13px] mt-2">
              + Team
            </button>
          </div>
        ) : (
          teams.map(team => (
            <div
              key={team.id}
              className="card p-3 cursor-pointer hover:bg-background transition-colors"
              onClick={() => router.push(`/dashboard/work-teams/${team.id}`)}
            >
              <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0"
                  style={{ backgroundColor: team.is_active ? '#1D4ED8' : '#374151' }}
                >
                  👥
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-text-primary truncate">{team.name}</p>
                  {team.description && (
                    <p className="text-xs text-text-secondary truncate">{team.description}</p>
                  )}
                  <p className="text-xs">
                    <span className="text-text-primary">{team.member_count}</span>
                    <span className="text-text-secondary"> member{team.member_count !== 1 ? 's' : ''}</span>
                  </p>
                </div>
                <span
                  className="text-[11px] font-bold px-2 py-1 rounded-xl shrink-0"
                  style={team.is_active
                    ? { backgroundColor: '#DCFCE7', color: '#166534' }
                    : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                  }
                >
                  {team.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))
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
                onClick={createTeam}
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
