'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveCurrentMember } from '@/lib/supabase/resolve-company'
import type { WorkTeam } from '@/types/database'

interface TeamEmployee {
  id: string
  employee_id: string
  employee: { name: string; surname: string; position: string | null }
  is_clocked_in: boolean
}

const initials = (name: string, surname: string) =>
  (name.charAt(0) + surname.charAt(0)).toUpperCase()

export default function TeamPunchPage() {
  const router = useRouter()
  const [teams, setTeams] = useState<WorkTeam[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [members, setMembers] = useState<TeamEmployee[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeSelf, setIncludeSelf] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState('Getting location...')
  const [isGettingLocation, setIsGettingLocation] = useState(true)
  const [lat, setLat] = useState<number | null>(null)
  const [lng, setLng] = useState<number | null>(null)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [selfEmployeeId, setSelfEmployeeId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) { setAddress('Location unavailable'); setIsGettingLocation(false); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude)
        setLng(pos.coords.longitude)
        setAddress(pos.coords.latitude.toFixed(5) + ', ' + pos.coords.longitude.toFixed(5))
        setIsGettingLocation(false)
      },
      () => { setAddress('Location unavailable'); setIsGettingLocation(false) }
    )
  }, [])

  const loadTeams = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const member = await resolveCurrentMember(supabase)
    if (!member) { setError('not_linked'); setLoading(false); return }
    setCompanyId(member.companyId)
    setSelfEmployeeId(member.employeeId)

    const { data } = await supabase.from('work_teams').select('id, name, description, is_active, member_count')
      .eq('company_id', member.companyId).eq('is_active', true).order('name')
    setTeams((data ?? []) as WorkTeam[])
    setLoading(false)
  }, [])

  useEffect(() => { loadTeams() }, [loadTeams])

  const loadMembers = useCallback(async (teamId: string) => {
    if (!teamId) { setMembers([]); return }
    const supabase = createClient()
    const { data } = await supabase
      .from('work_team_members')
      .select('id, employee_id, employee:employees(name, surname, position)')
      .eq('team_id', teamId)

    const empIds = ((data ?? []) as Record<string, unknown>[]).map(r => r.employee_id as string)

    // time_punches uses separate 'in'/'out' rows — derive clocked-in from most recent punch per employee today
    const { data: recentPunches } = empIds.length > 0
      ? await supabase
          .from('time_punches')
          .select('employee_id, type, date_time')
          .in('employee_id', empIds)
          .gte('date_time', new Date(new Date().setHours(0, 0, 0, 0)).toISOString())
          .order('date_time', { ascending: false })
      : { data: [] }

    // Keep only the most recent punch per employee
    const latestByEmployee = new Map<string, string>()
    for (const p of (recentPunches ?? []) as { employee_id: string; type: string }[]) {
      if (!latestByEmployee.has(p.employee_id)) {
        latestByEmployee.set(p.employee_id, p.type)
      }
    }
    const clockedIn = new Set(
      [...latestByEmployee.entries()].filter(([, t]) => t === 'in').map(([id]) => id)
    )

    setMembers(((data ?? []) as Record<string, unknown>[]).map(r => ({
      id: r.id as string,
      employee_id: r.employee_id as string,
      employee: r.employee as { name: string; surname: string; position: string | null },
      is_clocked_in: clockedIn.has(r.employee_id as string),
    })))
    setSelected(new Set())
  }, [])

  useEffect(() => { loadMembers(selectedTeamId) }, [selectedTeamId, loadMembers])

  function toggleSelect(empId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(empId)) next.delete(empId); else next.add(empId)
      return next
    })
  }

  async function clockIn() {
    if (!companyId) return
    setBusy(true)
    const supabase = createClient()
    const ids = [...selected]
    if (includeSelf && selfEmployeeId) ids.push(selfEmployeeId)
    const { error: rpcErr } = await supabase.rpc('hr_team_clock_in', {
      p_company_id: companyId,
      p_employee_ids: ids,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_address: address ?? null,
    })
    if (rpcErr) console.error('team clock in:', rpcErr.message)
    await loadMembers(selectedTeamId)
    setSelected(new Set())
    setBusy(false)
  }

  async function clockOut() {
    if (!companyId) return
    setBusy(true)
    const supabase = createClient()
    const ids = [...selected]
    if (includeSelf && selfEmployeeId) ids.push(selfEmployeeId)
    const { error: rpcErr } = await supabase.rpc('hr_team_clock_out', {
      p_company_id: companyId,
      p_employee_ids: ids,
      p_latitude: lat ?? null,
      p_longitude: lng ?? null,
      p_address: address ?? null,
    })
    if (rpcErr) console.error('team clock out:', rpcErr.message)
    await loadMembers(selectedTeamId)
    setSelected(new Set())
    setBusy(false)
  }

  const n = selected.size

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
    <div className="h-full flex flex-col pb-[82px]">
      {/* Location bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-divider shrink-0 bg-surface-card">
        <span className="material-icons text-primary text-[18px]">location_on</span>
        <p className="text-[12px] text-text-secondary truncate flex-1">{address}</p>
        {isGettingLocation && <span className="text-[11px] text-text-secondary">...</span>}
      </div>

      {/* Controls card */}
      <div className="card mx-4 mt-3 p-3.5 shrink-0 space-y-2.5">
        <div className="grid gap-2.5" style={{ gridTemplateColumns: '1fr auto' }}>
          <select value={selectedTeamId} onChange={e => setSelectedTeamId(e.target.value)}
            className="dark-entry text-[13px] appearance-none rounded-[10px] border border-divider bg-surface-elevated">
            <option value="">Select a team...</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={() => router.push('/dashboard/work-teams/new')}
            className="text-primary border border-primary text-[12px] h-[44px] px-3 rounded-[10px] bg-surface-elevated hover:opacity-80 transition-opacity">
            + Team
          </button>
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr auto auto auto' }}>
          <button className="border border-divider text-primary text-[12px] h-[34px] px-2.5 rounded-lg bg-surface-elevated hover:opacity-80">
            + Add Members
          </button>
          {members.length > 0 && (
            <>
              <span className="text-text-secondary text-[12px] self-center">
                {selected.size} selected
              </span>
              <button onClick={() => setSelected(new Set(members.map(m => m.employee_id)))}
                className="text-primary text-[12px] h-[32px] px-2 hover:opacity-70">
                All
              </button>
              <button onClick={() => setSelected(new Set())}
                className="text-text-secondary text-[12px] h-[32px] px-2 hover:opacity-70">
                None
              </button>
            </>
          )}
        </div>

        <div className="grid gap-2.5 items-center mt-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <input type="checkbox" checked={includeSelf} onChange={e => setIncludeSelf(e.target.checked)}
            className="accent-primary w-4 h-4" />
          <div>
            <p className="text-[13px] font-medium text-text-primary">Also clock me in/out</p>
            <p className="text-[11px] text-text-secondary">Includes you in the selected operation</p>
          </div>
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto px-4 mt-2 space-y-1">
        {loading ? (
          <p className="text-text-secondary text-[13px] text-center py-8">Loading...</p>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <p className="text-text-secondary text-sm">No employees in this team yet.</p>
            <button onClick={() => router.push('/dashboard/work-teams/new')}
              className="text-[13px] text-primary hover:opacity-70">Or create a new team</button>
          </div>
        ) : members.map(m => {
          const emp = m.employee
          const fullName = emp ? (emp.name + ' ' + emp.surname) : '---'
          const isSelected = selected.has(m.employee_id)
          const clockedIn = m.is_clocked_in

          return (
            <div key={m.id} className="card p-3.5">
              <div className="grid gap-3 items-center" style={{ gridTemplateColumns: 'auto 48px 1fr auto' }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(m.employee_id)}
                  className="accent-primary w-4 h-4" />
                <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center">
                  <span className="font-semibold text-[15px] text-white">
                    {emp ? initials(emp.name, emp.surname) : '?'}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-[14px] text-text-primary">{fullName}</p>
                  {emp && emp.position && <p className="text-[11px] text-text-secondary">{emp.position}</p>}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={clockedIn
                      ? { backgroundColor: '#DCFCE7', color: '#166534' }
                      : { backgroundColor: '#F3F4F6', color: '#6B7280' }
                    }>
                    {clockedIn ? 'In' : 'Out'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-[64px] right-0 px-4 py-3 bg-surface-dark border-t border-divider z-10">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={clockIn}
            disabled={busy || (n === 0 && !includeSelf)}
            className="h-[50px] rounded-xl font-semibold text-[14px] text-white disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#22C55E' }}
          >
            {n > 0 ? ('Clock In ' + n + ' Selected') : 'Clock In'}
          </button>
          <button
            onClick={clockOut}
            disabled={busy || (n === 0 && !includeSelf)}
            className="h-[50px] rounded-xl font-semibold text-[14px] text-white disabled:opacity-40 transition-opacity"
            style={{ backgroundColor: '#EF4444' }}
          >
            {n > 0 ? ('Clock Out ' + n + ' Selected') : 'Clock Out'}
          </button>
        </div>
      </div>
    </div>
  )
}
