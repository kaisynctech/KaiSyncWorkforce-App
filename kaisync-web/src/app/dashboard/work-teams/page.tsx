'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { WorkTeam } from '@/types/database'

export default function WorkTeamsPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<WorkTeam[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: me } = await supabase.from('employees').select('company_id').eq('user_id', user.id).maybeSingle()
    if (!me) { setLoading(false); return }

    const { data } = await supabase
      .from('work_teams')
      .select('*, members:work_team_members(count)')
      .eq('company_id', me.company_id)
      .order('name')

    const mapped = (data ?? []).map((t: Record<string, unknown>) => ({
      ...t,
      member_count: Array.isArray(t.members) && t.members.length > 0
        ? ((t.members[0] as Record<string, unknown>).count ?? 0)
        : 0,
    }))
    setTeams(mapped as WorkTeam[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-surface-dark">
        <h1 className="text-sm font-semibold uppercase tracking-wider text-text-primary">Work Teams</h1>
        <button onClick={() => router.push('/dashboard/work-teams/new')} className="btn-primary h-9 px-3 text-[13px]">
          + Team
        </button>
      </div>

      {/* Team cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading…</p>
        ) : teams.length === 0 ? (
          <div className="flex flex-col items-center py-12 gap-2">
            <span className="material-icons text-[48px] text-text-disabled">groups</span>
            <p className="text-text-secondary text-[14px]">No teams yet.</p>
            <button onClick={() => router.push('/dashboard/work-teams/new')} className="btn-primary h-9 px-4 text-[13px] mt-2">
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
                {/* Icon circle */}
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xl shrink-0"
                  style={{ backgroundColor: team.is_active ? '#1D4ED8' : '#374151' }}
                >
                  👥
                </div>

                {/* Team info */}
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

                {/* Active badge */}
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
    </div>
  )
}
