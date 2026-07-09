'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'
import type { TimesheetPunch } from '@/types/database'

export default function AttendancePage() {
  const [punches, setPunches] = useState<TimesheetPunch[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { loadCompany() }, [])
  useEffect(() => { if (companyId) loadPunches() }, [companyId, date])

  async function loadCompany() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: emp } = await supabase
      .from('employees')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle()
    if (emp) setCompanyId(emp.company_id)
    else setLoading(false)
  }

  async function loadPunches() {
    setLoading(true)
    const supabase = createClient()
    const nextDay = new Date(date)
    nextDay.setDate(nextDay.getDate() + 1)

    const { data } = await supabase
      .from('timesheet_punches')
      .select('*, employees(name, surname, employee_code)')
      .eq('company_id', companyId!)
      .gte('punch_in', date)
      .lt('punch_in', nextDay.toISOString().split('T')[0])
      .order('punch_in', { ascending: false })

    setPunches((data ?? []) as TimesheetPunch[])
    setLoading(false)
  }

  const filtered = punches.filter(p => {
    if (!search) return true
    const emp = p.employees as { name: string; surname: string; employee_code: string | null } | undefined
    if (!emp) return false
    const q = search.toLowerCase()
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.surname.toLowerCase().includes(q) ||
      (emp.employee_code ?? '').toLowerCase().includes(q)
    )
  })

  const onSite = punches.filter(p => !p.punch_out).length
  const completed = punches.filter(p => p.punch_out).length
  const totalHours = punches
    .filter(p => p.hours_worked != null)
    .reduce((sum, p) => sum + (p.hours_worked ?? 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Attendance</h1>
          <p className="text-[13px] text-text-secondary mt-0.5">{punches.length} punches for selected date</p>
        </div>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="h-10 px-3 bg-surface border border-border rounded-md text-[13px] text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-primary">{onSite}</p>
          <p className="text-[12px] text-text-secondary">Currently on site</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-success">{completed}</p>
          <p className="text-[12px] text-text-secondary">Completed shifts</p>
        </div>
        <div className="bg-surface rounded-lg border border-divider p-4">
          <p className="text-[24px] font-bold text-text-primary">{totalHours.toFixed(1)}h</p>
          <p className="text-[12px] text-text-secondary">Total hours</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 h-10 px-3 bg-surface border border-border rounded-md mb-4 w-full max-w-sm">
        <span className="material-icons text-text-disabled text-[18px]">search</span>
        <input
          type="text"
          placeholder="Filter by name or code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 text-[13px] text-text-primary placeholder:text-text-disabled bg-transparent focus:outline-none"
        />
      </div>

      {/* Punches list */}
      <div className="bg-surface rounded-lg border border-divider overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-[13px] text-text-disabled">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <span className="material-icons text-[48px] text-text-disabled block mb-2">schedule</span>
            <p className="text-[14px] text-text-secondary">No attendance records for this date</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider bg-surface-elevated">
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Employee</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Clock In</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Clock Out</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Hours</th>
                  <th className="text-left px-5 py-3 text-[12px] font-medium text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const emp = p.employees as { name: string; surname: string; employee_code: string | null } | undefined
                  const active = !p.punch_out
                  return (
                    <tr key={p.id} className="border-b border-divider last:border-0 hover:bg-background transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-text-primary">
                          {emp ? `${emp.name} ${emp.surname}` : 'Unknown'}
                        </p>
                        {emp?.employee_code && (
                          <p className="text-[11px] text-text-secondary font-mono">{emp.employee_code}</p>
                        )}
                      </td>
                      <td className="px-5 py-3 text-text-secondary">{formatDateTime(p.punch_in)}</td>
                      <td className="px-5 py-3 text-text-secondary">
                        {p.punch_out ? formatDateTime(p.punch_out) : '—'}
                      </td>
                      <td className="px-5 py-3 font-semibold text-text-primary">
                        {p.hours_worked != null ? `${p.hours_worked.toFixed(1)}h` : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`flex items-center gap-1 text-[12px] font-medium w-fit ${active ? 'text-success' : 'text-text-secondary'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-success' : 'bg-text-disabled'}`} />
                          {active ? 'On site' : 'Completed'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
